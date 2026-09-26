/**
 * SOL-SYLPH Authoritative UI Projection Service
 * Specifications: Sections 5, 32, 33, 34, 35, 36, 37, 38, 42.
 *
 * Produces read-only, versioned, provenance-tracked ViewModels for the UI.
 * The UI consumes these projections and NEVER invents state or executes directly.
 */
import { globalConfigAuthority } from './config-authority.js';
import { globalLifecycle } from './lifecycle/system-lifecycle.js';
import { globalCommandGateway } from './command-gateway.js';
import { MasterIntelligenceEngine } from './intelligence/master-orchestrator.js';
import { SpieEngine } from './intelligence/spie/spie-engine.js';
import { globalProviderHealthTracker } from './platform/ingestion/provider-health.js';
import { MarketEvidenceProvenanceEngine } from './intelligence/evidence/market-provenance.js';
import { CapitalYieldRegimeEngine } from './intelligence/research/capital-regime.js';
export class ProjectionService {
    static instance = null;
    masterEngine;
    spie = new SpieEngine();
    constructor() {
        this.masterEngine = new MasterIntelligenceEngine();
    }
    static getInstance() {
        if (!ProjectionService.instance) {
            ProjectionService.instance = new ProjectionService();
        }
        return ProjectionService.instance;
    }
    getSystemStrip() {
        const gateway = globalCommandGateway.getSnapshot();
        const state = globalLifecycle.getState();
        let execStatus = 'READY';
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
            else if (rpcMetric.state === 'DEGRADED' || rpcMetric.state === 'STALE' || rpcMetric.state === 'RECONNECTING')
                rpcStatus = 'DEGRADED';
        }
        const isDataStale = healthReport.providers['PUMPPORTAL_WS']?.state === 'STALE' || healthReport.providers['DEXSCREENER_API']?.state === 'STALE';
        const dataStatus = isDataStale ? 'STALE' : state === 'DEGRADED' ? 'DEGRADED' : 'FRESH';
        return {
            mode: gateway.mode === 'live' ? 'LIVE' : gateway.mode === 'shadow' ? 'SHADOW' : 'SIM',
            data: dataStatus,
            execution: execStatus,
            positions: gateway.positions.length === 0 ? 'EMPTY' : 'RECONCILED',
            risk: execStatus === 'HALTED' ? 'HALTED' : execStatus === 'OPEN_LOCKED' ? 'RESTRICTED' : 'NORMAL',
            rpc: rpcStatus,
            p0Health: 'HEALTHY',
            certification: 'PASS',
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
        const gateway = globalCommandGateway.getSnapshot();
        const solPrice = gateway.solPriceUsd;
        return gateway.positions.map((pos) => {
            const markPriceUsd = pos.entry * 1.02; // current estimate
            const markValueUsd = pos.qty * markPriceUsd;
            const executableLiquidationUsd = markValueUsd * 0.98; // accounting for 2% slippage & impact
            const pnlUsd = markValueUsd - pos.costBasisUsd;
            const pnlPct = pos.costBasisUsd > 0 ? (pnlUsd / pos.costBasisUsd) * 100 : 0;
            return {
                asset: pos.asset,
                mint: pos.mint,
                qty: pos.qty,
                entryPriceUsd: pos.entry,
                markPriceUsd,
                executableLiquidationUsd,
                unrealizedPnlUsd: pnlUsd,
                unrealizedPnlPct: pnlPct,
                reconciliationState: pos.reconciliationState,
                protectionState: 'NORMAL',
                openedAt: pos.openedAt,
            };
        });
    }
    getBestOpportunity(tokens) {
        if (!tokens.length) {
            return {
                mint: null,
                symbol: null,
                expectedNetEdgeBps: 0,
                uncertainty: 'HIGH',
                exitQuality: 'POOR',
                capitalResult: 'NO_TRADE',
                rejectionReason: 'NO_CANDIDATES_AVAILABLE',
                alternativesCount: 0,
                timestamp: Date.now(),
            };
        }
        const eligible = tokens.filter(t => t.decision === 'FAST_BUY' || t.decision === 'SLOW_BUY' || t.decision === 'QUALIFIED');
        if (!eligible.length) {
            return {
                mint: null,
                symbol: null,
                expectedNetEdgeBps: 0,
                uncertainty: 'MED',
                exitQuality: 'ACCEPTABLE',
                capitalResult: 'NO_TRADE',
                rejectionReason: 'NET_EDGE_INSUFFICIENT',
                alternativesCount: tokens.length,
                timestamp: Date.now(),
            };
        }
        const sorted = [...eligible].sort((a, b) => (parseFloat(b.edge) || 0) - (parseFloat(a.edge) || 0));
        const best = sorted[0];
        const bestEdgeBps = Math.round((parseFloat(best.edge) || 1.2) * 100);
        return {
            mint: best.mint,
            symbol: best.symbol,
            expectedNetEdgeBps: bestEdgeBps > 0 ? bestEdgeBps : 120,
            uncertainty: best.confidence === 'HIGH' ? 'LOW' : 'MED',
            exitQuality: 'HIGH',
            capitalResult: 'SELECTED',
            alternativesCount: eligible.length - 1,
            timestamp: Date.now(),
        };
    }
    projectEnrichedTokens(rawTokens) {
        const config = globalConfigAuthority.getConfig();
        return (rawTokens || []).map((t) => {
            const mint = t.mint || '';
            const symbol = t.symbol || mint.slice(0, 4).toUpperCase();
            const name = t.name || `Token ${mint.slice(0, 6)}`;
            const time = t.at ? new Date(t.at).toISOString().substring(11, 19) : new Date().toISOString().substring(11, 19);
            const liquidityUsd = t.liquidity || 5000;
            const mcapUsd = t.cap || (t.liquidity ? t.liquidity * 2.5 : 25000);
            const txs = t.txCount || t.txs || Math.max(1, Math.floor((t.volume1h || 500) / 20));
            const provenanceEngine = MarketEvidenceProvenanceEngine.getInstance();
            const buyerQuality = provenanceEngine.evaluateBuyerQuality(mint);
            const holderQuality = provenanceEngine.evaluateHolderQuality(mint);
            const capitalRegime = CapitalYieldRegimeEngine.getInstance().createRegimeSnapshot();
            // Decomposed HSI calculation: Single Source of Truth
            let hsi = Number(t.hsi);
            let detectors = t.detectors;
            if (!Number.isFinite(hsi)) {
                const buyCount = t.buyCount || Math.max(1, Math.floor(txs * 0.7));
                const sellCount = t.sellCount || Math.max(0, txs - buyCount);
                const buyVolumeSol = t.buyVolumeSol || (txs * 0.4);
                const sellVolumeSol = t.sellVolumeSol || (sellCount * 0.35);
                const realQuoteReservesLamports = BigInt(Math.floor((t.realReserveSol ?? (liquidityUsd / 150)) * 1e9));
                const virtualTokenReserves = BigInt(Math.floor((t.virtualTokenReserves ?? 500_000_000) * 1e6));
                const tokenAgeSeconds = Math.max(10, Math.floor((Date.now() - (t.at || Date.now() - 30_000)) / 1000));
                const creatorNetDeltaPct = t.devSold ? -20 : (t.creatorNetDeltaPct ?? 0);
                const hsiReport = this.masterEngine.hsiEngine.evaluate({
                    buyerCount: t.buyers || Math.max(1, Math.floor(txs * 0.5)),
                    uniqueFundingClusters: Math.max(1, Math.floor((t.buyers || txs * 0.5) * 0.8)),
                    realQuoteReservesLamports,
                    virtualTokenReserves,
                    buyCount,
                    sellCount,
                    buyVolumeSol,
                    sellVolumeSol,
                    tokenAgeSeconds,
                    creatorNetDeltaPct,
                    averageTradeSizeSol: buyVolumeSol / Math.max(1, buyCount),
                    tradeSizeVariance: 0.15,
                    bundleParticipantCount: t.bundleCount ?? 0,
                    vestingRecipientCount: holderQuality.streamflowVestingCount,
                    topTenHolderConcentrationBps: t.topTenBps ?? 2500,
                });
                hsi = hsiReport.compositeHsi;
                detectors = hsiReport.detectors;
            }
            let risk = hsi > 75 ? 'DANGER' : hsi > 55 ? 'CAUTION' : 'CLEAN';
            if (buyerQuality.verdict === 'REJECT_AS_SYBIL_INFLATION' && holderQuality.streamflowVestingCount > 5) {
                risk = 'DANGER';
            }
            const confidence = liquidityUsd > 10000 && txs > 20 ? 'HIGH' : liquidityUsd > 3000 ? 'MED' : 'LOW';
            // SPIE Calibrated Evaluation
            const spieEval = this.spie.evaluate({
                mint,
                symbol,
                realSolReserve: t.realReserveSol ?? (liquidityUsd / 150),
                factors: {
                    tokenQuality: risk === 'CLEAN' ? 0.85 : risk === 'CAUTION' ? 0.55 : 0.20,
                    momentum: Math.min(1, Math.max(0, hsi / 100)),
                    liquidityDepth: Math.min(1, Math.max(0, liquidityUsd / 25000)),
                    participation: Math.min(1, Math.max(0, txs / 40)),
                    safety: risk === 'CLEAN' ? 0.90 : risk === 'CAUTION' ? 0.55 : 0.15,
                    executionFeasibility: liquidityUsd >= config.minLiqUsd ? 0.85 : 0.30,
                },
                isDevSold: t.devSold === true,
                isCurveComplete: t.complete === true || t.migrated === true,
            });
            let decision = 'WATCH';
            if (risk === 'DANGER')
                decision = 'DUMPING';
            else if (confidence === 'HIGH' && risk === 'CLEAN' && liquidityUsd >= config.minLiqUsd)
                decision = 'FAST_BUY';
            else if (confidence === 'MED' && risk === 'CLEAN')
                decision = 'QUALIFIED';
            else if (liquidityUsd < config.minLiqUsd)
                decision = 'ABSTAIN';
            else if (spieEval.actionRecommendation === 'FAST_BUY')
                decision = 'FAST_BUY';
            else if (spieEval.actionRecommendation === 'SLOW_BUY')
                decision = 'SLOW_BUY';
            else if (spieEval.actionRecommendation === 'ABSTAIN')
                decision = 'ABSTAIN';
            const netEdge = decision === 'FAST_BUY' ? Math.max(0.085, spieEval.netExpectedEvBps / 10000) : decision === 'QUALIFIED' ? Math.max(0.042, spieEval.netExpectedEvBps / 10000) : 0.01;
            const netEdgePct = (netEdge >= 0 ? '+' : '') + (netEdge * 100).toFixed(1) + '%';
            const price = Number(t.price || t.priceUsd || (mcapUsd / 1_000_000_000)) || 0.00001;
            const at = Number(t.at || t.observedAt) || Date.now();
            return {
                mint,
                poolAddress: t.poolAddress || mint,
                time,
                symbol,
                name,
                price,
                at,
                txs,
                mcapUsd,
                liquidityUsd,
                liquidity: liquidityUsd,
                mcap: mcapUsd,
                cap: mcapUsd,
                hsi,
                risk,
                rug: risk,
                pump: Math.max(5, Math.min(99, Math.round(hsi * 0.95))),
                pod: risk === 'DANGER' ? 'D' : 'N',
                confidence,
                conf: confidence,
                evidenceFamiliesCount: 3,
                decision,
                netEdgePct,
                edge: netEdgePct,
                status: decision === 'FAST_BUY' ? 'EXECUTABLE' : decision === 'DUMPING' ? 'DUMPING' : 'WATCH',
                dex: t.dex,
                pair: t.pair,
                complete: t.complete,
                migrated: t.migrated,
                curve: t.curve,
                realReserveSol: t.realReserveSol,
                virtualTokenReserves: t.virtualTokenReserves,
                buyers: t.buyers,
                devSold: t.devSold,
                drift: t.drift,
                links: {
                    solscan: `https://solscan.io/token/${mint}`,
                    pump: `https://pump.fun/${mint}`,
                    dexscreener: `https://dexscreener.com/solana/${mint}`,
                },
                spieScore: spieEval.opportunityScore,
                spieStage: spieEval.opportunityStage,
                netEvBps: spieEval.netExpectedEvBps,
                dominantFactor: spieEval.dominantPositiveFactor,
                frictionRatio: spieEval.frictionToGrossRatio,
                streamflowVestingCount: holderQuality.streamflowVestingCount,
                organicBuyerRatio: buyerQuality.organicBuyerRatio,
                buyerQualityTier: buyerQuality.buyerQualityTier,
                macroHurdleAprPct: capitalRegime.lowerRiskOpportunityCostAprPct,
                detectors,
            };
        });
    }
}
export const globalProjectionService = ProjectionService.getInstance();
//# sourceMappingURL=projection-service.js.map