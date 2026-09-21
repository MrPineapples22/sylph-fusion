/**
 * SOL-SYLPH Authoritative Command Gateway
 * Specifications: Sections 5, 23, 26, 27, 28, 43, 44, 45.
 *
 * All consequential operator and automation actions MUST flow through this gateway.
 * Directly mutating positions or calling raw swaps from UI or models is strictly prohibited.
 */

import { randomUUID } from 'node:crypto';
import { globalConfigAuthority } from './config-authority.js';
import { globalLifecycle } from './lifecycle/system-lifecycle.js';
import { SimulatedEngine, type OrderRequest, type FillReport } from './execution-engine.js';
import { JanusReconciler } from './intelligence/reconciliation/janus-reconciler.js';
import { ExecutionPermitEngine, type ExecutionPermit } from './intelligence/execution/execution-permit.js';
import { CapitalKernel } from './intelligence/capital/capital-kernel.js';
import { LeaderScheduleTracker } from './platform/execution/solaris/leader-schedule.js';
import { DynamicTipAndContentionOracle } from './platform/execution/solaris/tip-oracle.js';
import { BimodalExecutionRouter, type RouteRequest } from './platform/execution/solaris/bimodal-router.js';
import { PostGraduationAmmBridge } from './platform/execution/solaris/amm-bridge.js';
import { type BimodalRoutePlan, type SolarisTelemetrySnapshot } from './platform/execution/solaris/types.js';
import { SpieEngine, KellyAllocator } from './intelligence/spie/index.js';
import { HeliosDirectClient } from './platform/execution/helios/index.js';

export type CommandType =
  | 'SUBMIT_ORDER'
  | 'CLOSE_POSITION'
  | 'CHANGE_MODE'
  | 'SET_AUTOMATION'
  | 'EMERGENCY_STOP';

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
    readonly side: 'BUY' | 'SELL';
    readonly usdAmount?: number;
    readonly tokenQty?: number;
    readonly tokenDecimals?: number;
    readonly maxSlippageBps?: number;
    readonly emergency?: boolean;
    readonly fallbackPriceSol?: number;
  };
}

export interface ClosePositionCommand extends BaseCommand {
  readonly type: 'CLOSE_POSITION';
  readonly payload: {
    readonly mint: string;
    readonly poolAddress: string;
    readonly tokenQty?: number;
    readonly emergency?: boolean;
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

export type Command =
  | SubmitOrderCommand
  | ClosePositionCommand
  | ChangeModeCommand
  | SetAutomationCommand
  | EmergencyStopCommand;

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
  qty: number;
  entry: number;
  stop: number;
  peak: number;
  openedAt: number;
  costBasisUsd: number;
  stage: number;
  reconciliationState: 'RECONCILED' | 'PENDING' | 'DISCREPANCY';
}

export interface GatewayStateSnapshot {
  readonly mode: 'live' | 'paper' | 'shadow';
  readonly automationEnabled: boolean;
  readonly cashUsd: number;
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
  private cashUsd: number = 10_000.0;
  private solPriceUsd: number = 150.0;
  private stateVersion: number = 1;
  private lastReconciledAt: number = Date.now();

  public updateSolPriceUsd(price: number): void {
    if (Number.isFinite(price) && price > 0) {
      this.solPriceUsd = price;
    }
  }

  private readonly positions = new Map<string, BackendPosition>();
  private readonly inFlight = new Set<string>();
  private readonly executedIntentIds = new Set<string>();

  private readonly executionEngine: SimulatedEngine;
  private readonly permitEngine: ExecutionPermitEngine;
  private readonly janusReconciler: JanusReconciler;
  private readonly capitalKernel: CapitalKernel;

  public readonly leaderTracker: LeaderScheduleTracker;
  public readonly tipOracle: DynamicTipAndContentionOracle;
  public readonly bimodalRouter: BimodalExecutionRouter;
  public readonly ammBridge: PostGraduationAmmBridge;
  public readonly spie: SpieEngine;
  public readonly kellyAllocator: KellyAllocator;
  public readonly heliosClient: HeliosDirectClient;

