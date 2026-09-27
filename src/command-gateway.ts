/**
 * SOL-SYLPH Authoritative Command Gateway
 * Specifications: Sections 5, 23, 26, 27, 28, 43, 44, 45.
 *
 * All consequential operator and automation actions MUST flow through this gateway.
 * Directly mutating positions or calling raw swaps from UI or models is strictly prohibited.
 */

import { globalConfigAuthority } from './config-authority.js';
import { globalLifecycle } from './lifecycle/system-lifecycle.js';
import { SimulatedEngine, type OrderRequest, type FillReport } from './execution-engine.js';
import { LeaderScheduleTracker } from './platform/execution/solaris/leader-schedule.js';
import { DynamicTipAndContentionOracle } from './platform/execution/solaris/tip-oracle.js';
import { BimodalExecutionRouter, type RouteRequest } from './platform/execution/solaris/bimodal-router.js';
import { PostGraduationAmmBridge } from './platform/execution/solaris/amm-bridge.js';
import { type BimodalRoutePlan, type SolarisTelemetrySnapshot } from './platform/execution/solaris/types.js';
import { SpieEngine, KellyAllocator } from './intelligence/spie/index.js';
import { globalTradeLearningService, type AdaptiveLearningSnapshot } from './intelligence/attribution/trade-learning-service.js';
import { decideExit, protectiveStop } from './exit-policy.js';
import { calculateOptimalBuyPositionValue } from './intelligence/execution/position-sizer.js';

export type CommandType =
  | 'SUBMIT_ORDER'
  | 'CLOSE_POSITION'
  | 'CHANGE_MODE'
  | 'SET_AUTOMATION'
  | 'EMERGENCY_STOP'
  | 'PANIC_CLOSE_ALL'
  | 'SET_PAPER_CAPITAL';

export interface BaseCommand {
  readonly commandId: string;
  readonly type: CommandType;
  readonly timestamp: number;
  readonly initiator: string;
}

export interface SubmitOrderCommand extends BaseCommand {
  readonly type: 'SUBMIT_ORDER';
  readonly payload: {
    readonly orderId?: string;
    readonly mint: string;
    readonly poolAddress: string;
    readonly symbol?: string;
    readonly side: 'BUY' | 'SELL';
    readonly usdAmount?: number;
    readonly tokenQty?: number;
    readonly tokenDecimals?: number;
  lastPeakAt?: number;
  lastMark?: number;
  lastMarkAt?: number;
    readonly maxSlippageBps?: number;
    readonly emergency?: boolean;
    readonly fallbackPriceSol?: number;
    readonly priceUsd?: number;
    readonly liquidity?: number;
    readonly highSignalIndex?: number;
    readonly tier?: string;
    readonly pod?: string;
    readonly exitTrigger?: 'EMERGENCY_UNWIND' | 'TRAILING_TARGET' | 'OPERATOR_CLOSE' | 'AUTO_GUARDIAN' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'FALSE_BREAKOUT';
  };
}

export interface ClosePositionCommand extends BaseCommand {
  readonly type: 'CLOSE_POSITION';
  readonly payload: {
    readonly mint: string;
    readonly poolAddress: string;
    readonly tokenQty?: number;
    readonly emergency?: boolean;
    readonly priceUsd?: number;
    readonly fallbackPriceSol?: number;
    readonly exitTrigger?: 'EMERGENCY_UNWIND' | 'TRAILING_TARGET' | 'OPERATOR_CLOSE' | 'AUTO_GUARDIAN' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'FALSE_BREAKOUT';
  };
}

export interface ChangeModeCommand extends BaseCommand {
  readonly type: 'CHANGE_MODE';
  readonly payload: {
    readonly mode: 'live' | 'paper' | 'shadow';
  };
}

export interface SetAutomationCommand extends BaseCommand {
  readonly type: 'SET_AUTOMATION';
  readonly payload: {
    readonly enabled: boolean;
  };
}

export interface EmergencyStopCommand extends BaseCommand {
  readonly type: 'EMERGENCY_STOP';
  readonly payload: {
    readonly reason: string;
  };
}

export interface PanicCloseAllCommand extends BaseCommand {
  readonly type: 'PANIC_CLOSE_ALL';
  readonly payload?: {
    readonly reason?: string;
  };
}

export interface SetPaperCapitalCommand extends BaseCommand {
  readonly type: 'SET_PAPER_CAPITAL';
  readonly payload: {
    readonly capitalUsd: number;
    readonly resetPositions?: boolean;
  };
}

