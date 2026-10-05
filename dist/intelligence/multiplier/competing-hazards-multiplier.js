/**
 * SYLPH FUSION — MULTIPLIER-X RESEARCH HEURISTICS
 *
 * This module has no fitted or calibrated survival model. Its bounded outputs
 * are relative heuristic scores only. They are not probabilities, hazards,
 * event-time estimates, evidence certificates, or execution authority.
 */
import { createHash } from 'node:crypto';
function bounded(value, min, max) {
    return Number(Math.min(max, Math.max(min, value)).toFixed(3));
}
function requireFinite(name, value) {
    if (!Number.isFinite(value))
        throw new Error(`MULTIPLIER_INVALID_FEATURE:${name}`);
}
function validateFeatures(f) {
    if (typeof f.mint !== 'string' || f.mint.trim().length === 0)
        throw new Error('MULTIPLIER_INVALID_FEATURE:mint');
    const finiteFields = [
        'netCapitalFlowVelocity', 'netCapitalFlowAcceleration', 'poolLiquiditySol',
        'bondingCurveProgressPct', 'authenticityProbability', 'manipulationResistanceScore',
        'entityCount', 'sellerAbsorptionRate', 'currentMcapSol', 'ageSeconds',
        'observationSlot', 'timestampMs',
    ];
    for (const field of finiteFields)
        requireFinite(field, f[field]);
    if (f.poolLiquiditySol < 0 || f.bondingCurveProgressPct < 0 || f.bondingCurveProgressPct > 100 ||
        f.authenticityProbability < 0 || f.authenticityProbability > 1 ||
        f.manipulationResistanceScore < 0 || f.manipulationResistanceScore > 1 ||
        !Number.isSafeInteger(f.entityCount) || f.entityCount < 0 ||
        f.sellerAbsorptionRate < 0 || f.sellerAbsorptionRate > 1 ||
        f.currentMcapSol < 0 || f.ageSeconds < 0 ||
        !Number.isSafeInteger(f.observationSlot) || f.observationSlot < 0 ||
        !Number.isSafeInteger(f.timestampMs) || f.timestampMs < 0) {
        throw new Error('MULTIPLIER_INVALID_FEATURE_RANGE');
    }
}
export class MultiplierResearchHeuristicEngine {
    static VERSION = 'SYLPH_MULTIPLIER_HEURISTICS_V3';
    /** Produces relative, uncalibrated research scores; never a probability forecast. */
    static evaluateResearchHeuristics(features) {
        validateFeatures(features);
        const f = features;
        const rugRisk = bounded((1 - f.authenticityProbability) * 0.5 +
            (1 - f.manipulationResistanceScore) * 0.3 +
            (f.entityCount < 5 ? 0.3 : 0.05), 0.01, 0.95);
        const liquidityDeathRisk = bounded((f.poolLiquiditySol < 10 ? 0.4 : 0.05) +
            (f.netCapitalFlowAcceleration < -0.5 ? 0.3 : 0.05), 0.01, 0.95);
        const distributionRisk = bounded((1 - f.sellerAbsorptionRate) * 0.6 + (f.currentMcapSol > 500 ? 0.2 : 0.05), 0.05, 0.85);
        const stallRisk = bounded(Math.abs(f.netCapitalFlowVelocity) < 0.1 ? 0.4 : 0.1, 0.05, 0.70);
        const expansionBase = f.authenticityProbability * 0.3 +
            f.manipulationResistanceScore * 0.2 +
            (f.netCapitalFlowVelocity > 0.5 ? 0.25 : 0.05) +
            (f.netCapitalFlowAcceleration > 0 ? 0.15 : 0) +
            (f.bondingCurveProgressPct > 30 ? 0.1 : 0);
        const remainingScore = Math.max(0.01, 1 - Math.min(0.98, rugRisk + liquidityDeathRisk * 0.5 + distributionRisk * 0.3));
        const expansion2x = bounded(expansionBase * remainingScore * 0.9, 0.02, 0.95);
        const expansion5x = bounded(expansion2x * 0.55 * (f.poolLiquiditySol > 15 ? 1 : 0.6), 0.01, 0.80);
        const expansion10x = bounded(expansion5x * 0.4 * (f.currentMcapSol < 150 ? 1.2 : 0.7), 0.005, 0.50);
        const relativeExpansion10xVersusFailureScore = bounded(expansion10x / Math.max(0.05, expansion10x + rugRisk + liquidityDeathRisk), 0, 1);
        const scores = Object.freeze({
            expansion2x,
            expansion5x,
            expansion10x,
            rugRisk,
            liquidityDeathRisk,
            distributionRisk,
            stallRisk,
            relativeExpansion10xVersusFailureScore,
        });
        const diagnosticDigest = createHash('sha256')
            .update(JSON.stringify([
            this.VERSION, f.mint, f.netCapitalFlowVelocity, f.netCapitalFlowAcceleration,
            f.poolLiquiditySol, f.bondingCurveProgressPct, f.authenticityProbability,
            f.manipulationResistanceScore, f.entityCount, f.sellerAbsorptionRate,
            f.currentMcapSol, f.ageSeconds, f.observationSlot, f.timestampMs,
            scores.expansion2x, scores.expansion5x, scores.expansion10x, scores.rugRisk,
            scores.liquidityDeathRisk, scores.distributionRisk, scores.stallRisk,
            scores.relativeExpansion10xVersusFailureScore,
        ]))
            .digest('hex');
        return Object.freeze({
            mint: f.mint,
            status: 'UNCALIBRATED_RESEARCH_HEURISTIC',
            scores,
            diagnosticDigest,
        });
    }
    /**
     * Summarizes a supplied price path under caller-specified slippage assumptions.
     * Without route, size, token semantics, and finalized execution evidence this
     * can never establish an executable or capturable multiplier outcome.
     */
    static analyzeObservedPath(params) {
        if (typeof params.mint !== 'string' || !params.mint.trim() ||
            !Number.isSafeInteger(params.observationSlot) || params.observationSlot < 0 ||
            !Number.isSafeInteger(params.observationTimeMs) || params.observationTimeMs < 0) {
            throw new Error('MULTIPLIER_INVALID_PATH_IDENTITY');
        }
        for (const [name, value] of Object.entries({
            entryPriceSol: params.entryPriceSol, peakPriceSol: params.peakPriceSol,
            troughPriceSol: params.troughPriceSol, exitPriceSol: params.exitPriceSol,
            entrySlippageBps: params.entrySlippageBps, exitSlippageBps: params.exitSlippageBps,
        })) {
            if (!Number.isFinite(value))
                throw new Error(`MULTIPLIER_INVALID_PATH_VALUE:${name}`);
        }
        if (params.entryPriceSol <= 0 || params.peakPriceSol <= 0 || params.troughPriceSol < 0 ||
            params.exitPriceSol <= 0 || params.entrySlippageBps < 0 || params.entrySlippageBps > 10_000 ||
            params.exitSlippageBps < 0 || params.exitSlippageBps > 10_000) {
            throw new Error('MULTIPLIER_INVALID_PATH_RANGE');
        }
        const modeledEntry = params.entryPriceSol * (1 + params.entrySlippageBps / 10_000);
        const modeledPeakExit = params.peakPriceSol * (1 - params.exitSlippageBps / 10_000);
        const modeledFinalExit = params.exitPriceSol * (1 - params.exitSlippageBps / 10_000);
        const chartPeakMultiple = params.peakPriceSol / params.entryPriceSol;
        const modeledMultipleAfterAssumedSlippage = modeledPeakExit / modeledEntry;
        const modeledExitMultipleAfterAssumedSlippage = modeledFinalExit / modeledEntry;
        const observedWorstDrawdownBps = Math.round(Math.max(0, (params.entryPriceSol - params.troughPriceSol) / params.entryPriceSol * 10_000));
        if (![chartPeakMultiple, modeledMultipleAfterAssumedSlippage, modeledExitMultipleAfterAssumedSlippage, observedWorstDrawdownBps].every(Number.isFinite)) {
            throw new Error('MULTIPLIER_PATH_METRIC_OVERFLOW');
        }
        const diagnosticDigest = createHash('sha256')
            .update(JSON.stringify([
            this.VERSION, params.mint, params.observationSlot, params.observationTimeMs,
            params.entryPriceSol, params.peakPriceSol, params.troughPriceSol, params.exitPriceSol,
            params.entrySlippageBps, params.exitSlippageBps, chartPeakMultiple,
            modeledMultipleAfterAssumedSlippage, modeledExitMultipleAfterAssumedSlippage,
            observedWorstDrawdownBps,
        ]))
            .digest('hex');
        return Object.freeze({
            mint: params.mint,
            observationSlot: params.observationSlot,
            observationTimeMs: params.observationTimeMs,
            chartPeakMultiple: Number(chartPeakMultiple.toFixed(6)),
            modeledMultipleAfterAssumedSlippage: Number(modeledMultipleAfterAssumedSlippage.toFixed(6)),
            modeledExitMultipleAfterAssumedSlippage: Number(modeledExitMultipleAfterAssumedSlippage.toFixed(6)),
            observedWorstDrawdownBps,
            labelStatus: 'UNVERIFIED_RESEARCH_ONLY',
            diagnosticDigest,
        });
    }
}
//# sourceMappingURL=competing-hazards-multiplier.js.map