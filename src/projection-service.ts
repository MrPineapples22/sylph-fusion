/**
 * SOL-SYLPH Authoritative UI Projection Service
 * Specifications: Sections 5, 32, 33, 34, 35, 36, 37, 38, 42.
 *
 * Produces read-only, versioned, provenance-tracked ViewModels for the UI.
 * The UI consumes these projections and NEVER invents state or executes directly.
 */

import { globalLifecycle, LifecycleState } from './lifecycle/system-lifecycle.js';
import { globalCommandGateway } from './command-gateway.js';
import { globalProviderHealthTracker } from './platform/ingestion/provider-health.js';

export interface GlobalSystemStripViewModel {
  readonly mode: 'LIVE' | 'SHADOW' | 'SIM';
  readonly data: 'FRESH' | 'DEGRADED' | 'STALE';
  readonly execution: 'READY' | 'OPEN_LOCKED' | 'REDUCE_ONLY' | 'HALTED';
  readonly positions: 'RECONCILED' | 'UNKNOWN' | 'EMPTY';
  readonly risk: 'NORMAL' | 'RESTRICTED' | 'HALTED';
  readonly rpc: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN';
  readonly p0Health: 'HEALTHY' | 'LATE' | 'UNKNOWN';
  readonly certification: 'PASS' | 'DEGRADED' | 'BLOCKED';
  readonly operationalState: LifecycleState;
  readonly activeLeaderPubkey?: string;
  readonly isJitoLeader?: boolean;
  readonly tipFloorP75?: string;
  readonly contentionTier?: string;
  readonly helios?: any;
  readonly timestamp: number;
}

export interface MainTableRowViewModel {
  readonly mint: string;
  readonly poolAddress: string;
  readonly time: string;
  readonly symbol: string;
  readonly name: string;
  readonly price: number | null;
  readonly at: number | null;
  readonly txs: number | null;
  readonly mcapUsd: number | null;
  readonly liquidityUsd: number | null;
  readonly liquidity: number | null;
  readonly mcap: number | null;
  readonly cap: number | null;
  readonly hsi: number | null;
  readonly risk: 'CLEAN' | 'CAUTION' | 'DANGER' | 'UNKNOWN';
  readonly rug: string;
  readonly pump: number | null;
  readonly pod: string;
  readonly confidence: 'HIGH' | 'MED' | 'LOW';
  readonly conf: string;
  readonly evidenceFamiliesCount: number;
  readonly decision: 'FAST_BUY' | 'SLOW_BUY' | 'QUALIFIED' | 'WATCH' | 'ABSTAIN' | 'DUMPING';
  readonly netEdgePct: string;
  readonly edge: string;
  readonly status: string;
  readonly dex?: string;
  readonly pair?: string;
  readonly complete?: boolean;
  readonly migrated?: boolean;
  readonly curve?: any;
  readonly realReserveSol?: number;
  readonly virtualTokenReserves?: number;
  readonly buyers?: number;
  readonly devSold?: boolean;
  readonly drift?: any;
  readonly links: {
    readonly solscan: string;
    readonly pump: string;
    readonly dexscreener: string;
  };
  readonly spieScore?: number;
  readonly spieStage?: string;
  readonly netEvBps?: number;
  readonly dominantFactor?: string;
  readonly frictionRatio?: number;
  readonly streamflowVestingCount?: number;
  readonly organicBuyerRatio?: number;
  readonly buyerQualityTier?: string;
  readonly macroHurdleAprPct?: number;
  readonly detectors?: {
    readonly bundlerDetected: boolean;
    readonly velocityAnomaly: boolean;
    readonly devDumpingDetected: boolean;
    readonly excessiveConcentration: boolean;
  };
}