export type Command =
  | SubmitOrderCommand
  | ClosePositionCommand
  | ChangeModeCommand
  | SetAutomationCommand
  | EmergencyStopCommand
  | PanicCloseAllCommand
  | SetPaperCapitalCommand;

export interface CommandResult<T = unknown> {
  readonly success: boolean;
  readonly commandId: string;
  readonly timestamp: number;
  readonly data?: T;
  readonly error?: string;
  readonly stateVersion: number;
}

export interface BackendPosition {
  readonly asset: string;
  readonly mint: string;
  readonly symbol?: string;
  qty: number;
  entry: number;
  stop: number;
  peak: number;
  trough: number;
  openedAt: number;
  costBasisUsd: number;
  stage: number;
  reconciliationState: 'SIMULATED' | 'RECONCILED' | 'PENDING' | 'DISCREPANCY';
  tokenDecimals?: number;
  lastPeakAt?: number;
  lastMark?: number;
  lastMarkAt?: number;
}

export interface GatewayStateSnapshot {
  readonly entriesHalted: boolean;
  readonly mode: 'live' | 'paper' | 'shadow';
  readonly automationEnabled: boolean;
  readonly cashUsd: number;
  readonly reservedCashUsd: number;
  readonly solPriceUsd: number;
  readonly positions: readonly BackendPosition[];
  readonly inFlightOrdersCount: number;
  readonly stateVersion: number;
  readonly operationalMode: string;
  readonly lastReconciledAt: number;
}

export class CommandGateway {
  private static instance: CommandGateway | null = null;

  private mode: 'live' | 'paper' | 'shadow' = 'paper';
  private automationEnabled: boolean = false;
  private entriesHalted: boolean = false;
  private cashUsd: number = Number(process.env.SIMULATED_CAPITAL_USD) > 0 ? Number(process.env.SIMULATED_CAPITAL_USD) : 10_000.0;
  private solPriceUsd: number = 150.0;
  private stateVersion: number = 1;
  // This gateway owns paper state only. It never claims chain reconciliation.
  private lastReconciledAt: number = 0;

  public setCashUsd(amount: number): void {
    if (Number.isFinite(amount) && amount >= 0) {
      this.cashUsd = amount;
      this.stateVersion++;
    }
  }

  public clearPositions(): void {
    this.positions.clear();
    this.pendingBuys.clear();
    this.inFlight.clear();
    this.stateVersion++;
  }

  public updateSolPriceUsd(price: number): void {
    if (Number.isFinite(price) && price > 0) {
      this.solPriceUsd = price;
    }
  }

  private readonly positions = new Map<string, BackendPosition>();
  private readonly inFlight = new Set<string>();
  private readonly executedIntentIds = new Set<string>();
  private readonly pendingBuys = new Map<string, number>();

  private readonly executionEngine: SimulatedEngine;

  public readonly leaderTracker: LeaderScheduleTracker;
  public readonly tipOracle: DynamicTipAndContentionOracle;
  public readonly bimodalRouter: BimodalExecutionRouter;
  public readonly ammBridge: PostGraduationAmmBridge;
  public readonly spie: SpieEngine;
  public readonly kellyAllocator: KellyAllocator;

  private constructor() {
    this.executionEngine = new SimulatedEngine(7, 100_000n, 10_000_000n);
    this.leaderTracker = new LeaderScheduleTracker();
    this.tipOracle = new DynamicTipAndContentionOracle();
    this.bimodalRouter = new BimodalExecutionRouter(this.leaderTracker, this.tipOracle);
    this.ammBridge = new PostGraduationAmmBridge();
    this.spie = new SpieEngine();
    this.kellyAllocator = new KellyAllocator();
  }

  public static getInstance(): CommandGateway {
    if (!CommandGateway.instance) {
      CommandGateway.instance = new CommandGateway();
    }
    return CommandGateway.instance;
  }

  public static resetInstance(): CommandGateway {
    CommandGateway.instance = new CommandGateway();
    return CommandGateway.instance;
  }

  public getSnapshot(): GatewayStateSnapshot {
    return {
      entriesHalted: this.entriesHalted,
      mode: this.mode,
      automationEnabled: this.automationEnabled,
      cashUsd: this.cashUsd,
      reservedCashUsd: [...this.pendingBuys.values()].reduce((sum, value) => sum + value, 0),
      solPriceUsd: this.solPriceUsd,
      positions: Array.from(this.positions.values(), position => ({...position})),
      inFlightOrdersCount: this.inFlight.size,
      stateVersion: this.stateVersion,
      operationalMode: globalLifecycle.getState(),
      lastReconciledAt: this.lastReconciledAt,
    };
  }

  public planRoute(req: RouteRequest): BimodalRoutePlan {
    return this.bimodalRouter.planRoute(req);
  }

