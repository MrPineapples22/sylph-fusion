/**
 * SOL-SYLPH Authoritative UI Projection Service
 * Specifications: Sections 5, 32, 33, 34, 35, 36, 37, 38, 42.
 *
 * Produces read-only, versioned, provenance-tracked ViewModels for the UI.
 * The UI consumes these projections and NEVER invents state or executes directly.
 */
import { globalLifecycle } from './lifecycle/system-lifecycle.js';
import { globalCommandGateway } from './command-gateway.js';
import { globalProviderHealthTracker } from './platform/ingestion/provider-health.js';
export class ProjectionService {
    static instance = null;
    constructor() { }
    static getInstance() {
        if (!ProjectionService.instance) {
            ProjectionService.instance = new ProjectionService();
        }
        return ProjectionService.instance;
    }
    getSystemStrip() {
        const gateway = globalCommandGateway.getSnapshot();
        const state = globalLifecycle.getState();
        let execStatus = globalLifecycle.isEntryPermitted() ? 'READY' : 'OPEN_LOCKED';
        if (state === 'OPEN_LOCKED')
            execStatus = 'OPEN_LOCKED';
        else if (state === 'REDUCE_ONLY')
            execStatus = 'REDUCE_ONLY';
        else if (state === 'SAFETY_LOCKED' || state === 'SHUTTING_DOWN' || state === 'DISCONNECTED')
            execStatus = 'HALTED';
        const solaris = globalCommandGateway.getSolarisSnapshot();
        const healthReport = globalProviderHealthTracker.getReport();
        const rpcMetric = healthReport.providers['SOLANA_RPC'];
        let rpcStatus = 'HEALTHY';
        if (rpcMetric) {
            if (rpcMetric.state === 'CIRCUIT_OPEN' || rpcMetric.state === 'OFFLINE')
                rpcStatus = 'FAILED';
            else if (rpcMetric.state === 'DEGRADED' || rpcMetric.state === 'STALE' || rpcMetric.state === 'RECONNECTING' || rpcMetric.state === 'RATE_LIMITED')
                rpcStatus = 'DEGRADED';
        }
        const isDataStale = healthReport.isMarketFeedStale;
        const dataStatus = isDataStale ? 'STALE' : state === 'DEGRADED' || healthReport.overallSystemState !== 'NOMINAL' ? 'DEGRADED' : 'FRESH';
        if (isDataStale && execStatus === 'READY')
            execStatus = 'OPEN_LOCKED';
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
            activeLeaderPubkey: solaris.activeLeaderPubkey,
            isJitoLeader: solaris.activeLeaderIsJito,
            tipFloorP75: solaris.tipFloor.p75,
            contentionTier: solaris.contentionTier,
            helios: solaris.helios,
            timestamp: Date.now(),
        };
    }
    getSolarisTelemetry(currentSlot) {
        return globalCommandGateway.getSolarisSnapshot(currentSlot);
    }
    getPositions() {
        return globalCommandGateway.getSnapshot().positions.map(pos => ({
            asset: pos.asset, mint: pos.mint, qty: pos.qty, entryPriceUsd: pos.entry,
            markPriceUsd: null, executableLiquidationUsd: null,
            unrealizedPnlUsd: null, unrealizedPnlPct: null,
            reconciliationState: pos.reconciliationState, protectionState: 'UNKNOWN', openedAt: pos.openedAt,
        }));
    }
    getBestOpportunity(tokens) {
        // Public market listings have no verified execution authorization or net-edge estimate.
        return { mint: null, symbol: null, expectedNetEdgeBps: 0, uncertainty: 'HIGH',
            exitQuality: 'POOR', capitalResult: 'NO_TRADE', alternativesCount: tokens.length,
            rejectionReason: tokens.length ? 'EXECUTION_EVIDENCE_UNAVAILABLE' : 'NO_CANDIDATES_AVAILABLE',
            timestamp: Date.now() };
    }
    projectEnrichedTokens(rawTokens) {
        const nonnegative = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
        const text = (value, fallback) => typeof value === 'string' && value ? value : fallback;
        const now = Date.now();
        return (Array.isArray(rawTokens) ? rawTokens : []).flatMap(raw => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                return [];
            const t = raw;
            const mint = text(t.mint, '');
            if (!mint)
                return [];
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
            return [{ mint, poolAddress: text(t.poolAddress, mint),
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
                    links: { solscan: 'https://solscan.io/token/' + encodeURIComponent(mint),
                        pump: 'https://pump.fun/' + encodeURIComponent(mint),
                        dexscreener: 'https://dexscreener.com/solana/' + encodeURIComponent(mint) },
                }];
        });
    }
}
export const globalProjectionService = ProjectionService.getInstance();
//# sourceMappingURL=projection-service.js.map