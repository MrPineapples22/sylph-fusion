/**
 * SYLPH FUSION — RESEARCH TRUTH FIREWALL & SIGNAL SIGNIFICANCE ENGINE
 * Specification: Solana-Only Integration Blueprint (Sections 9 & 10)
 *
 * Epistemic Invariants:
 * 1. Strict multi-stage firewall before any strategy can graduate to ALPHA_REALITY.
 * 2. 9 Mandatory Gates:
 *    - Signal Significance (vs. random entry benchmark)
 *    - Temporal Leakage (knownAt <= decisionAt)
 *    - Knowledge-Cut Consistency (bitemporal integrity)
 *    - Recursive-State Stability
 *    - Wallet/Creator-Cluster Leakage
 *    - Protocol Compatibility
 *    - Walk-Forward Validation (>= 3 folds, positive OOS Sharpe)
 *    - Sealed Holdout (holdout never ranks candidates)
 *    - Monte Carlo Ruin & Drawdown Stress
 * 3. Any gate failure demotes strategy strictly to RESEARCH_ONLY; zero production capital authority.
 */
import { hashCanonical } from '../../platform/pipeline/canonical-hashing.js';
export class ResearchTruthFirewall {
    /**
     * Evaluates a candidate strategy through the 9 rigorous gates.
     */
    evaluateCandidate(candidate) {
        this.validateCandidate(candidate);
        const gates = [];
        // Gate 1: Signal Significance Engine
        const significantCount = candidate.signalSignificanceSamples.filter(s => s.sampleCount > 0 && s.statisticallySignificant && s.pValue <= 0.05 && s.meanFutureReturnBps > s.randomBaselineReturnBps).length;
        const significancePassed = candidate.signalSignificanceSamples.length > 0 &&
            candidate.signalSignificanceSamples.every(s => s.sampleCount > 0) &&
            significantCount === candidate.signalSignificanceSamples.length;
        gates.push({
            gateId: 'SIGNAL_SIGNIFICANCE_GATE',
            passed: significancePassed,
            score: candidate.signalSignificanceSamples.length > 0 ? (significantCount / candidate.signalSignificanceSamples.length) * 100 : 0,
            reason: significancePassed ? undefined : 'One or more entry features failed random entry significance testing',
        });
        // Gate 2: Temporal Leakage
        gates.push({
            gateId: 'TEMPORAL_LEAKAGE_GATE',
            passed: candidate.temporalLeakageVerified,
            score: candidate.temporalLeakageVerified ? 100 : 0,
            reason: candidate.temporalLeakageVerified ? undefined : 'Temporal causality violation: future data leaked into decision features',
        });
        // Gate 3: Knowledge-Cut Consistency
        gates.push({
            gateId: 'KNOWLEDGE_CUT_CONSISTENCY_GATE',
            passed: candidate.knowledgeCutValid,
            score: candidate.knowledgeCutValid ? 100 : 0,
            reason: candidate.knowledgeCutValid ? undefined : 'Bitemporal knowledge cut breached or revised retroactively',
        });
        // Gate 4: Recursive-State Stability
        gates.push({
            gateId: 'RECURSIVE_STATE_STABILITY_GATE',
            passed: candidate.recursiveStateStable,
            score: candidate.recursiveStateStable ? 100 : 0,
            reason: candidate.recursiveStateStable ? undefined : 'Unstable state under recursive or repeated strategy feedback',
        });
        // Gate 5: Wallet/Creator-Cluster Leakage
        gates.push({
            gateId: 'WALLET_CREATOR_CLUSTER_LEAKAGE_GATE',
            passed: candidate.clusterLeakageClean,
            score: candidate.clusterLeakageClean ? 100 : 0,
            reason: candidate.clusterLeakageClean ? undefined : 'Future cluster associations contaminated training window',
        });
        // Gate 6: Protocol Compatibility
        gates.push({
            gateId: 'PROTOCOL_COMPATIBILITY_GATE',
            passed: candidate.protocolCompatibilityCertified,
            score: candidate.protocolCompatibilityCertified ? 100 : 0,
            reason: candidate.protocolCompatibilityCertified ? undefined : 'Target Solana DEX protocol compatibility lease expired or uncertified',
        });
        // Gate 7: Walk-Forward Validation (>= 3 folds)
        const walkForwardPassed = candidate.walkForwardFoldsPassed >= 3;
        gates.push({
            gateId: 'WALK_FORWARD_GATE',
            passed: walkForwardPassed,
            score: Math.min(100, (candidate.walkForwardFoldsPassed / 3) * 100),
            reason: walkForwardPassed ? undefined : `Insufficient out-of-sample folds: ${candidate.walkForwardFoldsPassed} / 3 minimum`,
        });
        // Gate 8: Sealed Holdout
        gates.push({
            gateId: 'SEALED_HOLDOUT_GATE',
            passed: candidate.sealedHoldoutPositive,
            score: candidate.sealedHoldoutPositive ? 100 : 0,
            reason: candidate.sealedHoldoutPositive ? undefined : 'Failed performance verification on pristine unranked holdout set',
        });
        // Gate 9: Monte Carlo Stress Test
        const mcPassed = candidate.monteCarloRuinProbabilityPct < 1.0;
        gates.push({
            gateId: 'MONTE_CARLO_RUIN_GATE',
            passed: mcPassed,
            score: Math.max(0, 100 - candidate.monteCarloRuinProbabilityPct * 10),
            reason: mcPassed ? undefined : `Excessive tail ruin probability under trade shuffling: ${candidate.monteCarloRuinProbabilityPct}% (limit < 1.0%)`,
        });
        // Gates are diagnostics over caller-provided assertions. This module has no
        // evidence-verification or certification authority and therefore cannot promote.
        const passedCount = gates.filter(g => g.passed).length;
        const status = 'RESEARCH_ONLY';
        const evaluatedAt = new Date().toISOString();
        const candidateClaimsHash = hashCanonical(candidate);
        const immutableGates = Object.freeze(gates.map(gate => Object.freeze({ ...gate })));
        const immutableSamples = Object.freeze(candidate.signalSignificanceSamples.map(sample => Object.freeze({ ...sample })));
        const payload = {
            strategyId: candidate.strategyId,
            status,
            gatesPassed: passedCount,
            totalGates: gates.length,
            evaluatedAt,
            gateResults: immutableGates,
            candidateClaimsHash,
            evidenceStatus: 'UNVERIFIED_CALLER_ASSERTIONS',
        };
        const graduationHash = hashCanonical(payload);
        const evaluationId = `firewall_eval_${candidate.strategyId}_${graduationHash.slice(0, 12)}`;
        return Object.freeze({
            ...payload,
            evaluationId,
            signalSignificance: immutableSamples,
            gateResults: immutableGates,
            graduationHash,
        });
    }
    validateCandidate(candidate) {
        if (!candidate || typeof candidate !== 'object')
            throw new TypeError('Candidate must be an object');
        if (typeof candidate.strategyId !== 'string' || candidate.strategyId.trim().length === 0) {
            throw new TypeError('strategyId must be a non-empty string');
        }
        if (!Array.isArray(candidate.features) || candidate.features.some(feature => typeof feature !== 'string' || !feature.trim())) {
            throw new TypeError('features must be an array of non-empty strings');
        }
        if (!Array.isArray(candidate.signalSignificanceSamples))
            throw new TypeError('signalSignificanceSamples must be an array');
        const finite = (value, name) => {
            if (typeof value !== 'number' || !Number.isFinite(value))
                throw new TypeError(`${name} must be finite`);
        };
        for (const [index, sample] of candidate.signalSignificanceSamples.entries()) {
            if (!sample || typeof sample.featureName !== 'string' || !sample.featureName.trim())
                throw new TypeError(`sample ${index} featureName is invalid`);
            if (!Number.isSafeInteger(sample.sampleCount) || sample.sampleCount < 0)
                throw new TypeError(`sample ${index} sampleCount must be a non-negative safe integer`);
            for (const field of ['meanFutureReturnBps', 'randomBaselineReturnBps', 'pValue', 'maximumFavorableExcursionBps', 'maximumAdverseExcursionBps', 'rugAvoidanceRatePct']) {
                finite(sample[field], `sample ${index} ${field}`);
            }
            if (sample.pValue < 0 || sample.pValue > 1)
                throw new RangeError(`sample ${index} pValue must be between 0 and 1`);
            if (sample.maximumFavorableExcursionBps < 0)
                throw new RangeError(`sample ${index} maximumFavorableExcursionBps cannot be negative`);
            if (sample.maximumAdverseExcursionBps > 0)
                throw new RangeError(`sample ${index} maximumAdverseExcursionBps cannot be positive`);
            if (sample.rugAvoidanceRatePct < 0 || sample.rugAvoidanceRatePct > 100)
                throw new RangeError(`sample ${index} rugAvoidanceRatePct must be between 0 and 100`);
            if (typeof sample.statisticallySignificant !== 'boolean')
                throw new TypeError(`sample ${index} statisticallySignificant must be boolean`);
        }
        for (const field of ['temporalLeakageVerified', 'knowledgeCutValid', 'recursiveStateStable', 'clusterLeakageClean', 'protocolCompatibilityCertified', 'sealedHoldoutPositive']) {
            if (typeof candidate[field] !== 'boolean')
                throw new TypeError(`${field} must be boolean`);
        }
        if (!Number.isSafeInteger(candidate.walkForwardFoldsPassed) || candidate.walkForwardFoldsPassed < 0)
            throw new RangeError('walkForwardFoldsPassed must be a non-negative safe integer');
        finite(candidate.monteCarloRuinProbabilityPct, 'monteCarloRuinProbabilityPct');
        if (candidate.monteCarloRuinProbabilityPct < 0 || candidate.monteCarloRuinProbabilityPct > 100)
            throw new RangeError('monteCarloRuinProbabilityPct must be between 0 and 100');
    }
}
//# sourceMappingURL=research-truth-firewall.js.map