  /**
   * Update high-water mark peak prices and calculate dynamic trailing stop floors.
   * Tracks pump peaks in real time so gains are locked in before price retraces.
   */
  public updatePositionMarks(tokens: Array<{mint?: string; pair?: string; price?: number; priceUsd?: number; at?: number}>): void {
    if (!tokens || !Array.isArray(tokens)) return;

    for (const pos of this.positions.values()) {
      const match = tokens.find(t => t.mint === pos.mint || t.pair === pos.asset || t.mint === pos.asset);
      const now = Date.now();
      if (match?.at !== undefined && (!Number.isSafeInteger(match.at) || match.at > now || now - match.at > globalConfigAuthority.getConfig().feedStaleMs)) continue;
      const price = typeof match?.price === 'number' && match.price > 0
        ? match.price
        : typeof match?.priceUsd === 'number' && match.priceUsd > 0
          ? match.priceUsd
          : null;

      if (price !== null && Number.isFinite(price) && price > 0) {
        // Anti-Phantom Price Spike Clamp: If age < 3s and price spikes > +50% without trade velocity, clamp to entry
        const positionAgeMs = now - (pos.openedAt || now);
        const effectivePrice = (positionAgeMs < 3000 && price > pos.entry * 1.50) ? pos.entry : price;
        pos.lastMark = effectivePrice; pos.lastMarkAt = now;
        if (!pos.peak || effectivePrice > pos.peak) { pos.peak = effectivePrice; pos.lastPeakAt = now; } if (!pos.lastPeakAt) { pos.lastPeakAt = pos.openedAt || now; }
        if (!pos.trough || price < pos.trough) {
          pos.trough = price;
        }

        // Display precisely the same floor the guardian will enforce.
        // Monotonic Profit Ratchet (Control 17 & 21): Stop can ONLY ratchet UPWARDS, never loosen downwards
        const computedStop = protectiveStop({ entry: pos.entry, peak: pos.peak, stopBps: globalConfigAuthority.getConfig().stopBps });
        if (computedStop !== null && Number.isFinite(computedStop) && computedStop > 0) {
          pos.stop = typeof pos.stop === 'number' && pos.stop > 0 ? Math.max(pos.stop, computedStop) : computedStop;
        }
      }
    }
  }

  /**
   * Evaluates and executes autonomous exits:
   * 1. Trailing Stop Exit: Peak >= +4% and current price fell to dynamic stop floor (locks in profit)
   * 2. Hard Take-Profit Target: Gain >= +15%
   * 3. Hard Stop-Loss: Current price <= entry * 0.88 (-12%)
   * 4. Stagnation / Time-Decay Exit: Open > 2 min and flat (<2.5%), freeing capacity for active pumps
   */
  public async tickAutonomousExits(tokens: Array<{mint?: string; pair?: string; price?: number; priceUsd?: number; at?: number}>): Promise<Array<{mint: string; action: string; reason: string}>> {
    const exited: Array<{mint: string; action: string; reason: string}> = [];
    // REDUCE_ONLY stops entries, never protection for already-held paper positions.
    if (this.positions.size === 0) return exited;

    this.updatePositionMarks(tokens);
    const now = Date.now();

    for (const [poolAddress, pos] of this.positions.entries()) {
      if (this.inFlight.has(poolAddress)) continue;

      const match = tokens.find(t => t.mint === pos.mint || t.pair === pos.asset || t.mint === pos.asset);
      let currentPrice = typeof match?.price === 'number' && match.price > 0
        ? match.price
        : typeof match?.priceUsd === 'number' && match.priceUsd > 0
          ? match.priceUsd
          : null;

      if ((currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) && typeof pos.lastMark === 'number' && pos.lastMark > 0) { currentPrice = pos.lastMark; }
      if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      // Anti-Phantom Price Spike Clamp for autonomous exits
      const positionAgeMs = now - (pos.openedAt || now);
      if (positionAgeMs < 3000 && currentPrice > pos.entry * 1.50) {
        currentPrice = pos.entry;
      }

      const decision = decideExit({ entry: pos.entry, mark: currentPrice, peak: pos.peak, stage: pos.stage, openedAt: pos.openedAt, now, stopBps: globalConfigAuthority.getConfig().stopBps, markAt: match?.at, maxMarkAgeMs: globalConfigAuthority.getConfig().feedStaleMs, lastPeakAt: pos.lastPeakAt ?? pos.openedAt, partialExitBps: 5_000 });
      if (decision) {
        try {
          const res = await this.handleClosePosition({
            commandId: `auto_exit_${now}_${Math.floor(Math.random() * 1000)}`,
            type: 'CLOSE_POSITION',
            timestamp: now,
            initiator: 'autonomous_exit_guardian',
            payload: {
              mint: pos.mint,
              poolAddress: pos.asset,
              tokenQty: pos.qty * decision.fractionBps / 10_000,
              emergency: decision.emergency,
              priceUsd: currentPrice,
              fallbackPriceSol: currentPrice / this.solPriceUsd,
              exitTrigger: decision.emergency ? 'EMERGENCY_UNWIND' : decision.reason === 'STAGNATION' ? 'OPERATOR_CLOSE' : 'TRAILING_TARGET',
            }
          });
          if (res.success) {
            const active = this.positions.get(poolAddress);
            if (active) active.stage = Math.max(active.stage, decision.nextStage);
            exited.push({ mint: pos.mint, action: decision.reason, reason: `${decision.reason} @ stop ${decision.protectiveStop.toFixed(8)}` });
          }
        } catch {
          // Non-blocking exit attempt
        }
      }
    }

    return exited;
  }

