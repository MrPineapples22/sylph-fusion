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
        const gates = [];
        // Gate 1: Signal Significance Engine
        const significantCount = candidate.signalSignificanceSamples.filter(s => s.statisticallySignificant).length;
        const significancePassed = candidate.signalSignificanceSamples.length > 0 &&
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
        const passedCount = gates.filter(g => g.passed).length;
        const isAlphaReality = passedCount === gates.length;
        const status = isAlphaReality ? 'ALPHA_REALITY' : 'RESEARCH_ONLY';
        const payload = {
            strategyId: candidate.strategyId,
            status,
            gatesPassed: passedCount,
            totalGates: gates.length,
            evaluatedAt: new Date().toISOString(),
            gateResults: gates,
        };
        const graduationHash = hashCanonical(payload);
        const evaluationId = `firewall_eval_${candidate.strategyId}_${graduationHash.slice(0, 12)}`;
        return Object.freeze({
            ...payload,
            evaluationId,
            signalSignificance: Object.freeze([...candidate.signalSignificanceSamples]),
            gateResults: Object.freeze(gates),
            graduationHash,
        });
    }
}
//# sourceMappingURL=research-truth-firewall.js.map