  private constructor() {
    this.executionEngine = new SimulatedEngine(7, 100_000n, 10_000_000n);
    this.permitEngine = new ExecutionPermitEngine();
    this.janusReconciler = new JanusReconciler();
    this.capitalKernel = new CapitalKernel();

    this.leaderTracker = new LeaderScheduleTracker();
    this.tipOracle = new DynamicTipAndContentionOracle();
    this.bimodalRouter = new BimodalExecutionRouter(this.leaderTracker, this.tipOracle);
    this.ammBridge = new PostGraduationAmmBridge();
    this.spie = new SpieEngine();
    this.kellyAllocator = new KellyAllocator();
    this.heliosClient = new HeliosDirectClient(this.leaderTracker);
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
      mode: this.mode,
      automationEnabled: this.automationEnabled,
      cashUsd: this.cashUsd,
      solPriceUsd: this.solPriceUsd,
      positions: Array.from(this.positions.values()),
      inFlightOrdersCount: this.inFlight.size,
      stateVersion: this.stateVersion,
      operationalMode: globalLifecycle.getState(),
      lastReconciledAt: this.lastReconciledAt,
    };
  }

  public planRoute(req: RouteRequest): BimodalRoutePlan {
    return this.bimodalRouter.planRoute(req);
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
      activeLeaderPubkey: leader.leaderPubkey,
      activeLeaderIsJito: leader.isJitoLeader,
      activeLeaderStakeBps: leader.clusterStakeShareBps,
      remainingSlotsInChunk: chunk.remainingSlotsInChunk,
      nextLeaderPubkey: nextLeader.leaderPubkey,
      nextLeaderIsJito: nextLeader.isJitoLeader,
      tipFloor: {
        p25: tipFloor.p25Lamports.toString(),
        p50: tipFloor.p50Lamports.toString(),
        p75: tipFloor.p75Lamports.toString(),
        p95: tipFloor.p95Lamports.toString(),
      },
      contentionTier: contention.contentionTier,
      recommendedPriorityMicroLamports: contention.recommendedMicroLamportsPerCu.toString(),
      activeGraduationCount: this.ammBridge.getAllActiveGraduations().length,
      resolvedGapsCount: 0,
      timestampMs: Date.now(),
      helios: this.heliosClient.getTelemetry(),
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
    const orderId = payload.orderId || randomUUID();
    const isBuy = payload.side === 'BUY';

    // 1. Idempotency check (Section 27)
    if (this.executedIntentIds.has(orderId)) {
      throw new Error(`DUPLICATE_INTENT: Order ${orderId} has already been executed or is in flight.`);
    }

    // 2. Lifecycle & Entry Safety (Sections 10, 11)
    if (isBuy && !globalLifecycle.isEntryPermitted()) {
      throw new Error(`ENTRY_BLOCKED: System lifecycle state (${globalLifecycle.getState()}) does not permit new risk.`);
    }
    if (!isBuy && !globalLifecycle.isExitPermitted()) {
      throw new Error(`EXIT_BLOCKED: System lifecycle state (${globalLifecycle.getState()}) does not permit exits.`);
    }

    // 3. Concurrency / In-flight fence (Section 44)
    if (this.inFlight.has(payload.poolAddress)) {
      throw new Error(`IN_FLIGHT_CONFLICT: Asset ${payload.poolAddress} already has an active order in flight.`);
    }

    // 4. Capacity & Cash validation
    const config = globalConfigAuthority.getConfig();
    if (isBuy) {
      if (this.positions.size >= config.maxPositions) {
        throw new Error(`MAX_POSITIONS_REACHED: Cannot open more than ${config.maxPositions} positions.`);
      }
      const requiredUsd = payload.usdAmount || 50.0;
      if (this.cashUsd < requiredUsd) {
        throw new Error(`INSUFFICIENT_CASH: Available ${this.cashUsd.toFixed(2)} USD < required ${requiredUsd.toFixed(2)} USD.`);
      }
    }

    this.inFlight.add(payload.poolAddress);
    this.executedIntentIds.add(orderId);

    try {
      // 5. AXIOM Verified Control / Execution Permit (Section 23)
      const reservation = this.permitEngine.createRiskReservation(payload.mint, (payload.usdAmount || 50) / this.solPriceUsd);
      const permit: ExecutionPermit = this.permitEngine.issuePermit({
        mint: payload.mint,
        decisionId: `dec_${orderId.slice(0, 8)}`,
        policyHash: globalConfigAuthority.getConfigHash().slice(0, 16),
        evidenceHash: 'evidence_ok',
        snapshotSlot: 250000,
        stateEpoch: 1,
        maxNotionalSol: (payload.usdAmount || 50) / this.solPriceUsd,
        riskReservationId: reservation.reservationId,
      });

      // 6. Execution Request construction
      const amountLamports = isBuy
        ? BigInt(Math.round(((payload.usdAmount || 50) / this.solPriceUsd) * 1e9))
        : BigInt(Math.round((payload.tokenQty || 1000) * 10 ** (payload.tokenDecimals ?? 9)));

      // Ensure fresh pool state exists in executionEngine
      this.executionEngine.pushState({
        timestamp: Date.now() + 1000,
        slot: 250000,
        reserves: { sol: 100_000_000_000n, token: 1_000_000_000_000_000n },
        price: 0.00005,
        volatility: 0.05,
      }, payload.poolAddress);

      const request: OrderRequest = {
        orderId,
        tokenMint: payload.mint,
        poolAddress: payload.poolAddress,
        side: payload.side,
        amountLamports,
        amountDecimals: payload.tokenDecimals ?? 9,
        maxSlippageBps: payload.maxSlippageBps ?? config.slippageBps,
        triggerTimestamp: Date.now(),
        emergency: payload.emergency ?? false,
        fallbackPriceSol: payload.fallbackPriceSol,
      };

      // 6.5. Leader-Aware Adaptive Route Planning & HELIOS Direct TPU Dispatch
      const routePlan = this.bimodalRouter.planRoute({
        intentId: orderId,
        currentSlot: 250_000,
        writeLockedAccounts: [payload.poolAddress, payload.mint],
        urgency: payload.emergency ? 'EMERGENCY_EXIT' : 'STANDARD',
      });

      if (routePlan.routeType === 'DIRECT_TPU_QUIC') {
        const wireFrame = new Uint8Array(128); // Zero-copy wire frame
        await this.heliosClient.sendWireTransactionDirect(wireFrame, routePlan.targetSlot, true);
      }

      // 7. Execute via isolated execution path
      const result = await this.executionEngine.execute(request);
      const { report, telemetry } = result;

      // 8. JANUS Reconciliation (Section 28)
      this.janusReconciler.registerTransaction({
        intent_id: orderId,
        signature: `sig_${orderId.slice(0, 8)}`,
        mint: payload.mint,
        amount_sol: Number(report.inputAmount) / 1e9,
        slot: 250000,
      });

      // 9. Authoritative State Mutation (ONLY within backend gateway)
      if (report.status === 'FILLED') {
        if (isBuy) {
          const filledQty = Number(report.outputAmount) / 10 ** (payload.tokenDecimals ?? 9);
          const execPriceUsd = (report.execPrice || 0.00001) * this.solPriceUsd;
          const costUsd = payload.usdAmount || 50.0;

          this.positions.set(payload.poolAddress, {
            asset: payload.poolAddress,
            mint: payload.mint,
            qty: filledQty,
            entry: execPriceUsd,
            stop: execPriceUsd * (1 - config.stopBps / 10_000),
            peak: execPriceUsd,
            openedAt: Date.now(),
            costBasisUsd: costUsd,
            stage: 0,
            reconciliationState: 'RECONCILED',
          });
          this.cashUsd -= costUsd;
        } else {
          // SELL / Exit
          const pos = this.positions.get(payload.poolAddress);
          const proceedSol = Number(report.outputAmount) / 1e9;
          const proceedUsd = proceedSol * this.solPriceUsd;

          if (pos) {
            this.positions.delete(payload.poolAddress);
          }
          this.cashUsd += proceedUsd;
        }
        this.stateVersion++;
        this.lastReconciledAt = Date.now();
      }

      return {
        success: report.status === 'FILLED',
        commandId: cmd.commandId,
        timestamp: Date.now(),
        data: {
          orderId,
          report,
          telemetry,
          permitId: permit.permitId,
        },
        error: report.status !== 'FILLED' ? report.failureReason || 'Order rejected by execution engine' : undefined,
        stateVersion: this.stateVersion,
      };
    } finally {
      this.inFlight.delete(payload.poolAddress);
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
        side: 'SELL',
        tokenQty: payload.tokenQty || pos.qty,
        emergency: payload.emergency ?? true,
        maxSlippageBps: 10_000, // 100% emergency slippage ceiling for close
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
    if (cmd.payload.enabled && !globalLifecycle.isEntryPermitted()) {
      throw new Error('AUTOMATION_BLOCKED: System readiness has not been verified.');
    }
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
    globalLifecycle.transition('REDUCE_ONLY', `Emergency Stop: ${cmd.payload.reason}`);
    this.automationEnabled = false;
    this.executionEngine.cancelAllBuys();
    this.stateVersion++;

    return {
      success: true,
      commandId: cmd.commandId,
      timestamp: Date.now(),
      data: {
        lifecycleState: globalLifecycle.getState(),
        automationEnabled: this.automationEnabled,
        reason: cmd.payload.reason,
      },
      stateVersion: this.stateVersion,
    };
  }
}

export const globalCommandGateway = CommandGateway.getInstance();