  public getSolarisSnapshot(currentSlot = 250_000): SolarisTelemetrySnapshot {
    const leader = this.leaderTracker.getSlotLeader(currentSlot);
    const chunk = this.leaderTracker.calculateChunkInfo(currentSlot);
    const nextSlot = chunk.chunkEndSlot + 1;
    const nextLeader = this.leaderTracker.getSlotLeader(nextSlot);
    const tipFloor = this.tipOracle.getTipFloor();
    const contention = this.tipOracle.estimateContention([]);

    return {
      currentSlot,
      activeLeaderPubkey: leader?.leaderPubkey,
      activeLeaderIsJito: leader?.isJitoLeader,
      activeLeaderStakeBps: leader?.clusterStakeShareBps,
      remainingSlotsInChunk: chunk.remainingSlotsInChunk,
      nextLeaderPubkey: nextLeader?.leaderPubkey,
      nextLeaderIsJito: nextLeader?.isJitoLeader,
      leaderScheduleStatus: leader && nextLeader ? 'VERIFIED' : 'UNAVAILABLE',
      tipFloor: tipFloor.isFresh ? {
        p25: tipFloor.p25Lamports.toString(),
        p50: tipFloor.p50Lamports.toString(),
        p75: tipFloor.p75Lamports.toString(),
        p95: tipFloor.p95Lamports.toString(),
      } : undefined,
      contentionTier: contention.contentionTier,
      recommendedPriorityMicroLamports: contention.recommendedMicroLamportsPerCu.toString(),
      activeGraduationCount: this.ammBridge.getAllActiveGraduations().length,
      resolvedGapsCount: 0,
      timestampMs: Date.now(),
      // Direct delivery is deliberately unavailable from this paper-only gateway.
      helios: {
        directTransmissionsCount: 0,
        pipelinedTransmissionsCount: 0,
        fallbackTransmissionsCount: 0,
        avgTransmissionDurationMs: 0,
        activeTpuEndpointsCount: 0,
      },
    };
  }

  public setSolPriceUsd(price: number): void {
    if (Number.isFinite(price) && price > 0) {
      this.solPriceUsd = price;
    }
  }

  public async executeCommand(command: Command): Promise<CommandResult> {
    const now = Date.now();

    try {
      switch (command.type) {
        case 'SUBMIT_ORDER':
          return await this.handleSubmitOrder(command);
        case 'CLOSE_POSITION':
          return await this.handleClosePosition(command);
        case 'CHANGE_MODE':
          return this.handleChangeMode(command);
        case 'SET_AUTOMATION':
          return this.handleSetAutomation(command);
        case 'EMERGENCY_STOP':
          return this.handleEmergencyStop(command);
        case 'PANIC_CLOSE_ALL':
          return await this.handlePanicCloseAll(command);
        case 'SET_PAPER_CAPITAL':
          return this.handleSetPaperCapital(command);
        default:
          return {
            success: false,
            commandId: (command as any).commandId || 'unknown',
            timestamp: now,
            error: `Unsupported command type: ${(command as any).type}`,
            stateVersion: this.stateVersion,
          };
      }
    } catch (err: any) {
      return {
        success: false,
        commandId: command.commandId,
        timestamp: now,
        error: err.message || 'Internal command execution failure',
        stateVersion: this.stateVersion,
      };
    }
  }

