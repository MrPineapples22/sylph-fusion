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
import { types as utilTypes } from 'node:util';
export class ResearchTruthFirewall {
    /**
     * Evaluates a candidate strategy through the 9 rigorous gates.
     */
    evaluateCandidate(candidate) {
        candidate = this.snapshotCandidate(candidate);
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
    snapshotCandidate(candidate) {
        const candidateKeys = [
            'strategyId', 'features', 'signalSignificanceSamples', 'temporalLeakageVerified',
            'knowledgeCutValid', 'recursiveStateStable', 'clusterLeakageClean',
            'protocolCompatibilityCertified', 'walkForwardFoldsPassed', 'sealedHoldoutPositive',
            'monteCarloRuinProbabilityPct',
        ];
        const sampleKeys = [
            'featureName', 'sampleCount', 'meanFutureReturnBps', 'randomBaselineReturnBps',
            'pValue', 'maximumFavorableExcursionBps', 'maximumAdverseExcursionBps',
            'rugAvoidanceRatePct', 'statisticallySignificant',
        ];
        const recordValues = (value, keys, name) => {
            if (!value || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) {
                throw new TypeError(`${name} must be a plain data object`);
            }
            const prototype = Object.getPrototypeOf(value);
            if (prototype !== Object.prototype && prototype !== null)
                throw new TypeError(`${name} must have a plain object prototype`);
            const ownKeys = Reflect.ownKeys(value);
            if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) {
                throw new TypeError(`${name} has unknown or missing properties`);
            }
            const result = Object.create(null);
            for (const key of keys) {
                const descriptor = Object.getOwnPropertyDescriptor(value, key);
                if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
                    throw new TypeError(`${name}.${key} must be an enumerable own data property`);
                }
                result[key] = descriptor.value;
            }
            return result;
        };
        const arrayValues = (value, name) => {
            if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) {
                throw new TypeError(`${name} must be a plain array`);
            }
            const keys = Reflect.ownKeys(value);
            if (keys.length !== value.length + 1 || keys.some(key => key !== 'length' && (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) {
                throw new TypeError(`${name} must be a dense array without extra properties`);
            }
            const values = [];
            for (let i = 0; i < value.length; i += 1) {
                const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
                if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
                    throw new TypeError(`${name}[${i}] must be an own data element`);
                values.push(descriptor.value);
            }
            return values;
        };
        const candidateRecord = recordValues(candidate, candidateKeys, 'candidate');
        const rawFeatures = arrayValues(candidateRecord.features, 'candidate.features');
        if (typeof candidateRecord.strategyId !== 'string' || !candidateRecord.strategyId.trim())
            throw new TypeError('strategyId must be a non-empty string');
        if (rawFeatures.some(feature => typeof feature !== 'string' || !feature.trim()))
            throw new TypeError('features must contain non-empty strings');
        const finite = (value, name) => {
            if (typeof value !== 'number' || !Number.isFinite(value))
                throw new TypeError(`${name} must be finite`);
        };
        const rawSamples = arrayValues(candidateRecord.signalSignificanceSamples, 'candidate.signalSignificanceSamples');
        const samples = rawSamples.map((sample, index) => {
            const record = recordValues(sample, sampleKeys, `sample ${index}`);
            if (typeof record.featureName !== 'string' || !record.featureName.trim())
                throw new TypeError(`sample ${index} featureName is invalid`);
            if (!Number.isSafeInteger(record.sampleCount) || record.sampleCount <= 0)
                throw new RangeError(`sample ${index} sampleCount must be a positive safe integer`);
            for (const field of ['meanFutureReturnBps', 'randomBaselineReturnBps', 'pValue', 'maximumFavorableExcursionBps', 'maximumAdverseExcursionBps', 'rugAvoidanceRatePct']) {
                finite(record[field], `sample ${index} ${field}`);
            }
            const pValue = record.pValue;
            const favorable = record.maximumFavorableExcursionBps;
            const adverse = record.maximumAdverseExcursionBps;
            const rugAvoidance = record.rugAvoidanceRatePct;
            if (pValue < 0 || pValue > 1)
                throw new RangeError(`sample ${index} pValue must be between 0 and 1`);
            if (favorable < 0)
                throw new RangeError(`sample ${index} maximumFavorableExcursionBps cannot be negative`);
            if (adverse > 0)
                throw new RangeError(`sample ${index} maximumAdverseExcursionBps cannot be positive`);
            if (rugAvoidance < 0 || rugAvoidance > 100)
                throw new RangeError(`sample ${index} rugAvoidanceRatePct must be between 0 and 100`);
            if (typeof record.statisticallySignificant !== 'boolean')
                throw new TypeError(`sample ${index} statisticallySignificant must be boolean`);
            return Object.freeze({ ...record });
        });
        const booleans = ['temporalLeakageVerified', 'knowledgeCutValid', 'recursiveStateStable', 'clusterLeakageClean', 'protocolCompatibilityCertified', 'sealedHoldoutPositive'];
        for (const field of booleans)
            if (typeof candidateRecord[field] !== 'boolean')
                throw new TypeError(`${field} must be boolean`);
        if (!Number.isSafeInteger(candidateRecord.walkForwardFoldsPassed) || candidateRecord.walkForwardFoldsPassed < 0)
            throw new RangeError('walkForwardFoldsPassed must be a non-negative safe integer');
        finite(candidateRecord.monteCarloRuinProbabilityPct, 'monteCarloRuinProbabilityPct');
        if (candidateRecord.monteCarloRuinProbabilityPct < 0 || candidateRecord.monteCarloRuinProbabilityPct > 100)
            throw new RangeError('monteCarloRuinProbabilityPct must be between 0 and 100');
        return Object.freeze({
            strategyId: candidateRecord.strategyId,
            features: Object.freeze(rawFeatures),
            signalSignificanceSamples: Object.freeze(samples),
            temporalLeakageVerified: candidateRecord.temporalLeakageVerified,
            knowledgeCutValid: candidateRecord.knowledgeCutValid,
            recursiveStateStable: candidateRecord.recursiveStateStable,
            clusterLeakageClean: candidateRecord.clusterLeakageClean,
            protocolCompatibilityCertified: candidateRecord.protocolCompatibilityCertified,
            walkForwardFoldsPassed: candidateRecord.walkForwardFoldsPassed,
            sealedHoldoutPositive: candidateRecord.sealedHoldoutPositive,
            monteCarloRuinProbabilityPct: candidateRecord.monteCarloRuinProbabilityPct,
        });
    }
}
//# sourceMappingURL=research-truth-firewall.js.map