import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, type Server } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Keypair, PublicKey } from '@solana/web3.js';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { config, type Config } from './config.js';
import { exitDecision, log, mulBps, settle, recordFailure, recordEquity, pruneRiskState, recordResult, recentEvents, type State, type Position, type Pending } from './core.js';
import { startDashboard } from './dashboard.js';
import { RpcPool } from './rpc.js';
import { Feed, type MarketEvent } from './feed.js';
import { Market, type Snapshot } from './market.js';
import { Executor } from './execution.js';
import { type ExecutionAuthority, SimulationExecutionAuthority, LiveExecutionAuthority, simulationExecutionCosts, simulationSellProceeds } from './platform/execution/authority.js';
import { Store } from './store.js';
import { strategyStatuses } from './strategy.js';
import { SessionLogger } from './session-logger.js';
import { ExecutionRegretEngine } from './intelligence/forensics/counterfactual-regret-store.js';
import { AutomaticFalsificationAgent } from './platform/adversarial/automatic-falsification-agent.js';
import {
  buildCandidateSnapshot,
  buildOutcomeLabel,
  deterministicCandidateId,
  executeModelGate,
  saltHashWallet,
  type EvaluationDisposition,
  type CandidateFeatureSnapshotV1,
  type CandidateModelEvaluator,
  type ModelGateDecision,
} from './candidate-snapshot.js';

type Candidate = {
  mint: string;
  /** Economic developer identity from the create event, never the launch user. */
  creator: string;
  launchUser: string | null;
  creationSlot: number;
  creationSignature: string;
  candidateGenerationId: string;
  chainCreatedAtMs: number | null;
  firstObservedAtMs: number;
  born: number;
  slot: number;
  eventSignature?: string;
  buyers: Map<string, number>;
  buy: bigint;
  sell: bigint;
  buyCount?: number;
  sellCount?: number;
  devSold: boolean;
  next: number;
  curve?: {
    complete: boolean;
    realQuoteReserves: string;
    virtualTokenReserves: string;
    virtualQuoteReserves: string;
    isHolderReward: boolean;
    isMayhemMode: boolean;
  };
  drift?: {
    passed: boolean;
    priceDriftBps: number;
    liquidityDropBps: number;
    driftBps: number;
    direction: string;
    reason?: string;
  };
  lastSnapshotSlot?: number;
  lastSnapshotDisposition?: EvaluationDisposition;
};
export type ReserveDriftResult = {
  passed: boolean;
  priceDriftBps: bigint;
  liquidityDropBps: bigint;
  driftBps?: bigint;
  direction?: 'none' | 'up' | 'down';
  reason?: 'CURVE_COMPLETED' | 'ZERO_RESERVES' | 'EXCESSIVE_PRICE_DRIFT' | 'EXCESSIVE_LIQUIDITY_DROP';
};
const reserveBigInt = (value: unknown) => BigInt(typeof (value as any)?.toString === 'function' ? (value as any).toString() : String(value));
function candidateEvaluationRetryDelayMs(reason: string, maxAgeMs: number): number {
  const normalized = reason.toLowerCase();
  if (/rug report rejected|unsafe token extension|creator concentration|creator sol balance below minimum|active authority|unsupported .*curve mode|only native sol curves|unsupported mint owner|invalid mint/.test(normalized)) {
    // These properties do not become safe by immediately re-querying the same
    // candidate. Let this launch generation expire before considering it again.
    return maxAgeMs + 1;
  }
  if (/429|rate.?limit|all rpc endpoints failed|timeout|fetch failed|temporarily unavailable|connection reset|http 5\d\d/.test(normalized)) {
    return Math.min(30_000, maxAgeMs);
  }
  if (/insufficient real reserves|fee cap exceeded|entry impact exceeds cap/.test(normalized)) {
    return Math.min(30_000, maxAgeMs);
  }
  return Math.min(30_000, maxAgeMs);
}
function meetsBuySellFlow(buy: bigint, sell: bigint, minimumRatioBps: number): boolean {
  return buy * 10_000n > sell * BigInt(minimumRatioBps);
}
function isRetryableSafetyObservationError(reason: string): boolean {
  return /429|rate.?limit|all rpc endpoints failed|timeout|operation was aborted|fetch failed|temporarily unavailable|connection reset|http 5\d\d|rpc rejected request|missing holder account|unknown holder distribution/i.test(reason);
}
export function checkCandidateReserveDrift(
  s1: Snapshot,
  s2: Snapshot,
  maxPriceDriftBps = 200n,
  maxLiquidityDropBps = 200n
): ReserveDriftResult {
  if (s1.curve.complete || s2.curve.complete) return { passed: false, priceDriftBps: 0n, liquidityDropBps: 0n, driftBps: 0n, direction: 'none', reason: 'CURVE_COMPLETED' };
  const r1 = reserveBigInt(s1.curve.realQuoteReserves), r2 = reserveBigInt(s2.curve.realQuoteReserves);
  const v1Quote = reserveBigInt(s1.curve.virtualQuoteReserves), v1Token = reserveBigInt(s1.curve.virtualTokenReserves);
  const v2Quote = reserveBigInt(s2.curve.virtualQuoteReserves), v2Token = reserveBigInt(s2.curve.virtualTokenReserves);
  if (r1 <= 0n || r2 <= 0n || v1Quote <= 0n || v2Quote <= 0n || v1Token <= 0n || v2Token <= 0n) {
    return { passed: false, priceDriftBps: 0n, liquidityDropBps: 0n, driftBps: 0n, direction: 'none', reason: 'ZERO_RESERVES' };
  }
  let liquidityDropBps = 0n;
  if (r2 < r1) {
    liquidityDropBps = (r1 - r2) * 10_000n / r1;
    if (liquidityDropBps > maxLiquidityDropBps) {
      return { passed: false, priceDriftBps: 0n, liquidityDropBps, driftBps: liquidityDropBps, direction: 'down', reason: 'EXCESSIVE_LIQUIDITY_DROP' };
    }
  }
  const p1 = (v1Quote * 1_000_000_000_000n) / v1Token;
  const p2 = (v2Quote * 1_000_000_000_000n) / v2Token;
  let priceDriftBps = 0n;
  if (p2 > p1) {
    priceDriftBps = (p2 - p1) * 10_000n / p1;
    if (priceDriftBps > maxPriceDriftBps) {
      return { passed: false, priceDriftBps, liquidityDropBps, driftBps: priceDriftBps, direction: 'up', reason: 'EXCESSIVE_PRICE_DRIFT' };
    }
  }
  const direction = p2 > p1 ? 'up' : r2 < r1 ? 'down' : 'none';
  const driftBps = direction === 'up' ? priceDriftBps : direction === 'down' ? liquidityDropBps : 0n;
  return { passed: true, priceDriftBps, liquidityDropBps, driftBps, direction };
}
export class Engine {
  private candidates = new Map<string, Candidate>();
  private stopped = false;
  private lastHealth = 0;
  private cursor = 0;
  private marks = new Map<string, { value: string; at: number }>();
  private startedAt = Date.now();
  private loopLag = monitorEventLoopDelay({ resolution: 20 });
  private entryBuildInFlight = false;
  private nextSafetyScanAt = 0;
  private nextCounterfactualScanAt = 0;
  private counterfactualObservations = new Map<string, {
    samples: number; attempts: number; nextAt: number;
    shadowEntry?: { tokenQty: string; costLamports: string };
    shadowGateStatus?: string; shadowGateReason?: string;
    shadowSafetyStatus?: string; shadowSafetyReason?: string;
    shadowDriftStatus?: string; shadowDriftReason?: string;
  }>();
  rejectionCounts = new Map<string, number>();
  private blockedExits = new Map<string, { blockedAt: number; reason: string; triggerValue: bigint; stage: number }>();
  private lastCheckpoint = Date.now();
  readonly feed: Feed;
  constructor(
    readonly cfg: Config,
    readonly rpc: RpcPool,
    readonly market: Market,
    readonly executor: ExecutionAuthority | Executor,
    readonly store: Store,
    readonly state: State,
    readonly sessionLogger?: SessionLogger,
    readonly modelEvaluator?: CandidateModelEvaluator,
    readonly gateMode: 'ml_gated' | 'shadow' | 'deterministic_only' = modelEvaluator ? 'ml_gated' : 'deterministic_only'
  ) {
    this.feed = new Feed(cfg, rpc.connection, e => this.onEvent(e));
  }
  private persistResearchJournal(
    method: 'saveCounterfactualEvaluation' | 'saveFalsificationReport',
    record: Record<string, unknown>,
    recordId: string
  ): void {
    // Research evidence is useful but cannot change a paper fill or exit.
    // Older injected Store implementations may have only the core state API.
    const failed = (reason: 'method_unavailable' | 'write_rejected') => {
      try {
        this.sessionLogger?.writeEvent('research_journal_persist_failed', { journal: method, recordId, reason });
      } catch {
        // A broken telemetry sink cannot become a trading decision gate either.
      }
    };
    const save = this.store?.[method];
    if (typeof save !== 'function') {
      failed('method_unavailable');
      return;
    }
    try {
      void Promise.resolve(save.call(this.store, record)).catch(() => failed('write_rejected'));
    } catch {
      failed('write_rejected');
    }
  }
  snapshotCandidate(
    candidate: Candidate,
    disposition: EvaluationDisposition,
    reason: string | null = null,
    extra: {
      curve?: Candidate['curve'];
      drift?: Candidate['drift'];
      realReserveSol?: number;
      s?: Snapshot;
      modelDecision?: ModelGateDecision;
    } = {}
  ): CandidateFeatureSnapshotV1 | null {
    if (!this.sessionLogger) return null;
    const now = Date.now();
    const observedAtMs = candidate.born;
    const decisionAtMs = Math.max(now, observedAtMs);

    const curveData = extra.curve || candidate.curve || (extra.s ? {
      complete: extra.s.curve.complete,
      realQuoteReserves: extra.s.curve.realQuoteReserves.toString(),
      virtualQuoteReserves: extra.s.curve.virtualQuoteReserves.toString(),
      virtualTokenReserves: extra.s.curve.virtualTokenReserves.toString(),
    } : undefined);

    const rpcStats = typeof (this.rpc as any)?.getEndpointStats === 'function' ? (this.rpc as any).getEndpointStats() : [];
    const primary = rpcStats[0];
    const leadingRpcLatencyMs = primary ? (primary.latencyMs ?? primary.p50LatencyMs ?? 0) : 0;
    const totalCalls = rpcStats.reduce((acc: number, s: any) => acc + (s.calls || 0), 0);
    const totalDrops = rpcStats.reduce((acc: number, s: any) => acc + (s.drops || (s.http429Count + s.errorCount) || 0), 0);
    const trailingRpcDropRatePct = totalCalls > 0 ? Number(((totalDrops / totalCalls) * 100).toFixed(2)) : 0;

    let curveCompletionPct = 0;
    if (curveData?.complete) {
      curveCompletionPct = 100.0;
    } else if (extra.s?.curve && extra.s?.global?.initialRealTokenReserves) {
      const initialTokens = BigInt(extra.s.global.initialRealTokenReserves.toString());
      const realTokens = BigInt(extra.s.curve.realTokenReserves.toString());
      if (initialTokens > 0n) {
        const sold = initialTokens > realTokens ? initialTokens - realTokens : 0n;
        curveCompletionPct = Math.min(100, Math.max(0, Number(sold * 10_000n / initialTokens) / 100));
      }
    } else if (curveData?.realQuoteReserves) {
      const realReserves = BigInt(curveData.realQuoteReserves);
      const targetReserves = extra.s?.global?.initialVirtualSolReserves
        ? BigInt(extra.s.global.initialVirtualSolReserves.toString())
        : (extra.s?.curve?.realQuoteReserves ? BigInt(extra.s.curve.realQuoteReserves.toString()) : 0n);
      if (targetReserves > 0n && realReserves > 0n) {
        curveCompletionPct = Math.min(100, Number(realReserves * 10_000n / (targetReserves + realReserves)) / 100);
      }
    }

    const vQuote = curveData?.virtualQuoteReserves ? BigInt(curveData.virtualQuoteReserves) : (extra.s ? BigInt(extra.s.curve.virtualQuoteReserves.toString()) : 0n);
    const vToken = curveData?.virtualTokenReserves ? BigInt(curveData.virtualTokenReserves) : (extra.s ? BigInt(extra.s.curve.virtualTokenReserves.toString()) : 0n);
    const spotPriceSol = (vQuote > 0n && vToken > 0n) ? Number(vQuote) / Number(vToken) : 0;
    const spotPriceUsd = (extra as any).spotPriceUsd ?? ((extra as any).solPriceUsd ? spotPriceSol * (extra as any).solPriceUsd : undefined);

    const snapshot = buildCandidateSnapshot({
      mint: candidate.mint,
      poolAddress: extra.s?.mint ? bondingCurvePda(extra.s.mint).toBase58() : candidate.mint,
      slot: candidate.slot,
      eventSignature: candidate.eventSignature || `eval-${candidate.mint}-${candidate.slot}`,
      observedAtMs,
      decisionAtMs,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: this.cfg.SLIPPAGE_BPS,
        targetSizeLamports: String(this.cfg.BUY_LAMPORTS),
        priorityFeeMultiplier: 1,
        exitLadderConfigHash: 'ladder-v1-tp20-50-100-stop8',
      },
      evaluationDisposition: disposition,
      dispositionReason: reason,
      microstructure: {
        buyerCount5m: candidate.buyers.size,
        buyTransactionCount: candidate.buyCount ?? 0,
        sellTransactionCount: candidate.sellCount ?? 0,
        buySellRatio: candidate.sell > 0n ? Number((candidate.buy * 100n) / candidate.sell) / 100 : Number(candidate.buy > 0n ? 10 : 1),
        buyerArrivalVelocityPerSec: candidate.buyers.size / Math.max(1, (now - candidate.born) / 1000),
        creatorWalletHashed: saltHashWallet(candidate.creator),
      },
      curveState: {
        tokenAgeSeconds: Math.floor((now - candidate.born) / 1000),
        realSolReservesLamports: curveData?.realQuoteReserves || (extra.s ? extra.s.curve.realQuoteReserves.toString() : '0'),
        virtualSolReservesLamports: curveData?.virtualQuoteReserves || (extra.s ? extra.s.curve.virtualQuoteReserves.toString() : '0'),
        virtualTokenReserves: curveData?.virtualTokenReserves || (extra.s ? extra.s.curve.virtualTokenReserves.toString() : '0'),
        curveCompletionPct,
        reserveDriftPct: extra.drift ? extra.drift.priceDriftBps / 100 : (candidate.drift ? candidate.drift.priceDriftBps / 100 : 0),
        spotPriceUsd,
      },
      transport: {
        quoteAgeMs: extra.s ? Math.max(0, now - extra.s.at) : 0,
        leadingRpcLatencyMs,
        trailingRpcDropRatePct,
        inFlightOrderCount: this.state.pending ? 1 : 0,
        oldestPendingAgeMs: this.state.pending ? now - this.state.pending.created : 0,
        reservedCashRatio: Number(this.cfg.RESERVE_LAMPORTS) / Math.max(1, Number(this.state.cash)),
      },
    });