  private async handleSubmitOrder(cmd: SubmitOrderCommand): Promise<CommandResult> {
    const { payload } = cmd;
    if (this.mode !== 'paper' && this.mode !== 'shadow') {
      throw new Error('LIVE_UNAVAILABLE: Terminal command gateway is paper-only.');
    }
    // A transport retry must resolve to the same economic intent even when the caller omits orderId.
    const orderId = payload.orderId || cmd.commandId;
    if (!orderId || typeof orderId !== 'string' || !payload.mint || !payload.poolAddress || !['BUY','SELL'].includes(payload.side)) {
      throw new Error('INVALID_ORDER: Identity, mint, pool and side are required.');
    }
    if (payload.usdAmount !== undefined && (!Number.isFinite(payload.usdAmount) || payload.usdAmount <= 0) ||
        payload.tokenQty !== undefined && (!Number.isFinite(payload.tokenQty) || payload.tokenQty <= 0) ||
        payload.tokenDecimals !== undefined && (!Number.isInteger(payload.tokenDecimals) || payload.tokenDecimals < 0 || payload.tokenDecimals > 18)) {
      throw new Error('INVALID_ORDER: Amounts must be positive and decimals valid.');
    }
    const isBuy = payload.side === 'BUY';
    if (isBuy && this.entriesHalted) {
      throw new Error('ENTRY_BLOCKED: Paper emergency stop is latched.');
    }

    // 1. Idempotency check (Section 27)
    if (this.executedIntentIds.has(orderId)) {
      throw new Error(`DUPLICATE_INTENT: Order ${orderId} has already been executed or is in flight.`);
    }

    // 2. Lifecycle & Entry Safety (Sections 10, 11)
    // This handler already rejects live mode above. Paper/shadow orders are
    // isolated simulator actions and must not inherit live certification gates.

    // 3. Concurrency / In-flight fence (Section 44)
    if (this.inFlight.has(payload.poolAddress)) {
      throw new Error(`IN_FLIGHT_CONFLICT: Asset ${payload.poolAddress} already has an active order in flight.`);
    }

    const existingPosition = this.positions.get(payload.poolAddress);
    if (isBuy && existingPosition) throw new Error('POSITION_EXISTS: An entry cannot overwrite existing exposure.');
    if (!isBuy && (!existingPosition || existingPosition.mint !== payload.mint)) throw new Error('POSITION_NOT_FOUND: Sell must reference the recorded mint and pool.');
    if (!isBuy && payload.tokenQty !== undefined && payload.tokenQty > existingPosition!.qty) throw new Error('INVALID_QUANTITY: Sell exceeds recorded position.');
    if (!isBuy && payload.tokenDecimals !== undefined && payload.tokenDecimals !== (existingPosition!.tokenDecimals ?? 9)) throw new Error('INVALID_DECIMALS: Sell must use recorded token decimals.');
    const tokenDecimals = isBuy ? payload.tokenDecimals ?? 9 : existingPosition!.tokenDecimals ?? 9;

    // 4. Capacity & Cash validation
    const config = globalConfigAuthority.getConfig();
    let effectiveUsdAmount = payload.usdAmount;
    if (isBuy) {
      if (this.positions.size + this.pendingBuys.size >= config.maxPositions) {
        throw new Error(`MAX_POSITIONS_REACHED: Cannot open more than ${config.maxPositions} positions.`);
      }
      if (!effectiveUsdAmount || effectiveUsdAmount <= 0) {
        const sizing = calculateOptimalBuyPositionValue(
          {
            mint: payload.mint,
            symbol: payload.symbol,
            priceUsd: payload.priceUsd,
            priceSol: payload.fallbackPriceSol,
            liquidity: payload.liquidity,
            highSignalIndex: payload.highSignalIndex,
            tier: payload.tier,
            pod: payload.pod,
          },
          {
            cashUsd: this.cashUsd,
            reservedCashUsd: [...this.pendingBuys.values()].reduce((sum, value) => sum + value, 0),
            activePositionsCount: this.positions.size,
            maxPositions: config.maxPositions,
            solPriceUsd: this.solPriceUsd,
          }
        );
        effectiveUsdAmount = sizing.optimalUsd > 0 ? sizing.optimalUsd : 50.0;
      }
      const requiredUsd = effectiveUsdAmount;
      const reservedUsd = [...this.pendingBuys.values()].reduce((sum, value) => sum + value, 0);
      if (this.cashUsd - reservedUsd < requiredUsd) {
        throw new Error(`INSUFFICIENT_CASH: Available ${this.cashUsd.toFixed(2)} USD < required ${requiredUsd.toFixed(2)} USD.`);
      }
    }

    this.inFlight.add(payload.poolAddress);
    this.executedIntentIds.add(orderId);
    if (isBuy) this.pendingBuys.set(payload.poolAddress, effectiveUsdAmount!);

    try {
      // 5. Paper execution request construction. This boundary deliberately does
      // not mint live permits, signatures, slots, or chain-reconciliation claims.
      const amountLamports = isBuy
        ? BigInt(Math.round(((effectiveUsdAmount!) / this.solPriceUsd) * 1e9))
        : BigInt(Math.round((payload.tokenQty ?? existingPosition!.qty) * 10 ** tokenDecimals));

      // Ensure fresh pool state exists in executionEngine calibrated to actual token market price
      const candidatePriceUsd = payload.priceUsd ?? (payload.fallbackPriceSol ? payload.fallbackPriceSol * this.solPriceUsd : undefined);
      if (candidatePriceUsd && candidatePriceUsd > 0) {
        const tokenPriceSol = candidatePriceUsd / this.solPriceUsd;
        // Calibrate pool reserves around a standard 30 SOL pool depth
        const poolSolLamports = 30_000_000_000n; // 30 SOL
        const totalTokens = 30 / tokenPriceSol;
        const poolTokenUnits = BigInt(Math.max(1, Math.round(totalTokens * (10 ** tokenDecimals))));
        this.executionEngine.pushState({
          timestamp: Date.now() + 1000,
          slot: 250000,
          reserves: { sol: poolSolLamports, token: poolTokenUnits },
          price: tokenPriceSol,
          volatility: 0.05,
        }, payload.poolAddress);
      } else {
        // Fallback default pool for test suites without explicit token price
        this.executionEngine.pushState({
          timestamp: Date.now() + 1000,
          slot: 250000,
          reserves: { sol: 100_000_000_000n, token: 1_000_000_000_000_000n },
          price: 0.00005,
          volatility: 0.05,
        }, payload.poolAddress);
      }

      const request: OrderRequest = {
        orderId,
        tokenMint: payload.mint,
        poolAddress: payload.poolAddress,
        side: payload.side,
        amountLamports,
        amountDecimals: tokenDecimals,
        maxSlippageBps: payload.maxSlippageBps ?? config.slippageBps,
        triggerTimestamp: Date.now(),
        emergency: payload.emergency ?? false,
        fallbackPriceSol: payload.fallbackPriceSol,
      };

      // 6. Execute through the isolated simulator. No network delivery exists here.
      const result = await this.executionEngine.execute(request);
      const { report, telemetry } = result;

      // Cancellation can race a simulator completion. No paper entry may be
      // committed after the operator's stop, even if the adapter reports a fill.
      if (isBuy && this.entriesHalted) {
        throw new Error('ENTRY_BLOCKED: Paper emergency stop occurred during execution.');
      }

      // 7. Authoritative paper-state mutation (ONLY within backend gateway)
      if (report.status === 'FILLED') {
        if (isBuy) {
          const filledQty = Number(report.outputAmount) / 10 ** tokenDecimals;
          const costUsd = effectiveUsdAmount!;
          const execPriceUsd = candidatePriceUsd && filledQty > 0
            ? (costUsd / filledQty)
            : (report.execPrice || 0.00001) * this.solPriceUsd;

          this.positions.set(payload.poolAddress, {
            asset: payload.poolAddress,
            mint: payload.mint,
            symbol: payload.symbol,
            qty: filledQty,
            entry: execPriceUsd,
            stop: execPriceUsd * (1 - config.stopBps / 10_000),
            peak: execPriceUsd,
            trough: execPriceUsd,
            openedAt: Date.now(),
            costBasisUsd: costUsd,
            stage: 0,
            reconciliationState: 'SIMULATED',
            tokenDecimals,
          });
          this.cashUsd -= costUsd;
        } else {
          // SELL / Exit
          const pos = this.positions.get(payload.poolAddress);
          const proceedSol = Number(report.outputAmount) / 1e9;
          let proceedUsd = proceedSol * this.solPriceUsd;

          if (pos) {
            const soldQty = Number(report.inputAmount) / 10 ** tokenDecimals;
            const remaining = Math.max(0, pos.qty - soldQty);
            const closedFraction = pos.qty > 0 ? Math.min(1, soldQty / pos.qty) : 1;
            const basisCostClosedUsd = pos.costBasisUsd * closedFraction;
            let realizedPnlUsd = proceedUsd - basisCostClosedUsd;
            let realizedPnlPct = basisCostClosedUsd > 0 ? (realizedPnlUsd / basisCostClosedUsd) * 100 : 0;
            const holdDurationMs = Math.max(0, Date.now() - (pos.openedAt || Date.now()));
            const exitTrigger = payload.exitTrigger
              || (payload.emergency
                ? 'EMERGENCY_UNWIND'
                : (cmd.initiator === 'auto_exit_guardian' || cmd.initiator === 'autonomous_exit_guardian'
                  ? 'TRAILING_TARGET'
                  : 'OPERATOR_CLOSE'));

            // A paper fill is still an accounting fact. Never rewrite its
            // proceeds to force a profit floor or loss ceiling: that would
            // contaminate cash, P&L, and learning data derived from it.
            // Execution assumptions belong in the fill model before a report
            // is produced, never in settlement accounting afterwards.
            const exitPriceUsd = candidatePriceUsd || (soldQty > 0 ? proceedUsd / soldQty : pos.entry);

            // Pavlov Attribution: record closed trade and update decision credit & adaptive hurdles
            try {
              globalTradeLearningService.recordClosedTrade({
                tokenMint: pos.mint,
                symbol: pos.symbol || (pos.asset ? pos.asset.slice(0, 8) : 'UNKNOWN'),
                entryPriceUsd: pos.entry,
                exitPriceUsd,
                costBasisUsd: basisCostClosedUsd,
                proceedsUsd: proceedUsd,
                realizedPnlUsd,
                realizedPnlPct,
                holdDurationMs,
                exitTrigger,
                wasDecisionSound: true,
                mfePriceUsd: pos.peak,
                maePriceUsd: pos.trough,
              });
            } catch {
              // Learning recording is non-blocking to execution
            }

            if (remaining <= 1 / 10 ** tokenDecimals) this.positions.delete(payload.poolAddress);
            else {
              pos.costBasisUsd *= remaining / pos.qty;
              pos.qty = remaining;
            }
          }
          this.cashUsd += proceedUsd;
        }
        this.stateVersion++;
      }

      return {
        success: report.status === 'FILLED',
        commandId: cmd.commandId,
        timestamp: Date.now(),
        data: {
          orderId,
          report,
          telemetry,
          executionMode: 'PAPER',
        },
        error: report.status !== 'FILLED' ? report.failureReason || 'Order rejected by execution engine' : undefined,
        stateVersion: this.stateVersion,
      };
    } finally {
      this.inFlight.delete(payload.poolAddress);
      this.pendingBuys.delete(payload.poolAddress);
    }
  }

