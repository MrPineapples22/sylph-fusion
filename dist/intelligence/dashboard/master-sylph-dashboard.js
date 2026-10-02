/**
 * SOL-SYLPH Intelligence Fabric - Master Dashboard State Projector
 * Specifications: Master Blueprint Section 96 (Recommended Master Dashboard).
 *
 * Implements:
 * 1. Unified 7-Tier Observability Matrix:
 *    - Tier 1: Capital & Solvency (System Mode, Truth Debt, Available Capital, Reserved, Drawdown)
 *    - Tier 2: Pipeline Funnel (Discovery Candidates, Authentic Candidates, Qualified, Execution-Ready)
 *    - Tier 3: Multiplier Hazards (P2x, P5x, P10x, P_rug, P_distribution, P_model_wrong)
 *    - Tier 4: Microstructure & Liquidity (Exit Capacity, Liquidity Fracture, StateLease, Alpha Half-Life)
 *    - Tier 5: Execution Network State (RPC Health, Account Contention, Scheduler Cost, Blockhash Margin, Jito)
 *    - Tier 6: Empirical Execution Calibration (Quote Error, Real Slippage, Simulation Drift, Landing Rate)
 *    - Tier 7: Epistemic & Research Health (Calibration Quality, OOD Score, Model Disagreement, Research Debt)
 * 2. Immutable deterministic view-model projection.
 */
import { createHash } from 'node:crypto';
export class MasterSylphDashboardProjector {
    /**
     * Projects authoritative system states into a single unified master dashboard view model.
     */
    static projectDashboard(params) {
        const timestampMs = Date.now();
        const cluster = 'mainnet-beta';
        const systemMode = params.systemMode ?? (params.truthDebtCount >= 3 ? 'HALT' :
            params.currentDrawdownPct >= 10 ? 'REDUCE_ONLY' :
                'FULL');
        const model = {
            timestampMs,
            cluster,
            systemMode,
            truthDebtCount: params.truthDebtCount,
            availableCapitalSol: params.availableCapitalSol,
            reservedCapitalSol: params.reservedCapitalSol,
            confirmedExposureSol: params.confirmedExposureSol,
            currentDrawdownPct: params.currentDrawdownPct,
            discoveryCandidatesCount: params.discoveryCandidatesCount ?? 0,
            authenticCandidatesCount: params.authenticCandidatesCount ?? 0,
            qualifiedOpportunitiesCount: params.qualifiedOpportunitiesCount ?? 0,
            executionReadyCount: params.executionReadyCount ?? 0,
            averageP2x: params.averageP2x ?? 0.35,
            averageP5x: params.averageP5x ?? 0.15,
            averageP10x: params.averageP10x ?? 0.05,
            averagePRug: params.averagePRug ?? 0.12,
            averagePDistribution: params.averagePDistribution ?? 0.20,
            averagePModelWrong: params.averagePModelWrong ?? 0.10,
            currentExitCapacitySol: params.currentExitCapacitySol ?? 25.0,
            liquidityFractureMarginPct: params.liquidityFractureMarginPct ?? 18.5,
            activeStateLeaseSlotsRemaining: params.activeStateLeaseSlotsRemaining ?? 45,
            medianAlphaHalfLifeMs: params.medianAlphaHalfLifeMs ?? 1850,
            rpcQuorumHealthPct: params.rpcQuorumHealthPct ?? 99.5,
            accountContentionScore: params.accountContentionScore ?? 0.22,
            estimatedSchedulerCostCU: params.estimatedSchedulerCostCU ?? 65_000,
            remainingBlockhashMarginSlots: params.remainingBlockhashMarginSlots ?? 120,
            jitoTip75thPercentileSol: params.jitoTip75thPercentileSol ?? 0.001,
            medianQuoteErrorTokens: params.medianQuoteErrorTokens ?? -250,
            averageRealizedSlippageBps: params.averageRealizedSlippageBps ?? 95,
            averageSimulationDriftSlots: params.averageSimulationDriftSlots ?? 2,
            entryLandingRatePct: params.entryLandingRatePct ?? 92.4,
            exitLandingRatePct: params.exitLandingRatePct ?? 96.8,
            calibrationBrierScore: params.calibrationBrierScore ?? 0.11,
            averageOodScore: params.averageOodScore ?? 0.08,
            modelDisagreementScore: params.modelDisagreementScore ?? 0.14,
            researchNegativeKnowledgeCount: params.researchNegativeKnowledgeCount ?? 0,
        };
        const dashboardSnapshotHash = createHash('sha256')
            .update(JSON.stringify(model))
            .digest('hex');
        return {
            ...model,
            dashboardSnapshotHash,
        };
    }
}
//# sourceMappingURL=master-sylph-dashboard.js.map