    candidate.lastSnapshotSlot = candidate.slot;
    candidate.lastSnapshotDisposition = disposition;
    this.sessionLogger?.writeCandidateSnapshot?.(snapshot);
    return snapshot;
  }

  /** A denied entry is not necessarily a token-safety conclusion. */
  private recordRestriction(mint: string, scope: 'ACTOR'|'VENUE'|'MARKET'|'STRATEGY'|'PORTFOLIO'|'EXECUTION'|'MODEL'|'SYSTEM', effect: 'WAIT'|'QUARANTINE'|'BLOCK_NEW_ENTRY', reason: string, meta?: Record<string, unknown>, observed?: Snapshot) {
    if (!this.rejectionCounts) this.rejectionCounts = new Map();
    this.rejectionCounts.set(reason, (this.rejectionCounts.get(reason) ?? 0) + 1);
    const data = { mint, scope, effect, reason, ...meta };
    log('entry_restricted', data);
    this.sessionLogger?.writeEvent('entry_restricted', data);
    const c = this.candidates?.get(mint);
    if (c) this.snapshotCandidate(c, 'notEvaluated', `${scope}:${reason}`, { ...(meta as any), s: observed });
  }
  recordRejection(mint: string, reason: string, meta?: Record<string, unknown>) {
    this.recordRestriction(mint, 'PORTFOLIO', 'BLOCK_NEW_ENTRY', reason, meta);
  }
  private async sampleCounterfactualNearMiss(): Promise<void> {
    const now = Date.now();
    if (now < this.nextCounterfactualScanAt) return;
    const candidate = [...this.candidates.values()].filter(c => {
      const age = now - c.born;
      const state = this.counterfactualObservations.get(c.mint);
      const strategyMiss = c.buyers.size < this.cfg.MIN_BUYERS
        || !meetsBuySellFlow(c.buy, c.sell, this.cfg.MIN_BUY_SELL_RATIO_BPS);
      return age >= this.cfg.MIN_AGE_MS && age <= this.cfg.MAX_AGE_MS
        && c.buyers.size >= 2 && strategyMiss && !c.devSold
        && !this.state.positions[c.mint] && !this.state.closed[c.mint]
        // Follow rejected candidates through most of their 3-minute lifetime
        // so research can distinguish delayed continuation from rapid decay.
        && (!state || (state.samples < 10 && state.attempts < 10 && state.nextAt <= now));
    }).sort((a, b) => {
      // Spend scarce shadow snapshots on the nearest-to-entry candidates first:
      // buyer-qualified setups isolate the volume-ratio rule being evaluated.
      const aBuyerQualified = a.buyers.size >= this.cfg.MIN_BUYERS;
      const bBuyerQualified = b.buyers.size >= this.cfg.MIN_BUYERS;
      if (aBuyerQualified !== bBuyerQualified) return aBuyerQualified ? -1 : 1;
      if (a.buyers.size !== b.buyers.size) return b.buyers.size - a.buyers.size;
      const aRatio = a.sell > 0n ? Number(a.buy * 1000n / a.sell) : Number.POSITIVE_INFINITY;
      const bRatio = b.sell > 0n ? Number(b.buy * 1000n / b.sell) : Number.POSITIVE_INFINITY;
      return bRatio - aRatio || a.born - b.born;
    })[0];
    if (!candidate) return;

    const state = this.counterfactualObservations.get(candidate.mint) ?? { samples: 0, attempts: 0, nextAt: 0 };
    state.attempts++;
    state.nextAt = now + 15_000;
    this.counterfactualObservations.set(candidate.mint, state);
    this.nextCounterfactualScanAt = now + Math.max(10_000, this.cfg.RISK_SCAN_COOLDOWN_MS);
    try {
      // Research observation only: it does not call safety(), build an order,
      // or alter the paper ledger. The sample supports later filter analysis.
      const s = await this.market.snapshot(candidate.mint, candidate.slot);
      state.samples++;
      const strategyMisses = [
        ...(candidate.buyers.size < this.cfg.MIN_BUYERS ? ['insufficient_buyers'] : []),
        ...(!meetsBuySellFlow(candidate.buy, candidate.sell, this.cfg.MIN_BUY_SELL_RATIO_BPS) ? ['insufficient_buy_volume_ratio'] : []),
      ];
      const virtualQuote = BigInt(s.curve.virtualQuoteReserves.toString());
      const virtualToken = BigInt(s.curve.virtualTokenReserves.toString());
      if (!state.shadowGateStatus && candidate.buyers.size >= this.cfg.MIN_BUYERS && !s.curve.complete && !s.curve.isMayhemMode) {
        try {
          this.market.validateEntry(s);
          const costs = simulationExecutionCosts(this.cfg);
          const entryQuote = this.market.buyQuote(s, BigInt(this.cfg.BUY_LAMPORTS));
          state.shadowEntry = {
            tokenQty: String(mulBps(entryQuote, 10_000 - this.cfg.SLIPPAGE_BPS)),
            costLamports: String(BigInt(this.cfg.BUY_LAMPORTS) + costs.tipLamports + costs.priorityLamports + costs.baseFeeLamports + costs.ataRentLamports),
          };
          state.shadowGateStatus = 'LOCAL_ENTRY_GATES_PASS_FULL_SAFETY_UNCHECKED';
        } catch (error) {
          state.shadowGateStatus = 'LOCAL_ENTRY_GATE_REJECTED';
          state.shadowGateReason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
        }
      }
      if (state.shadowGateStatus === 'LOCAL_ENTRY_GATES_PASS_FULL_SAFETY_UNCHECKED'
        && (!state.shadowSafetyStatus || state.shadowSafetyStatus === 'UNAVAILABLE')) {
        try {
          await this.market.safety(s, candidate.creator);
          state.shadowSafetyStatus = 'PASSED';
          try {
            const confirmed = await this.market.snapshot(candidate.mint, candidate.slot);
            confirmed.creatorTokens = s.creatorTokens;
            const drift = checkCandidateReserveDrift(s, confirmed);
            state.shadowDriftStatus = drift.passed ? 'PASSED' : 'REJECTED';
            state.shadowDriftReason = drift.passed ? undefined : drift.reason;
          } catch (error) {
            state.shadowDriftStatus = 'UNAVAILABLE';
            state.shadowDriftReason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
          }
        } catch (error) {
          const reason = (error instanceof Error ? error.message : String(error)).slice(0, 120);
          state.shadowSafetyStatus = isRetryableSafetyObservationError(reason) ? 'UNAVAILABLE' : 'REJECTED';
          state.shadowSafetyReason = reason;
        }
      }
      let shadowNetPnlLamports: string | null = null;
      let shadowEquityPnlIfAtaRentReclaimedLamports: string | null = null;
      if (state.shadowEntry && virtualToken > 0n) {
        try {
          const costs = simulationExecutionCosts(this.cfg);
          const grossExit = this.market.sellQuote(s, BigInt(state.shadowEntry.tokenQty));
          const netExit = mulBps(grossExit, 10_000 - this.cfg.SLIPPAGE_BPS) - costs.tipLamports - costs.priorityLamports - costs.baseFeeLamports;
          shadowNetPnlLamports = String(netExit - BigInt(state.shadowEntry.costLamports));
          shadowEquityPnlIfAtaRentReclaimedLamports = String(BigInt(shadowNetPnlLamports) + costs.ataRentLamports);
        } catch { /* leave unavailable if the observed curve cannot quote the shadow quantity */ }
      }
      this.sessionLogger?.writeEvent('paper_shadow_market_observation', {
        candidateGenerationId: candidate.candidateGenerationId,
        mint: candidate.mint,
        sampleIndex: state.samples,
        observedAtMs: s.at,
        slot: s.slot,
        strategyMisses,
        buyerCount: candidate.buyers.size,
        buyTransactionCount: candidate.buyCount ?? 0,
        sellTransactionCount: candidate.sellCount ?? 0,
        buyLamports: String(candidate.buy),
        sellLamports: String(candidate.sell),
        realSolReservesLamports: String(s.curve.realQuoteReserves),
        virtualSolReservesLamports: String(virtualQuote),
        virtualAssetReserves: String(virtualToken),
        spotSolPerAssetUnit: virtualToken > 0n ? Number(virtualQuote) / Number(virtualToken) : null,
        mintSafetyFlagsPass: s.entrySafe,
        shadowGateStatus: state.shadowGateStatus ?? 'NOT_EVALUATED',
        shadowGateReason: state.shadowGateReason ?? null,
        creatorAndRugSafetyStatus: state.shadowSafetyStatus ?? 'NOT_CHECKED',
        creatorAndRugSafetyReason: state.shadowSafetyReason ?? null,
        reserveDriftStatus: state.shadowDriftStatus ?? 'NOT_CHECKED',
        reserveDriftReason: state.shadowDriftReason ?? null,
        shadowNetPnlLamports,
        shadowEquityPnlIfAtaRentReclaimedLamports,
        curveComplete: s.curve.complete,
        isHolderReward: s.curve.isHolderReward,
        isMayhemMode: s.curve.isMayhemMode,
      });
      if (shadowNetPnlLamports !== null) {
        const shadowCost = BigInt(state.shadowEntry?.costLamports || '1');
        const shadowNetPnl = BigInt(shadowNetPnlLamports);
        const shadowPnlBps = shadowCost > 0n ? Number((shadowNetPnl * 10_000n) / shadowCost) : 0;
        const omissionRegret = ExecutionRegretEngine.evaluateDecisionRegret({
          decisionId: `shadow_dec_${candidate.mint.slice(0, 8)}_${s.slot}`,
          opportunityId: candidate.candidateGenerationId,
          tokenId: candidate.mint,
          slot: s.slot,
          actionTaken: 'IMMEDIATE_ABSTAIN',
          expectedNetEvBps: 0,
          expectedSlippageBps: this.cfg.SLIPPAGE_BPS,
          realizedPnlBps: 0,
          realizedSlippageBps: 0,
          realizedTipLamports: 0n,
          discoveryLagMs: 100,
          peakObservedPriceBps: Math.max(0, shadowPnlBps),
          drawdownObservedPriceBps: Math.min(0, shadowPnlBps),
        });
        this.persistResearchJournal('saveCounterfactualEvaluation', omissionRegret as unknown as Record<string, unknown>, omissionRegret.evaluationId);
      }
    } catch {
      this.sessionLogger?.writeEvent('paper_shadow_market_observation_unavailable', {
        candidateGenerationId: candidate.candidateGenerationId,
        mint: candidate.mint,
        attemptIndex: state.attempts,
      });
    }
  }
  emitCheckpoint() {
    if (!this.rejectionCounts) this.rejectionCounts = new Map();
    if (!this.blockedExits) this.blockedExits = new Map();
    const uptimeMs = Date.now() - (this.startedAt || Date.now());
    const rejections = Object.fromEntries(this.rejectionCounts.entries());
    const openPositions = Object.values(this.state?.positions || {}).map(p => ({
      mint: p.mint,
      qty: p.qty,
      cost: p.cost,
      peak: p.peak,
      stage: p.stage,
      panic: p.panic,
      mark: this.marks?.get(p.mint)?.value ?? null,
    }));
    const data = {
      uptimeMs,
      uptimeHours: +(uptimeMs / 3_600_000).toFixed(2),
      feedHealthy: this.feed?.healthy?.() ?? false,
      feedLastSlot: this.feed?.slot ?? 0,
      feedLastEventAgeMs: this.feed ? Date.now() - this.feed.last : 0,
      cash: this.state?.cash,
      dayPnl: this.state?.dayPnl,
      day: this.state?.day,
      halted: this.state?.halted,
      haltReason: this.state?.risk?.haltReason ?? null,
      openPositionsCount: openPositions.length,
      openPositions,
      candidatesTracked: this.candidates?.size ?? 0,
      rejectionTaxonomy: rejections,
      blockedExitsCount: this.blockedExits.size,
      totalFills: this.state?.performance?.count ?? 0,
      realizedPnl: this.state?.performance?.realized ?? '0',
    };
    log('soak_checkpoint', data);
    this.sessionLogger?.writeEvent('soak_checkpoint', data);
  }
  stop() { this.stopped = true; this.feed.stop(); }
  private canSubmitEntry(candidate: Candidate, s: Snapshot, entryAmount: bigint, now = Date.now()) {
    return !this.stopped && !this.state.operatorPaused && !this.state.halted && this.feed.healthy() && !this.state.pending && !this.entryBuildInFlight && !candidate.devSold && now >= candidate.next && !this.state.positions[candidate.mint] && !this.state.closed[candidate.mint] && !s.curve.complete && !s.curve.isMayhemMode && entryAmount > 0n;
  }
  async setPaused(paused: boolean) {
    if (this.stopped) throw new Error('Engine is stopping');
    this.state.operatorPaused = paused;
    try { await this.store.save(this.state, paused ? 'operator-paused' : 'operator-resumed'); }
    catch (e) { this.stop(); throw e; }
    log(paused ? 'entries_paused' : 'entries_resumed');
  }
  snapshot() {
    const now = Date.now();
    const allCandidates = [...this.candidates.values()];
    const discovered = allCandidates.length;
    const aged = allCandidates.filter(c => now - c.born >= this.cfg.MIN_AGE_MS).length;
    const buyerThreshold = allCandidates.filter(c => now - c.born >= this.cfg.MIN_AGE_MS && c.buyers.size >= this.cfg.MIN_BUYERS && meetsBuySellFlow(c.buy, c.sell, this.cfg.MIN_BUY_SELL_RATIO_BPS) && !c.devSold).length;
    const safetyPassed = allCandidates.filter(c => now - c.born >= this.cfg.MIN_AGE_MS && c.buyers.size >= this.cfg.MIN_BUYERS && meetsBuySellFlow(c.buy, c.sell, this.cfg.MIN_BUY_SELL_RATIO_BPS) && !c.devSold && c.curve && !c.curve.complete).length;
    const driftPassed = allCandidates.filter(c => c.drift && c.drift.passed).length;
    const eligible = allCandidates.filter(c => c.drift?.passed && c.curve && !c.curve.complete && !c.devSold && this.feed.healthy() && !this.stopped && !this.state.operatorPaused && !this.state.halted).length;
    const paperFilled = this.state.performance?.count ?? 0;

    return {
      performance: this.state.performance ?? null, connected: true,
      mode: this.cfg.MODE, demo: false, wallet: this.state.wallet, time: Date.now(), startedAt: this.startedAt,
      paused: !!this.state.operatorPaused, halted: this.state.halted, stopping: this.stopped,
      feed: { healthy: this.feed.healthy(), last: this.feed.last, slot: this.feed.slot },
      rpcEndpoints: typeof (this.rpc as any)?.getEndpointStats === 'function' ? (this.rpc as any).getEndpointStats() : [],
      cash: this.state.cash, dayPnl: this.state.dayPnl, day: this.state.day,
      funnel: {
        discovered,
        aged,
        buyerThreshold,
        safetyPassed,
        driftPassed,
        eligible,
        paperFilled,
      },
      positions: Object.values(this.state.positions).map(p => {
        const mark = this.marks.get(p.mint) ?? null;
        const currentValue = mark ? mark.value : null;
        const unrealizedPnl = mark ? String(BigInt(mark.value) - BigInt(p.cost)) : null;
        const peakMultiple = BigInt(p.cost) > 0n && p.peak ? (Number(p.peak) / Number(p.cost)).toFixed(2) : '1.00';
        return {
          mint: p.mint,
          qty: p.qty,
          initialQty: p.initialQty,
          cost: p.cost,
          currentValue,
          unrealizedPnl,
          stage: p.stage,
          peak: p.peak,
          peakMultiple,
          opened: p.opened,
          panic: p.panic,
          reserve: p.reserve,
          creator: p.creator,
          creatorTokens: p.creatorTokens,
          mark,
        };
      }),
      pending: this.state.pending ? { mint: this.state.pending.mint, side: this.state.pending.side, signature: this.state.pending.signature, created: this.state.pending.created, reason: this.state.pending.reason } : null,
      candidates: [...this.candidates.values()].slice(-50).reverse().map(c => ({
        mint: c.mint,
        age: Date.now() - c.born,
        buyers: c.buyers.size,
        devSold: c.devSold,
        curve: c.curve ?? null,
        drift: c.drift ?? null,
      })),
      limits: { positions: this.cfg.MAX_POSITIONS, exposure: String(this.cfg.MAX_EXPOSURE_LAMPORTS), dailyLoss: String(this.cfg.MAX_DAILY_LOSS_LAMPORTS), buy: String(this.cfg.BUY_LAMPORTS), riskBps: this.cfg.MAX_SPECULATIVE_RISK_BPS, rollingDrawdownBps: this.cfg.ROLLING_DRAWDOWN_BPS, failureHaltCount: this.cfg.FAILURE_HALT_COUNT, slippage: this.cfg.SLIPPAGE_BPS, stop: this.cfg.STOP_BPS, tip: String(this.cfg.MAX_TIP_LAMPORTS), priority: String(this.cfg.MAX_PRIORITY_LAMPORTS) },
      risk: { failures: this.state.risk?.failures?.length ?? 0, highWater: this.state.risk?.highWater ?? this.state.cash, lifetimePeak: this.state.risk?.lifetimePeak ?? (this.state.risk?.highWater ?? this.state.cash), haltReason: this.state.risk?.haltReason ?? null },
      strategies: strategyStatuses(),
      events: recentEvents.slice().reverse(),
    };
  }
  private onEvent(e: MarketEvent) {
    const d = e.data, name = e.name.replaceAll('_', '').toLowerCase();
    const mint = d.mint?.toBase58?.();
    if (!mint) return;
    if (name === 'createevent' && !this.candidates.has(mint)) {
      // Pump's launch user and creator are distinct roles.  Using `user` here
      // turns a first buyer into the developer and fabricates later dump risk.
      const creator = d.creator?.toBase58?.() ?? '';
      const launchUser = d.user?.toBase58?.() ?? null;
      const chainTime = Number(d.timestamp?.toString()) * 1000;
      if (!Number.isFinite(chainTime) || chainTime > e.received + 10_000 || e.received - chainTime > this.cfg.MAX_AGE_MS) return;
      if (this.candidates.size >= this.cfg.MAX_TRACKED) this.candidates.delete(this.candidates.keys().next().value!);
      this.candidates.set(mint, {
        mint, creator, launchUser,
        creationSlot: e.slot, creationSignature: e.signature,
        candidateGenerationId: deterministicCandidateId(mint, e.slot, e.signature),
        chainCreatedAtMs: Number.isFinite(chainTime) ? chainTime : null,
        firstObservedAtMs: e.received,
        born: Number.isFinite(chainTime) ? chainTime : e.received,
        slot: e.slot, eventSignature: e.signature, buyers: new Map(), buy: 0n, sell: 0n,
        buyCount: 0, sellCount: 0, devSold: false, next: 0,
      });
    }
    if (name === 'tradeevent') {
      const user = d.user?.toBase58?.(), p = this.state.positions[mint], c = this.candidates.get(mint);
      if (d.isBuy === false && user && p?.creator === user) { p.panic = true; log('creator_sell_detected', { mint }); }
      if (c) {
        // Do not discard an otherwise valid late event.  The feed journal, not
        // arrival order, owns canonical ordering and replay.
        if (e.slot >= c.slot) { c.slot = e.slot; c.eventSignature = e.signature; }
        if (!d.isBuy && user === c.creator) c.devSold = true;
        const amount = BigInt((d.solAmount ?? d.quoteAmount ?? 0).toString());
        if (amount < 0n) return;
        if (d.isBuy) {
          c.buy += amount;
          c.buyCount = (c.buyCount || 0) + 1;
          if (user && user !== c.creator && c.buyers.size < 1000) c.buyers.set(user, e.received);
        } else {
          c.sell += amount;
          c.sellCount = (c.sellCount || 0) + 1;
        }
      }
    }
  }
  async run() {
    this.loopLag.enable();
    const feedTask = this.feed.run().catch(() => { log('feed_fatal'); this.stop(); });
    try {
      while (!this.stopped) {
        const started = Date.now();
        await this.tick();
        if (Date.now() - this.lastHealth > 30_000) {
          this.lastHealth = Date.now();
          log('health', { feedFresh: this.feed.healthy(), positions: Object.keys(this.state.positions).length, pending: this.state.pending?.signature ?? null,
            entriesHalted: this.state.halted, candidates: this.candidates.size, eventLoopP99Ms: Math.round(this.loopLag.percentile(99) / 1e6) });
          this.loopLag.reset();
        }
        if (Date.now() - this.lastCheckpoint >= this.cfg.CHECKPOINT_INTERVAL_MS) {
          this.lastCheckpoint = Date.now();
          this.emitCheckpoint();
        }
        if (!this.stopped) await delay(Math.max(10, this.cfg.POLL_MS - (Date.now() - started)));
      }
    } finally {
      this.feed.stop();
      await feedTask;
      this.loopLag.disable();
      for (const p of Object.values(this.state.positions)) {
        const markValue = this.marks.get(p.mint)?.value ?? p.cost;
        this.sessionLogger?.writeOutcomeLabel?.(buildOutcomeLabel({
          candidateId: p.candidateId || `pos-${p.mint}`,
          mint: p.mint,
          entrySnapshotSlot: p.entrySlot || 0,
          censored: true,
          censoringReason: 'session_terminated',
          observationDurationMs: Date.now() - p.opened,
          costBasisLamports: p.cost,
          grossProceedsLamports: markValue,
          dexImpactLamports: 0n,
          priorityFeeLamports: 0n,
          jitoTipLamports: 0n,
          ataRentLamports: 0n,
          maximumFavorableExcursionPct: p.mfePct,
          maximumAdverseExcursionPct: p.maePct,
          exitStage: p.stage,
        }));
      }
      await this.sessionLogger?.close();
      await this.store.save(this.state, 'shutdown');
    }
  }
  private async tick() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.state.day !== today) { this.state.day = today; this.state.dayPnl = '0'; }
    for (const [mint, c] of this.candidates) {
      if (Date.now() - c.born > this.cfg.MAX_AGE_MS) {
        this.snapshotCandidate(c, 'notEvaluated', 'max_age_expired');
        this.candidates.delete(mint);
        this.counterfactualObservations.delete(mint);
      }
    }
    for (const [mint, at] of Object.entries(this.state.closed)) if (Date.now() - at > 86_400_000) delete this.state.closed[mint];
    if (this.state.pending) {
      const pending = this.state.pending;
      for (const p of Object.values(this.state.positions)) {
        const mark = this.marks.get(p.mint);
        if (mark) {
          const exit = exitDecision(p, BigInt(mark.value), this.cfg.STOP_BPS);
          if (exit && !this.blockedExits.has(p.mint)) {
            this.blockedExits.set(p.mint, {
              blockedAt: Date.now(),
              reason: exit.reason,
              triggerValue: BigInt(mark.value),
              stage: exit.stage,
            });
            const blockedData = {
              mint: p.mint,
              reason: exit.reason,
              stage: exit.stage,
              pendingMint: pending.mint,
              pendingSide: pending.side,
              pendingAgeMs: Date.now() - pending.created,
            };
            log('exit_blocked_by_pending', blockedData);
            this.sessionLogger?.writeEvent('exit_blocked_by_pending', blockedData);
          }
        }
      }
      const order = this.state.pending;
      const posBefore = this.state.positions[order.mint];
      const posQty = posBefore ? BigInt(posBefore.qty) : 0n;
      const posCost = posBefore ? BigInt(posBefore.cost) : 0n;
      const isSell = order.side === 'sell';
      const result = await this.executor.reconcile(order);
      if (result.status === 'filled') {
        const tokensSold = isSell ? -result.tokenDelta : 0n;
        const isFullExit = isSell && posBefore && (tokensSold >= posQty || posQty === 0n);
        const allocatedCost = (isSell && posBefore && posQty > 0n)
          ? (isFullExit ? posCost : (posCost * tokensSold) / posQty)
          : 0n;

        settle(this.state, result.tokenDelta, result.solDelta);
        if (order.side === 'buy') {
          const p = this.state.positions[order.mint];
          if (p) {
            const c = this.candidates.get(order.mint);
            p.candidateId = c ? c.candidateGenerationId : `order-${order.signature}`;
            p.entrySlot = c?.slot || this.feed.slot;
          }
          if (this.candidates.get(order.mint)?.devSold) this.state.positions[order.mint].panic = true;
        } else if (order.side === 'sell') {
          const grossProceeds = result.solDelta > 0n ? result.solDelta : 0n;
          this.sessionLogger?.writeOutcomeLabel(buildOutcomeLabel({
            candidateId: posBefore?.candidateId || `order-${order.signature}`,
            mint: order.mint,
            entrySnapshotSlot: posBefore?.entrySlot || 0,
            censored: false,
            observationDurationMs: posBefore ? Date.now() - posBefore.opened : 0,
            costBasisLamports: allocatedCost.toString(),
            grossProceedsLamports: grossProceeds.toString(),
            dexImpactLamports: 0n,
            priorityFeeLamports: 0n,
            jitoTipLamports: 0n,
            ataRentLamports: 0n,
            maximumFavorableExcursionPct: posBefore?.mfePct,
            maximumAdverseExcursionPct: posBefore?.maePct,
            exitStage: order.stage,
          }));
        }
        await this.store.save(this.state, `filled:${order.signature}`);
        const fillData = { mint: order.mint, side: order.side, signature: order.signature, tokenDelta: String(result.tokenDelta), netLamports: String(result.solDelta), reason: order.reason, stage: order.stage };
        log('fill_finalized', fillData);
        this.sessionLogger?.writeEvent('fill_finalized', fillData);
      } else if (result.status === 'expired' || result.status === 'failed') {
        if (result.status === 'failed') {
          recordResult(this.state, order.mint, 'failed', order.signature, -(result.fee ?? 0n), -(result.fee ?? 0n));
          recordFailure(this.state, Date.now(), this.cfg.FAILURE_WINDOW_MS, this.cfg.FAILURE_HALT_COUNT);
          this.state.dayPnl = String(BigInt(this.state.dayPnl) - (result.fee ?? 0n)); this.state.cash = String(BigInt(this.state.cash) - (result.fee ?? 0n));
        }
        if (result.status === 'expired' && this.cfg.MODE === 'live') {
          // Block both entries and automated exits: block-height expiry proves only
          // that this wire can no longer land, not that wallet/ledger state agrees.
          this.state.halted = true;
          this.state.risk ??= { failures: [], equity: [], highWater: this.state.cash };
          this.state.risk.haltReason = 'LIVE_RECONCILIATION_UNRESOLVED';
          this.state.reconciliationBlocked = {
            signature: order.signature,
            mint: order.mint,
            side: order.side,
            lastValidBlockHeight: order.lastValidBlockHeight,
            detectedAt: Date.now(),
            reason: 'LIVE_RECONCILIATION_UNRESOLVED',
          };
          const unresolved = { ...this.state.reconciliationBlocked };
          log('live_reconciliation_unresolved', unresolved);
          this.sessionLogger?.writeEvent('live_reconciliation_unresolved', unresolved);
        }
        this.state.pending = null;
        await this.store.save(this.state, `${result.status}:${order.signature}`);
        const termData = { signature: order.signature, status: result.status, mint: order.mint };
        log('order_terminal', termData);
        this.sessionLogger?.writeEvent('order_terminal', termData);
      } else await this.persistAndBroadcast(order);
      return;
    }
    const positions = Object.values(this.state.positions);
    // Snapshot reads run concurrently; all economic state transitions have one writer.
    const snapshots = await Promise.allSettled(positions.map(p => this.market.snapshot(p.mint, this.feed.slot)));
    for (let k = 0; k < positions.length; k++) {
      const i = (this.cursor + k) % positions.length, p = positions[i], result = snapshots[i];
      if (result.status === 'rejected') { log('position_snapshot_unavailable', { mint: p.mint }); continue; }
      const s = result.value;
      if (BigInt(p.creatorTokens ?? '0') > 0n) {
        try {
          const held = await this.rpc.connection.getParsedTokenAccountsByOwner(new PublicKey(p.creator), { mint: s.mint }, 'confirmed');
          const amount = held.value.reduce((n, a) => n + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
          if (amount < BigInt(p.creatorTokens)) p.panic = true;
          p.creatorTokens = String(amount);
        } catch { log('creator_balance_unavailable', { mint: p.mint }); }
      }
      let value: bigint;
      if (s.curve.complete) {
        // Completion moves the token to another venue. The bonding-curve quote is
        // no longer executable, and paper mode has no authoritative graduated
        // venue quote, so keep the mark unavailable instead of inventing a zero.
        log('position_mark_unavailable', { mint: p.mint, reason: 'curve_complete_without_executable_quote' });
        this.marks.delete(p.mint);
        continue;
      } else {
        const reserve = BigInt(s.curve.realQuoteReserves.toString());
        if (BigInt(p.reserve) > 0n && reserve < mulBps(BigInt(p.reserve), 10_000 - this.cfg.LIQUIDITY_DROP_BPS)) p.panic = true;
        p.reserve = String(reserve);
        const panicMark = p.panic;
        const grossExit = this.market.sellQuote(s, BigInt(p.qty));
        value = simulationSellProceeds(this.cfg, grossExit, panicMark);
        const normalized = value * BigInt(p.initialQty) / BigInt(p.qty);
        if (normalized > BigInt(p.peak)) p.peak = String(normalized);
      }
      let exit = exitDecision(p, value, this.cfg.STOP_BPS);
      // A stop uses emergency execution economics. Re-mark with the panic
      // slippage and panic tip before persisting the mark or recording P&L.
      if (!p.panic && exit?.reason === 'stop') {
        try {
          const grossExit = this.market.sellQuote(s, BigInt(p.qty));
          value = simulationSellProceeds(this.cfg, grossExit, true);
          exit = exitDecision(p, value, this.cfg.STOP_BPS) ?? exit;
        } catch {}
      }
      this.marks.set(p.mint, { value: String(value), at: Date.now() });
      const currentPct = BigInt(p.cost) > 0n ? Number(((value - BigInt(p.cost)) * 10000n) / BigInt(p.cost)) / 100 : 0;
      p.mfePct = Math.max(p.mfePct ?? currentPct, currentPct);
      p.maePct = Math.min(p.maePct ?? currentPct, currentPct);
      if (exit) {
        const blocked = this.blockedExits.get(p.mint);
        if (blocked) {
          const blockedDurationMs = Date.now() - blocked.blockedAt;
          const clearData = {
            mint: p.mint,
            reason: exit.reason,
            blockedDurationMs,
            valueAtTrigger: String(blocked.triggerValue),
            valueAtExecution: String(value),
          };
          log('exit_block_cleared', clearData);
          this.sessionLogger?.writeEvent('exit_block_cleared', clearData);
          this.blockedExits.delete(p.mint);
        }
        this.cursor = i + 1;
        const amount = mulBps(BigInt(p.qty), exit.fraction);
        await this.trade(s, 'sell', amount > 0n ? amount : BigInt(p.qty), p.creator, exit.stage, exit.reason, p.panic || exit.reason === 'stop');
        return;
      }
    }
    // Do not treat an unavailable mark as zero; that would create a false drawdown halt.
    const allMarked = positions.every(p => this.marks.has(p.mint));
    if (allMarked) {
      const markedEquity = BigInt(this.state.cash) + [...this.marks.values()].reduce((sum, mark) => sum + BigInt(mark.value), 0n);
      recordEquity(this.state, markedEquity, Date.now(), this.cfg.FAILURE_WINDOW_MS, this.cfg.ROLLING_DRAWDOWN_BPS);
    }
    if (positions.length) await this.store.save(this.state);
    for (const mint of this.marks.keys()) if (!this.state.positions[mint]) this.marks.delete(mint);
    if (this.stopped || this.state.operatorPaused || this.state.halted || !this.feed.healthy() || positions.length >= this.cfg.MAX_POSITIONS || BigInt(this.state.dayPnl) <= -BigInt(this.cfg.MAX_DAILY_LOSS_LAMPORTS)) return;
    const exposure = positions.reduce((a, p) => a + BigInt(p.cost), 0n);
    const maxPositionsReached = positions.length >= this.cfg.MAX_POSITIONS;
    const exposureExceeded = exposure + BigInt(this.cfg.BUY_LAMPORTS + this.cfg.RESERVE_LAMPORTS) > BigInt(this.cfg.MAX_EXPOSURE_LAMPORTS);

    if (maxPositionsReached || exposureExceeded) {
      for (const c of this.candidates.values()) {
        if (Date.now() - c.born >= this.cfg.MIN_AGE_MS && !c.devSold && !this.state.positions[c.mint] && !this.state.closed[c.mint]) {
          if (c.lastSnapshotSlot !== c.slot || c.lastSnapshotDisposition !== 'notEvaluated') {
            this.snapshotCandidate(c, 'notEvaluated', maxPositionsReached ? 'max_positions_reached' : 'max_portfolio_exposure_reached');
          }
        }
      }
      return;
    }

    // Track candidates that reached min age but failed initial buyer or volume filters
    for (const c of this.candidates.values()) {
      if (Date.now() - c.born >= this.cfg.MIN_AGE_MS && !this.state.positions[c.mint] && !this.state.closed[c.mint]) {
        if (c.buyers.size < this.cfg.MIN_BUYERS && c.lastSnapshotDisposition !== 'notEvaluated') {
          this.recordRestriction(c.mint, 'STRATEGY', 'WAIT', 'insufficient_buyers');
        } else if (!meetsBuySellFlow(c.buy, c.sell, this.cfg.MIN_BUY_SELL_RATIO_BPS) && c.lastSnapshotDisposition !== 'notEvaluated') {
          this.recordRestriction(c.mint, 'STRATEGY', 'WAIT', 'insufficient_buy_volume_ratio');
        }
      }
    }

    const available = [...this.candidates.values()].filter(c => Date.now() - c.born >= this.cfg.MIN_AGE_MS && c.next <= Date.now() && !c.devSold && !this.state.positions[c.mint] && !this.state.closed[c.mint]
      && c.buyers.size >= this.cfg.MIN_BUYERS && meetsBuySellFlow(c.buy, c.sell, this.cfg.MIN_BUY_SELL_RATIO_BPS)).slice(0, this.cfg.MAX_QUEUE);
    const candidate = available[0];
    if (!candidate) { await this.sampleCounterfactualNearMiss(); return; }
    const evaluationNow = Date.now();
    if (evaluationNow < this.nextSafetyScanAt) {
      candidate.next = this.nextSafetyScanAt;
      return;
    }
    this.nextSafetyScanAt = evaluationNow + this.cfg.RISK_SCAN_COOLDOWN_MS;
    candidate.next = evaluationNow + 15_000;
    let s: Snapshot | undefined, s1: Snapshot | undefined;
    let entryAmount = BigInt(this.cfg.BUY_LAMPORTS);
    try {
      s1 = await this.market.snapshot(candidate.mint, candidate.slot);
      await this.market.safety(s1, candidate.creator);
      const creatorTokens = s1.creatorTokens;
      // Re-read after expensive checks; never execute using reserves from before the checks.
      s = await this.market.snapshot(candidate.mint, candidate.slot);
      s.creatorTokens = creatorTokens;
      this.market.validateEntry(s);
      const drift = checkCandidateReserveDrift(s1, s);
      candidate.curve = {
        complete: s.curve.complete,
        realQuoteReserves: s.curve.realQuoteReserves.toString(),
        virtualTokenReserves: s.curve.virtualTokenReserves.toString(),
        virtualQuoteReserves: s.curve.virtualQuoteReserves.toString(),
        isHolderReward: s.curve.isHolderReward,
        isMayhemMode: s.curve.isMayhemMode,
      };
      candidate.drift = {
        passed: drift.passed,
        priceDriftBps: Number(drift.priceDriftBps),
        liquidityDropBps: Number(drift.liquidityDropBps),
        driftBps: Number(drift.driftBps ?? 0n),
        direction: drift.direction ?? 'none',
        reason: drift.reason,
      };
      const candidateMeta = {
        curve: candidate.curve,
        drift: candidate.drift,
        realReserveSol: Number(s.curve.realQuoteReserves.toString()) / 1e9,
        buyers: candidate.buyers.size,
        devSold: candidate.devSold,
      };
      if (!drift.passed) {
        candidate.next = Date.now() + 5_000;
      this.recordRestriction(candidate.mint, 'MARKET', 'WAIT', drift.reason ?? 'reserve_drift', candidateMeta, s);
        return;
      }
      if (s.curve.complete || s.curve.isMayhemMode || candidate.devSold || !this.feed.healthy() || this.stopped) {
        const scope: 'ACTOR'|'VENUE'|'SYSTEM' = s.curve.complete || s.curve.isMayhemMode ? 'VENUE' : candidate.devSold ? 'ACTOR' : 'SYSTEM';
        const effect: 'WAIT'|'QUARANTINE' = candidate.devSold ? 'QUARANTINE' : 'WAIT';
        const reason = s.curve.complete ? 'curve_complete_transition' : s.curve.isMayhemMode ? 'mayhem_mode' : candidate.devSold ? 'developer_disposition_unverified' : !this.feed.healthy() ? 'feed_unhealthy' : 'engine_stopped';
        this.recordRestriction(candidate.mint, scope, effect, reason, candidateMeta, s);
        return;
      }
      const walletPubkey = (this.executor as any)?.walletPublicKey || (this.executor as any)?.key?.publicKey;
      const cash = this.cfg.MODE === 'live' ? BigInt(await this.rpc.connection.getBalance(walletPubkey, 'confirmed')) : BigInt(this.state.cash);
      const riskBudget = cash * BigInt(this.cfg.MAX_SPECULATIVE_RISK_BPS) / 10_000n;
      entryAmount = entryAmount < riskBudget ? entryAmount : riskBudget;
      if (entryAmount <= 0n || cash < entryAmount + BigInt(this.cfg.RESERVE_LAMPORTS)) {
        this.recordRestriction(candidate.mint, 'PORTFOLIO', 'BLOCK_NEW_ENTRY', 'insufficient_cash_or_reserve', candidateMeta, s);
        return;
      }
      const snapshot = this.snapshotCandidate(candidate, 'cleared', null, { ...candidateMeta, s });
      if (snapshot && this.gateMode !== 'deterministic_only') {
        const modelDecision = await executeModelGate(snapshot, this.modelEvaluator, {
          maxInferenceMs: 10.0,
          mode: this.gateMode,
        });
        if (this.gateMode === 'shadow') {
          // Shadow evidence never changes the deterministic entry decision.
          this.sessionLogger?.writeEvent('model_shadow_evaluation', {
            mint: candidate.mint,
            candidateId: snapshot.candidateId,
            modelDecision,
          });
        } else if (!modelDecision.accepted) {
          this.recordRejection(candidate.mint, modelDecision.rejectionReason ?? 'model_rejected', {
            ...candidateMeta,
            modelDecision,
          });
          return;
        }
      }

      // Red-Team Automatic Falsification Agent (Roadmap #82, #300, #400)
      const poolSolReserve = Number(s.curve.realQuoteReserves) / 1e9;
      const falsificationReport = AutomaticFalsificationAgent.falsifyOpportunity({
        mint: candidate.mint,
        slot: s.slot,
        poolSolReserve: Math.max(1, poolSolReserve),
        latentInventoryFraction: candidate.devSold ? 0.40 : (candidate.buyers.size < 4 ? 0.25 : 0.08),
        expectedNetEvBps: 250,
        alphaHalfLifeMs: 2500,
        maxSlippageBps: this.cfg.SLIPPAGE_BPS,
        washTradingProbability: candidate.buyers.size < 4 ? 0.35 : 0.05,
        inputFieldClasses: {
          poolSolReserve: 'OBSERVED_CHAIN_STATE_WITH_HEURISTIC_FLOOR',
          latentInventoryFraction: 'HEURISTIC_PROXY',
          expectedNetEvBps: 'FIXED_ASSUMPTION',
          alphaHalfLifeMs: 'FIXED_ASSUMPTION',
          maxSlippageBps: 'CONFIGURED_POLICY_INPUT',
          washTradingProbability: 'HEURISTIC_PROXY',
        },
      });
      this.sessionLogger?.writeEvent('automatic_falsification_report', falsificationReport as unknown as Record<string, unknown>);
      this.persistResearchJournal('saveFalsificationReport', falsificationReport as unknown as Record<string, unknown>, falsificationReport.reportId);

      this.sessionLogger?.writeEvent('entry_curve_mode', {
        candidateId: deterministicCandidateId(candidate.mint, candidate.slot, candidate.eventSignature || `eval-${candidate.mint}-${candidate.slot}`),
        mint: candidate.mint,
        isHolderReward: s.curve.isHolderReward,
        isMayhemMode: s.curve.isMayhemMode,
        realSolReservesLamports: s.curve.realQuoteReserves.toString(),
        slot: s.slot,
      });
      // The retry cooldown above serializes safety rechecks. Once every entry
      // gate has passed, it must not veto the submission it was protecting.
      candidate.next = Date.now();
      await this.trade(s, 'buy', entryAmount, candidate.creator, 0, 'buyer-accumulation', false, candidate);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      candidate.next = Date.now() + candidateEvaluationRetryDelayMs(reason, this.cfg.MAX_AGE_MS);
      const observed = typeof s !== 'undefined' ? s : typeof s1 !== 'undefined' ? s1 : undefined;
      this.recordRestriction(candidate.mint, 'SYSTEM', 'WAIT', `candidate_evaluation_error:${reason}`, {
        curve: candidate.curve,
        drift: candidate.drift,
        devSold: candidate.devSold,
        buyers: candidate.buyers.size,
      }, observed);
      return;
    }
  }
  private async trade(s: Snapshot, side: 'buy' | 'sell', amount: bigint, creator: string, stage: number, reason: string, panic: boolean, candidate?: Candidate) {
    // An expiry leaves economic outcome unresolved until an operator performs
    // finalized wallet SOL/token reconciliation. Never automate another mutation.
    if (this.state.reconciliationBlocked) {
      log('order_blocked_by_reconciliation', { mint: s.mint.toBase58(), side, reason: this.state.reconciliationBlocked.reason });
      return;
    }
    if (side === 'buy' && candidate && !this.canSubmitEntry(candidate, s, amount)) return;
    if (side === 'buy') this.entryBuildInFlight = true;
    let built;
    try {
      built = await this.executor.build(s, side, amount, creator, stage, reason, panic);
    } catch { log('order_build_rejected', { mint: s.mint.toBase58(), side, reason }); return; }
    finally { if (side === 'buy') this.entryBuildInFlight = false; }
    if (side === 'buy' && (this.stopped || this.state.operatorPaused || this.state.halted || this.candidates.get(s.mint.toBase58())?.devSold || !this.feed.healthy())) return;
    this.state.pending = built.pending;
    if (this.cfg.MODE === 'paper') {
      const posBefore = this.state.positions[built.pending.mint];
      const posQty = posBefore ? BigInt(posBefore.qty) : 0n;
      const posCost = posBefore ? BigInt(posBefore.cost) : 0n;
      const isSell = side === 'sell';
      const tokensSold = isSell ? -built.tokenDelta : 0n;
      const isFullExit = isSell && posBefore && (tokensSold >= posQty || posQty === 0n);
      const allocatedCost = (isSell && posBefore && posQty > 0n)
        ? (isFullExit ? posCost : (posCost * tokensSold) / posQty)
        : 0n;

      settle(this.state, built.tokenDelta, built.solDelta);
      if (side === 'buy') {
        const p = this.state.positions[built.pending.mint];
        if (p && candidate) {
          p.candidateId = deterministicCandidateId(candidate.mint, candidate.slot, candidate.eventSignature || `eval-${candidate.mint}-${candidate.slot}`);
          p.entrySlot = candidate.slot;
        }
      } else if (side === 'sell') {
        const grossProceeds = built.quotedOutput ?? (built.solDelta > 0n ? built.solDelta : 0n);
        const slippageLamports = BigInt(built.overhead?.slippageLamports ?? '0');
        const priorityLamports = BigInt(built.overhead?.priorityLamports ?? '0') + BigInt(built.overhead?.baseFeeLamports ?? '5000');
        const tipLamports = BigInt(built.overhead?.tipLamports ?? '0');
        const rentLamports = BigInt(built.overhead?.rentLamports ?? '0');
        this.sessionLogger?.writeOutcomeLabel?.(buildOutcomeLabel({
          candidateId: posBefore?.candidateId || `paper-${built.pending.id}`,
          mint: built.pending.mint,
          entrySnapshotSlot: posBefore?.entrySlot || 0,
          censored: false,
          observationDurationMs: posBefore ? Date.now() - posBefore.opened : 0,
          costBasisLamports: allocatedCost.toString(),
          grossProceedsLamports: grossProceeds.toString(),
          dexImpactLamports: slippageLamports,
          priorityFeeLamports: priorityLamports,
          jitoTipLamports: tipLamports,
          ataRentLamports: rentLamports,
          realizedSlippageBps: built.overhead?.slippageBps,
          maximumFavorableExcursionPct: posBefore?.mfePct,
          maximumAdverseExcursionPct: posBefore?.maePct,
          exitStage: stage,
        }));

        // Evaluate Counterfactual Regret & Alpha Decomposition (Roadmap #81, #299, #483)
        const costBasisNum = Number(allocatedCost);
        const proceedsNum = Number(grossProceeds);
        const realizedPnlBps = costBasisNum > 0 ? Math.round(((proceedsNum - costBasisNum) / costBasisNum) * 10_000) : 0;
        const regretEvaluation = ExecutionRegretEngine.evaluateDecisionRegret({
          decisionId: `dec_${built.pending.id}`,
          opportunityId: posBefore?.candidateId || `paper-${built.pending.id}`,
          tokenId: built.pending.mint,
          slot: s.slot,
          actionTaken: 'BUY_ENTER',
          expectedNetEvBps: 200,
          expectedSlippageBps: this.cfg.SLIPPAGE_BPS,
          realizedPnlBps,
          realizedSlippageBps: built.overhead?.slippageBps ?? this.cfg.SLIPPAGE_BPS,
          realizedTipLamports: tipLamports,
          discoveryLagMs: 120,
          peakObservedPriceBps: posBefore?.mfePct ? Math.round(posBefore.mfePct * 100) : Math.max(realizedPnlBps, 0),
          drawdownObservedPriceBps: posBefore?.maePct ? Math.round(posBefore.maePct * 100) : Math.min(realizedPnlBps, 0),
          outcomeEvidenceClass: 'PAPER_SIMULATED_FILL',
        });
        this.sessionLogger?.writeEvent('trade_counterfactual_regret', regretEvaluation as unknown as Record<string, unknown>);
        this.persistResearchJournal('saveCounterfactualEvaluation', regretEvaluation as unknown as Record<string, unknown>, regretEvaluation.evaluationId);
      }
      await this.store.save(this.state, `paper-fill:${built.pending.id}`);
      const quoteAgeMs = Date.now() - (built.quoteTimestamp ?? Date.now());
      const fillData = {
        id: built.pending.id,
        mint: built.pending.mint,
        side,
        reason,
        stage,
        requestedAmount: built.pending.requested,
        quotedOutput: String(built.quotedOutput ?? 0n),
        tokenDelta: String(built.tokenDelta),
        netLamports: String(built.solDelta),
        quoteAgeMs,
        slippageBps: built.overhead?.slippageBps ?? (side === 'sell' && panic ? this.cfg.PANIC_SLIPPAGE_BPS : this.cfg.SLIPPAGE_BPS),
        tipLamports: built.overhead?.tipLamports ?? '0',
        priorityLamports: built.overhead?.priorityLamports ?? '0',
        rentLamports: built.overhead?.rentLamports ?? '0',
      };
      log('paper_fill', fillData);
      if (this.sessionLogger) {
        this.sessionLogger.writeFill({
          timestampUtc: new Date().toISOString(),
          id: built.pending.id,
          mint: built.pending.mint,
          side,
          reason,
          stage,
          requestedAmount: built.pending.requested,
          quotedOutput: String(built.quotedOutput ?? 0n),
          tokenDelta: String(built.tokenDelta),
          netLamports: String(built.solDelta),
          quoteAgeMs,
          slippageBps: fillData.slippageBps,
          tipLamports: fillData.tipLamports,
          priorityLamports: fillData.priorityLamports,
          rentLamports: fillData.rentLamports,
        });
      }
    } else {
      // Durability must succeed before any signed bytes leave this process.
      await this.persistAndBroadcast(built.pending);
    }
  }

  async persistAndBroadcast(order: Pending) {
    if (this.state.pending !== order) throw new Error('Pending order changed before persistence');
    // Reassert durability on retries too: an earlier save may have failed while
    // leaving the signed order in memory. UNKNOWN retains the same signed bytes.
    await this.store.save(this.state, `prepared:${order.signature}`);
    if (this.state.pending !== order) throw new Error('Pending order changed during persistence');
    const outcome = await this.executor.broadcast(order);
    if (!outcome || !['ACCEPTED', 'UNKNOWN', 'NOT_SENT'].includes(outcome.status)) {
      throw new Error('Execution authority returned an invalid delivery outcome');
    }
    const attempts = order.deliveryAttempts ??= [];
    attempts.push({ status: outcome.status, attemptedAt: outcome.attemptedAt, bundleId: outcome.bundleId, reason: outcome.reason });
    if (attempts.length > 32) attempts.splice(0, attempts.length - 32);
    await this.store.save(this.state, `delivery:${outcome.status}:${order.signature}`);
    return outcome;
  }
}
/**
 * This distribution has no reviewed live execution coordinator. Keep the
 * startup boundary explicit so a future wiring change cannot turn a config
 * value into execution authority.
 */