  private async handleClosePosition(cmd: ClosePositionCommand): Promise<CommandResult> {
    const { payload } = cmd;
    const pos = this.positions.get(payload.poolAddress);
    if (!pos) {
      throw new Error(`POSITION_NOT_FOUND: No active position found for asset ${payload.poolAddress}.`);
    }

    return await this.handleSubmitOrder({
      commandId: cmd.commandId,
      type: 'SUBMIT_ORDER',
      timestamp: cmd.timestamp,
      initiator: cmd.initiator,
      payload: {
        mint: payload.mint || pos.mint,
        poolAddress: payload.poolAddress,
        symbol: pos.symbol,
        side: 'SELL',
        tokenQty: payload.tokenQty || pos.qty,
        tokenDecimals: pos.tokenDecimals,
        emergency: payload.emergency ?? true,
        maxSlippageBps: 10_000, // 100% emergency slippage ceiling for close
        priceUsd: payload.priceUsd,
        fallbackPriceSol: payload.fallbackPriceSol || (payload.priceUsd ? payload.priceUsd / this.solPriceUsd : pos.entry / this.solPriceUsd),
        exitTrigger: payload.exitTrigger,
      },
    });
  }

  private handleChangeMode(cmd: ChangeModeCommand): CommandResult {
    if (cmd.payload.mode !== 'paper' && cmd.payload.mode !== 'shadow') {
      throw new Error('LIVE_UNAVAILABLE: This gateway is backed by a simulator, not a live signer.');
    }
    if (this.inFlight.size > 0) {
      throw new Error(`MODE_CHANGE_LOCKED: Cannot change mode while ${this.inFlight.size} orders are in flight.`);
    }
    const previousMode = this.mode;
    this.mode = cmd.payload.mode;
    this.stateVersion++;

    return {
      success: true,
      commandId: cmd.commandId,
      timestamp: Date.now(),
      data: { previousMode, currentMode: this.mode },
      stateVersion: this.stateVersion,
    };
  }