export interface BestOpportunityViewModel {
  readonly mint: string | null;
  readonly symbol: string | null;
  readonly expectedNetEdgeBps: number;
  readonly uncertainty: 'LOW' | 'MED' | 'HIGH';
  readonly exitQuality: 'HIGH' | 'ACCEPTABLE' | 'POOR';
  readonly capitalResult: 'SELECTED' | 'NOT_SELECTED' | 'NO_TRADE';
  readonly rejectionReason?: string;
  readonly alternativesCount: number;
  readonly timestamp: number;
}

export interface PositionRowViewModel {
  readonly asset: string;
  readonly mint: string;
  readonly symbol?: string;
  readonly qty: number;
  readonly entryPriceUsd: number;
  readonly markPriceUsd: number | null;
  readonly executableLiquidationUsd: number | null;
  readonly unrealizedPnlUsd: number | null;
  readonly unrealizedPnlPct: number | null;
  readonly reconciliationState: 'SIMULATED' | 'RECONCILED' | 'PENDING' | 'DISCREPANCY';
  readonly protectionState: 'NORMAL' | 'TRAILING_ACTIVE' | 'EMERGENCY_UNWIND' | 'UNKNOWN';
  readonly openedAt: number;
  readonly peakPriceUsd?: number | null;
  readonly peakPnlPct?: number | null;
  readonly maePriceUsd?: number | null;
  readonly maePnlPct?: number | null;
  readonly trailingStopUsd?: number | null;
}

export class ProjectionService {
  private static instance: ProjectionService | null = null;
  private readonly lastKnownMarks = new Map<string, number>();
  private constructor() {}

  public static getInstance(): ProjectionService {
    if (!ProjectionService.instance) {
      ProjectionService.instance = new ProjectionService();
    }
    return ProjectionService.instance;
  }

  public getSystemStrip(): GlobalSystemStripViewModel {
    const gateway = globalCommandGateway.getSnapshot();
    const state = globalLifecycle.getState();

    let execStatus: 'READY' | 'OPEN_LOCKED' | 'REDUCE_ONLY' | 'HALTED' = globalLifecycle.isEntryPermitted() ? 'READY' : 'OPEN_LOCKED';
    if (state === 'OPEN_LOCKED') execStatus = 'OPEN_LOCKED';
    else if (state === 'REDUCE_ONLY') execStatus = 'REDUCE_ONLY';
    else if (state === 'SAFETY_LOCKED' || state === 'SHUTTING_DOWN' || state === 'DISCONNECTED') execStatus = 'HALTED';

    const healthReport = globalProviderHealthTracker.getReport();
    const rpcMetric = healthReport.providers['SOLANA_RPC'];
    let rpcStatus: 'HEALTHY' | 'DEGRADED' | 'FAILED' | 'UNKNOWN' = 'UNKNOWN';
    if (rpcMetric) {
      if (rpcMetric.state === 'CIRCUIT_OPEN' || rpcMetric.state === 'OFFLINE') rpcStatus = 'FAILED';
      else if (rpcMetric.state === 'DEGRADED' || rpcMetric.state === 'STALE' || rpcMetric.state === 'RECONNECTING' || rpcMetric.state === 'RATE_LIMITED') rpcStatus = 'DEGRADED';
      else if (rpcMetric.observationValidated && rpcMetric.capabilityAvailable) rpcStatus = 'HEALTHY';
    }

    const isDataStale = healthReport.isMarketFeedStale;
    const dataStatus: 'FRESH' | 'DEGRADED' | 'STALE' = isDataStale ? 'STALE' : state === 'DEGRADED' || healthReport.overallSystemState !== 'NOMINAL' ? 'DEGRADED' : 'FRESH';
    if (isDataStale && execStatus === 'READY') execStatus = 'OPEN_LOCKED';

    return {
      mode: gateway.mode === 'live' ? 'LIVE' : gateway.mode === 'shadow' ? 'SHADOW' : 'SIM',
      data: dataStatus,
      execution: execStatus,
      positions: gateway.positions.length === 0 ? 'EMPTY' : gateway.positions.every(p => p.reconciliationState === 'RECONCILED') ? 'RECONCILED' : 'UNKNOWN',
      risk: execStatus === 'HALTED' ? 'HALTED' : execStatus === 'OPEN_LOCKED' ? 'RESTRICTED' : 'NORMAL',
      rpc: rpcStatus,
      p0Health: 'UNKNOWN',
      certification: 'BLOCKED',
      operationalState: state,
      // The gateway's Solaris snapshot uses simulated leaders and fallback tip
      // estimates. It is not an observation of live delivery infrastructure.
      timestamp: Date.now(),
    };
  }

