/**
 * SYLPH FUSION — SOLANA MARKET TWIN RESIDUALS & BASIS-POINT ENGINEERING ACCOUNTING
 * Specification: Solana-Only Integration Blueprint (Sections 36 & 44)
 *
 * Epistemic Invariants:
 * 1. Section 36: Solana Market Twin Residuals:
 *    Compare predicted output, predicted fee, predicted slippage, predicted landing
 *    vs actual output, actual fee, actual slippage, actual landing.
 *    Produces: route residual, price residual, liquidity residual, landing residual,
 *    fee residual, CU residual.
 *    Large unexplained residuals become an active market risk signal.
 * 2. Section 44: Basis-Point Engineering Accounting:
 *    Every engineering upgrade reports routing improvement (+X bps), slippage improvement (+Y bps),
 *    and failure reduction (+Z bps).
 */
import { hashCanonical } from '../pipeline/canonical-hashing.js';
export class SolanaMarketTwinResidualAuditor {
    observations = [];
    /**
     * Section 36: Compute and audit market twin residuals between predicted and landed state.
     */
    auditExecution(params) {
        const routeResidualBps = params.actual.slippageBps - params.predicted.slippageBps;
        // Price residual in bps
        const priceResidualBps = params.predicted.outputLamports > 0n
            ? Math.floor(((Number(params.predicted.outputLamports) - Number(params.actual.outputLamports)) /
                Number(params.predicted.outputLamports)) *
                10_000)
            : 0;
        const liquidityResidualBps = Math.max(0, routeResidualBps - priceResidualBps);
        const landingResidualMs = params.actual.landingLatencyMs - params.predicted.landingLatencyMs;
        const feeResidualLamports = params.actual.feeLamports - params.predicted.feeLamports;
        const cuResidual = params.actual.computeUnits - params.predicted.computeUnits;
        // Detect unexplained anomaly
        const isPriceAnomalous = Math.abs(priceResidualBps) > 150; // > 1.5% unexplained drift
        const isCuAnomalous = Math.abs(cuResidual) > 50_000; // > 50k CU unexpected divergence
        const isLandingAnomalous = landingResidualMs > 1_500; // > 1.5s unexpected queue stall
        const hasUnexplainedResidual = isPriceAnomalous || isCuAnomalous || isLandingAnomalous;
        let anomalyReason;
        if (isPriceAnomalous) {
            anomalyReason = `PRICE_RESIDUAL_ANOMALY: Landed price drifted by ${priceResidualBps} bps beyond twin model`;
        }
        else if (isCuAnomalous) {
            anomalyReason = `CU_RESIDUAL_ANOMALY: Consumed ${params.actual.computeUnits} CU vs predicted ${params.predicted.computeUnits} CU (divergence: ${cuResidual})`;
        }
        else if (isLandingAnomalous) {
            anomalyReason = `LANDING_RESIDUAL_ANOMALY: Landed in ${params.actual.landingLatencyMs} ms vs predicted ${params.predicted.landingLatencyMs} ms`;
        }
        const payload = {
            signature: params.signature,
            mint: params.mint,
            slot: params.slot,
            priceResidualBps,
            feeResidualLamports,
            cuResidual,
        };
        const observationId = `mtr_${hashCanonical(payload).slice(0, 16)}`;
        const observation = Object.freeze({
            observationId,
            signature: params.signature,
            mint: params.mint,
            slot: params.slot,
            timestampMs: Date.now(),
            predictedOutputLamports: params.predicted.outputLamports,
            predictedFeeLamports: params.predicted.feeLamports,
            predictedSlippageBps: params.predicted.slippageBps,
            predictedLandingLatencyMs: params.predicted.landingLatencyMs,
            predictedComputeUnits: params.predicted.computeUnits,
            actualOutputLamports: params.actual.outputLamports,
            actualFeeLamports: params.actual.feeLamports,
            actualSlippageBps: params.actual.slippageBps,
            actualLandingLatencyMs: params.actual.landingLatencyMs,
            actualComputeUnits: params.actual.computeUnits,
            routeResidualBps,
            priceResidualBps,
            liquidityResidualBps,
            landingResidualMs,
            feeResidualLamports,
            cuResidual,
            hasUnexplainedResidual,
            anomalyReason,
        });
        this.observations.push(observation);
        if (this.observations.length > 500) {
            this.observations.shift();
        }
        return observation;
    }
    getObservations() {
        return Object.freeze([...this.observations]);
    }
    getActiveAnomalyCount() {
        return this.observations.filter(o => o.hasUnexplainedResidual).length;
    }
}
export class BasisPointEngineeringLedger {
    upgrades = [];
    /**
     * Section 44: Record empirical accounting for an engineering release.
     */
    registerUpgradeImpact(impact) {
        const payload = {
            upgradeName: impact.upgradeName,
            deployedAtSlot: impact.deployedAtSlot,
            routingImprovementBps: impact.routingImprovementBps,
            slippageImprovementBps: impact.slippageImprovementBps,
            failureReductionPct: impact.failureReductionPct,
        };
        const upgradeId = `eng_${hashCanonical(payload).slice(0, 14)}`;
        const full = Object.freeze({
            upgradeId,
            ...impact,
        });
        this.upgrades.push(full);
        return full;
    }
    getUpgrades() {
        return Object.freeze([...this.upgrades]);
    }
}
//# sourceMappingURL=market-twin-residuals.js.map