  private handleSetAutomation(cmd: SetAutomationCommand): CommandResult {
    if (typeof cmd.payload.enabled !== 'boolean') {
      throw new Error('INVALID_AUTOMATION: enabled must be a boolean.');
    }
    if (cmd.payload.enabled && (this.entriesHalted || !globalLifecycle.isEntryPermitted())) {
      throw new Error('ENTRY_BLOCKED: Automation requires entry readiness and a clear emergency stop.');
    }
    // Automation here controls only the simulator; live mode is rejected by the gateway.
    this.automationEnabled = cmd.payload.enabled;
    this.stateVersion++;

    return {
      success: true,
      commandId: cmd.commandId,
      timestamp: Date.now(),
      data: { automationEnabled: this.automationEnabled },
      stateVersion: this.stateVersion,
    };
  }

  private handleEmergencyStop(cmd: EmergencyStopCommand): CommandResult {
    // The local stop must succeed even when the shared lifecycle is already
    // stopped or cannot transition (for example during shutdown).
    this.entriesHalted = true;
    this.automationEnabled = false;
    this.executionEngine.cancelAllBuys();
    this.stateVersion++;
    try {
      if (globalLifecycle.getState() !== 'REDUCE_ONLY') {
        globalLifecycle.transition('REDUCE_ONLY', `Emergency Stop: ${cmd.payload.reason}`);
      }
    } catch { /* The independently latched paper stop remains authoritative. */ }

    return {
      success: true,
      commandId: cmd.commandId,
      timestamp: Date.now(),
      data: {
        entriesHalted: this.entriesHalted,
        lifecycleState: globalLifecycle.getState(),
        automationEnabled: this.automationEnabled,
        reason: cmd.payload.reason,
      },
      stateVersion: this.stateVersion,
    };
  }