  public getSolarisTelemetry(currentSlot?: number) {
    return globalCommandGateway.getSolarisSnapshot(currentSlot);
  }

  public getPositions(observedTokens?: unknown[]): PositionRowViewModel[] {
    const tokenMap = new Map<string, number>();
    const isObserved = Array.isArray(observedTokens);
    if (isObserved) {
      for (const t of observedTokens) {
        if (t && typeof t === 'object') {
          const rec = t as Record<string, unknown>;
          const mint = typeof rec.mint === 'string' ? rec.mint : '';
          const pair = typeof rec.pair === 'string' ? rec.pair : '';
          const price = typeof rec.price === 'number' && Number.isFinite(rec.price) && rec.price > 0
            ? rec.price
            : typeof rec.priceUsd === 'number' && Number.isFinite(rec.priceUsd) && rec.priceUsd > 0
              ? rec.priceUsd
              : null;
          if (price !== null) {
            if (mint) {
              tokenMap.set(mint, price);
              this.lastKnownMarks.set(mint, price);
            }
            if (pair) {
              tokenMap.set(pair, price);
              this.lastKnownMarks.set(pair, price);
            }
          }
        }
      }
    }

    return globalCommandGateway.getSnapshot().positions.map(pos => {
      const markPriceUsd = isObserved
        ? (tokenMap.get(pos.mint) ?? tokenMap.get(pos.asset) ?? this.lastKnownMarks.get(pos.mint) ?? this.lastKnownMarks.get(pos.asset) ?? (pos.entry > 0 ? pos.entry : null))
        : null;
      const executableLiquidationUsd = markPriceUsd !== null ? Number((pos.qty * markPriceUsd).toFixed(4)) : null;
      const unrealizedPnlUsd = markPriceUsd !== null ? Number(((markPriceUsd - pos.entry) * pos.qty).toFixed(4)) : null;
      const unrealizedPnlPct = markPriceUsd !== null && pos.entry > 0
        ? Number((((markPriceUsd - pos.entry) / pos.entry) * 100).toFixed(2))
        : null;

      const peakPriceUsd = pos.peak && pos.peak > 0 ? pos.peak : markPriceUsd;
      const peakPnlPct = peakPriceUsd !== null && pos.entry > 0
        ? Number((((peakPriceUsd - pos.entry) / pos.entry) * 100).toFixed(2))
        : unrealizedPnlPct;

      const maePriceUsd = pos.trough && pos.trough > 0 ? pos.trough : markPriceUsd;
      const maePnlPct = maePriceUsd !== null && pos.entry > 0
        ? Number((((maePriceUsd - pos.entry) / pos.entry) * 100).toFixed(2))
        : unrealizedPnlPct;

      let protectionState: 'NORMAL' | 'TRAILING_ACTIVE' | 'EMERGENCY_UNWIND' | 'UNKNOWN' = 'UNKNOWN';
      if (markPriceUsd !== null) {
        if (unrealizedPnlPct !== null && unrealizedPnlPct <= -12) protectionState = 'EMERGENCY_UNWIND';
        else if ((peakPnlPct !== null && peakPnlPct >= 4) || (unrealizedPnlPct !== null && unrealizedPnlPct >= 6)) protectionState = 'TRAILING_ACTIVE';
        else protectionState = 'NORMAL';
      }

      return {
        asset: pos.asset,
        mint: pos.mint,
        symbol: pos.symbol || (pos.asset ? pos.asset.slice(0, 8) : undefined),
        qty: pos.qty,
        entryPriceUsd: pos.entry,
        markPriceUsd,
        executableLiquidationUsd,
        unrealizedPnlUsd,
        unrealizedPnlPct,
        reconciliationState: pos.reconciliationState,
        protectionState,
        openedAt: pos.openedAt,
        peakPriceUsd,
        peakPnlPct,
        maePriceUsd,
        maePnlPct,
        trailingStopUsd: pos.stop ?? null,
      };
    });
  }