export function assertPaperRuntime(cfg: Pick<Config, 'MODE'>): void {
  if (cfg.MODE !== 'paper') {
    throw new Error('PAPER_ONLY_RUNTIME: live execution is unavailable in this build');
  }
}

export function derivePaperExecutionWallet(cfg: Pick<Config, 'MODE'>, paperWalletSeed?: Uint8Array): Keypair {
  // Keep this guard at the key derivation boundary as well as runEngine's
  // startup boundary so an alternate seed can never be interpreted in live mode.
  assertPaperRuntime(cfg);
  if (paperWalletSeed !== undefined && (!(paperWalletSeed instanceof Uint8Array) || paperWalletSeed.byteLength !== 32)) {
    throw new Error('PAPER_WALLET_SEED_INVALID: seed must contain exactly 32 bytes');
  }
  return Keypair.fromSeed(paperWalletSeed === undefined ? Buffer.alloc(32, 7) : Buffer.from(paperWalletSeed));
}

export function engineLockPort(walletPublicKey: PublicKey): number {
  return 20_000 + walletPublicKey.toBuffer().readUInt16LE(0) % 30_000;
}

async function wallet(cfg: Config, paperWalletSeed?: Uint8Array): Promise<Keypair> {
  if (cfg.MODE === 'paper') return derivePaperExecutionWallet(cfg, paperWalletSeed);
  // The legacy in-process keypair path is intentionally disabled. Live startup
  // remains blocked until DurableLiveSigner is wired to an isolated KMS service.
  throw new Error('LIVE_SIGNING_UNAVAILABLE: isolated durable signer is not configured');
}
async function acquire(wallet: PublicKey): Promise<Server> {
  const port = engineLockPort(wallet);
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port, exclusive: true }, done); });
  return server;
}
export async function runEngine(options: {
  durationSec?: number;
  sessionDir?: string;
  dbPath?: string;
  uiPort?: number;
  /** Explicit paper-only deterministic seed. Never sourced from the environment. */
  paperWalletSeed?: Uint8Array;
} = {}) {
  if (options.sessionDir) process.env.SESSION_DIR = options.sessionDir;
  if (options.dbPath) process.env.DB_PATH = options.dbPath;
  if (options.uiPort) process.env.UI_PORT = String(options.uiPort);
  if (existsSync('.env')) {
    try { process.loadEnvFile('.env'); } catch { /* ignore */ }
  }
  const cfg = config();
  assertPaperRuntime(cfg);
  const key = await wallet(cfg, options.paperWalletSeed), lock = await acquire(key.publicKey);
  let store: Store | undefined;
  let dashboard: Awaited<ReturnType<typeof startDashboard>> | undefined;
  let sessionLogger: SessionLogger | undefined;
  try {
    const rpc = new RpcPool(cfg); await rpc.verifyCluster();
    const market = new Market(rpc, cfg, key.publicKey);
    let executor: ExecutionAuthority;
    if (cfg.MODE === 'live') {
      executor = new LiveExecutionAuthority(cfg, rpc, market, key);
      await executor.warm();
    } else {
      executor = new SimulationExecutionAuthority(cfg, market, key.publicKey);
      await executor.warm();
    }
    if (process.argv.includes('--check')) { log('configuration_and_rpc_check_passed', { mode: cfg.MODE, rpcCount: cfg.RPC_URLS.length, wallet: key.publicKey.toBase58() }); return; }
    await mkdir(dirname(resolve(cfg.DB_PATH)), { recursive: true });
    store = new Store(resolve(cfg.DB_PATH));
    if (cfg.SESSION_DIR) {
      sessionLogger = new SessionLogger(resolve(cfg.SESSION_DIR));
      await sessionLogger.init();
      log('session_logger_initialized', { dir: resolve(cfg.SESSION_DIR) });
    }
    const state = await store.load() ?? { version: 1, wallet: key.publicKey.toBase58(), mode: cfg.MODE, positions: {}, pending: null, cash: String(cfg.PAPER_CASH_LAMPORTS), day: new Date().toISOString().slice(0, 10), dayPnl: '0', closed: {}, halted: false } as State;
    if (state.version !== 1 || state.wallet !== key.publicKey.toBase58() || state.mode !== cfg.MODE) throw new Error('database version/wallet/mode mismatch');
    pruneRiskState(state, Date.now(), cfg.FAILURE_WINDOW_MS);
    if (cfg.MODE === 'live') {
      if (!state.pending) {
        for (const p of Object.values(state.positions)) {
          const rows = await rpc.connection.getParsedTokenAccountsByOwner(key.publicKey, { mint: new PublicKey(p.mint) }, 'finalized');
          const balance = rows.value.reduce((n, row) => n + BigInt(row.account.data.parsed.info.tokenAmount.amount), 0n);
          if (balance !== BigInt(p.qty)) { state.halted = true; log('balance_reconciliation_mismatch', { mint: p.mint, expected: p.qty, actual: String(balance) }); }
        }
      }
      if (!state.pending) state.cash = String(await rpc.connection.getBalance(key.publicKey, 'finalized'));
    }
    await store.save(state, 'startup');
    const engine = new Engine(cfg, rpc, market, executor, store, state, sessionLogger);
    dashboard = await startDashboard(engine, cfg.UI_PORT);
    log('dashboard_ready', { url: dashboard.url });

    let durationTimer: NodeJS.Timeout | undefined;
    if (options.durationSec && options.durationSec > 0) {
      durationTimer = setTimeout(() => {
        log('duration_reached', { durationSec: options.durationSec });
        engine.stop();
      }, options.durationSec * 1000);
      durationTimer.unref();
    }

    const stopFn = () => engine.stop();
    process.once('SIGINT', stopFn); process.once('SIGTERM', stopFn);
    log('started', { mode: cfg.MODE, wallet: key.publicKey.toBase58(), positions: Object.keys(state.positions).length });
    await engine.run();
    if (durationTimer) clearTimeout(durationTimer);
    return { engine, state, sessionDir: cfg.SESSION_DIR };
  } finally {
    await dashboard?.close();
    await store?.close();
    await sessionLogger?.close();
    await new Promise<void>(done => lock.close(() => done()));
  }
}

async function main() {
  const durationArg = process.argv.find(a => a.startsWith('--duration='));
  const durationSec = durationArg ? Math.max(10, parseInt(durationArg.split('=')[1], 10)) : undefined;
  await runEngine({ durationSec });
}

export function isDirectEngineInvocation(argvEntry: string | undefined, moduleUrl: string): boolean {
  if (!argvEntry) return false;
  if (pathToFileURL(resolve(argvEntry)).href === moduleUrl) return true;
  // Windows launchers may preserve a relative argv entry while ESM normalizes
  // the module URL to a drive-qualified file URL.
  const normalized = argvEntry.replaceAll('\\', '/');
  return normalized === 'dist/fusion.js' || normalized === 'src/fusion.ts' ||
    normalized.endsWith('/dist/fusion.js') || normalized.endsWith('/src/fusion.ts');
}

if (isDirectEngineInvocation(process.argv[1], import.meta.url)) {
  main().catch(e => { log('fatal', { kind: e instanceof Error ? e.name : 'unknown', message: e instanceof Error && !e.message.includes('http') ? e.message.slice(0, 200) : 'startup or runtime failure; inspect configuration and endpoint access' }); process.exitCode = 1; });
}