  private handleSetPaperCapital(cmd: SetPaperCapitalCommand): CommandResult {
    const { capitalUsd, resetPositions } = cmd.payload;
    if (!Number.isFinite(capitalUsd) || capitalUsd < 0) {
      throw new Error('INVALID_CAPITAL: capitalUsd must be a non-negative number.');
    }
    this.cashUsd = capitalUsd;
    if (resetPositions) {
      this.positions.clear();
      this.pendingBuys.clear();
      this.inFlight.clear();
    }
    this.stateVersion++;

    return {
      success: true,
      commandId: cmd.commandId,
      timestamp: Date.now(),
      data: {
        cashUsd: this.cashUsd,
        positionsCount: this.positions.size,
      },
      stateVersion: this.stateVersion,
    };
  }

  /**
   * PANIC_CLOSE_ALL: Global Emergency Liquidation Handler (Upgrade 75).
   * Freezes all new buys, cancels open/in-flight orders, and submits parallel
   * emergency sell orders for 100% of all held positions.
   */
  private async handlePanicCloseAll(cmd: PanicCloseAllCommand): Promise<CommandResult> {
    this.entriesHalted = true;
    this.automationEnabled = false;
    this.pendingBuys.clear();
    this.executionEngine.cancelAllBuys();
    this.stateVersion++;

    try {
      if (globalLifecycle.getState() !== 'REDUCE_ONLY') {
        globalLifecycle.transition('REDUCE_ONLY', 'Panic Close All: ' + (cmd.payload?.reason || 'Operator panic requested'));
      }
    } catch { /* Independently latched paper stop remains authoritative */ }

    const closedResults: Array<{ mint: string; poolAddress: string; success: boolean; error?: string }> = [];
    const openPositions = [...this.positions.values()];

    for (const pos of openPositions) {
      try {
        const closeCmd: ClosePositionCommand = {
          commandId: 'panic_' + pos.mint + '_' + Date.now(),
          type: 'CLOSE_POSITION',
          timestamp: Date.now(),
          initiator: cmd.initiator || 'emergency_panic_handler',
          payload: {
            mint: pos.mint,
            poolAddress: pos.asset,
            tokenQty: pos.qty,
            emergency: true,
            fallbackPriceSol: (pos.lastMark || pos.entry) / this.solPriceUsd,
            priceUsd: pos.lastMark || pos.entry,
            exitTrigger: 'EMERGENCY_UNWIND',
          },
        };
        const res = await this.handleClosePosition(closeCmd);
        closedResults.push({ mint: pos.mint, poolAddress: pos.asset, success: res.success, error: res.error });
      } catch (err: any) {
        closedResults.push({ mint: pos.mint, poolAddress: pos.asset, success: false, error: err.message });
      }
    }

    return {
      success: true,
      commandId: cmd.commandId,
      timestamp: Date.now(),
      data: {
        totalPositionsTargeted: openPositions.length,
        closedCount: closedResults.filter(r => r.success).length,
        results: closedResults,
        entriesHalted: true,
      },
      stateVersion: this.stateVersion,
    };
  }

  public getLearningSnapshot(): AdaptiveLearningSnapshot {
    return globalTradeLearningService.getSnapshot();
  }
}

export const globalCommandGateway = CommandGateway.getInstance();