  public getBestOpportunity(tokens: MainTableRowViewModel[]): BestOpportunityViewModel {
    // Public market listings have no verified execution authorization or net-edge estimate.
    return {mint: null, symbol: null, expectedNetEdgeBps: 0, uncertainty: 'HIGH',
      exitQuality: 'POOR', capitalResult: 'NO_TRADE', alternativesCount: tokens.length,
      rejectionReason: tokens.length ? 'EXECUTION_EVIDENCE_UNAVAILABLE' : 'NO_CANDIDATES_AVAILABLE',
      timestamp: Date.now()};
  }

  public projectEnrichedTokens(rawTokens: unknown[]): MainTableRowViewModel[] {
    const nonnegative = (value: unknown): number | null =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
    const text = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback;
    const now = Date.now();
    return (Array.isArray(rawTokens) ? rawTokens : []).flatMap(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const t = raw as Record<string, unknown>;
      const mint = text(t.mint, '');
      if (!mint) return [];
      const atValue = nonnegative(t.at ?? t.observedAt);
      const at = atValue !== null && atValue > 0 && atValue <= now && atValue <= 8.64e15 ? atValue : null;
      const liquidity = nonnegative(t.liquidity);
      const cap = nonnegative(t.cap);
      const price = nonnegative(t.price ?? t.priceUsd);
      const count = nonnegative(t.txCount ?? t.txs);
      const txs = count !== null && Number.isSafeInteger(count) ? count : null;
      const fresh = at !== null && now - at <= 45_000;
      const complete = price !== null && liquidity !== null && cap !== null;
      const decision = fresh && complete ? 'WATCH' : 'ABSTAIN';
      // Scoring requires independent wallet/trade evidence; aggregate volume cannot supply it.
      return [{mint, poolAddress: text(t.poolAddress, mint),
        time: at === null ? '—' : new Date(at).toISOString().substring(11, 19),
        symbol: text(t.symbol, mint.slice(0, 4).toUpperCase()), name: text(t.name, 'Token ' + mint.slice(0, 6)),
        price, at, txs, mcapUsd: cap, liquidityUsd: liquidity, liquidity, mcap: cap, cap,
        hsi: null, risk: 'UNKNOWN', rug: 'UNKNOWN', pump: null, pod: 'UNKNOWN',
        confidence: 'LOW', conf: 'LOW', evidenceFamiliesCount: complete ? 1 : 0,
        decision, netEdgePct: '—', edge: '—', status: fresh ? 'UNVERIFIED' : 'STALE',
        dex: typeof t.dex === 'string' ? t.dex : undefined,
        pair: typeof t.pair === 'string' ? t.pair : undefined,
        complete: typeof t.complete === 'boolean' ? t.complete : undefined,
        migrated: typeof t.migrated === 'boolean' ? t.migrated : undefined,
        links: {solscan: 'https://solscan.io/token/' + encodeURIComponent(mint),
          pump: 'https://pump.fun/' + encodeURIComponent(mint),
          dexscreener: 'https://dexscreener.com/solana/' + encodeURIComponent(mint)},
      } satisfies MainTableRowViewModel];
    });
  }
}

export const globalProjectionService = ProjectionService.getInstance();
