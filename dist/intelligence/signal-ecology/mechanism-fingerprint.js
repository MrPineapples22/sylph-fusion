/**
 * SYLPH FUSION — STRATEGY MECHANISM FINGERPRINTING & NEGATIVE-KNOWLEDGE ECOLOGY
 * Specifications: Blueprint Section 41
 * Workbook: #603, #607, #611, #615, #619, #623, #627, #631, #635, #639
 *
 * Invariant:
 * 1. Renamed strategies with identical or near-identical mechanisms are detected as semantic duplicates.
 * 2. Falsified mechanisms produce permanent negative-knowledge records; near-duplicates inherit
 *    a falsification prior and require strict proof of incremental contribution before admission.
 */
import { createHash } from 'node:crypto';
export class StrategyEcologyRegistry {
    registeredFingerprints = new Map();
    falsifiedMechanisms = new Map();
    static computeFingerprintHash(params) {
        const canonicalPayload = [
            [...params.inputs].sort().join(','),
            [...params.featureTransformations].sort().join(','),
            params.hypothesis.trim().toLowerCase(),
            params.decisionRule.trim().toLowerCase(),
            params.riskRule.trim().toLowerCase(),
            params.capitalRule.trim().toLowerCase(),
            params.executionRoute.trim().toLowerCase(),
            params.exitRule.trim().toLowerCase(),
            params.targetRegime.trim().toLowerCase(),
        ].join('||');
        return createHash('sha256').update(canonicalPayload).digest('hex');
    }
    registerStrategy(params) {
        const fingerprintHash = StrategyEcologyRegistry.computeFingerprintHash(params);
        const fingerprint = {
            ...params,
            fingerprintHash,
        };
        this.registeredFingerprints.set(params.strategyId, fingerprint);
        return fingerprint;
    }
    recordFalsifiedMechanism(record) {
        this.falsifiedMechanisms.set(record.fingerprintHash, record);
    }
    /**
     * Evaluates candidate strategy against known mechanism ecology.
     * Detects semantic duplicates and falsification inheritance.
     */
    evaluateCandidate(candidate) {
        const candidateHash = StrategyEcologyRegistry.computeFingerprintHash(candidate);
        // 1. Direct falsification check
        const directFalsified = this.falsifiedMechanisms.get(candidateHash);
        if (directFalsified) {
            return {
                candidateStrategyId: candidate.strategyId,
                matchedStrategyId: directFalsified.strategyId,
                similarityScore: 1.0,
                isSemanticDuplicate: true,
                inheritsFalsificationPrior: true,
                priorFalsificationRecord: directFalsified,
                requiredOosSampleHurdle: 500, // Strict penalty for resurrecting a falsified mechanism
            };
        }
        let highestSimilarity = 0;
        let matchedId = '';
        let inheritedFalsification;
        // 2. Check similarity against all registered and falsified mechanisms
        for (const [id, existing] of this.registeredFingerprints) {
            if (id === candidate.strategyId)
                continue;
            const score = this.calculateSimilarity(candidate, existing);
            if (score > highestSimilarity) {
                highestSimilarity = score;
                matchedId = id;
            }
        }
        for (const falsified of this.falsifiedMechanisms.values()) {
            // Find original fingerprint if available
            const existing = this.registeredFingerprints.get(falsified.strategyId);
            if (existing) {
                const score = this.calculateSimilarity(candidate, existing);
                if (score >= 0.8 && (!inheritedFalsification || score > highestSimilarity)) {
                    inheritedFalsification = falsified;
                }
            }
        }
        const isDuplicate = highestSimilarity >= 0.85;
        const inheritsFalsification = Boolean(inheritedFalsification);
        return {
            candidateStrategyId: candidate.strategyId,
            matchedStrategyId: matchedId,
            similarityScore: Number(highestSimilarity.toFixed(4)),
            isSemanticDuplicate: isDuplicate,
            inheritsFalsificationPrior: inheritsFalsification,
            priorFalsificationRecord: inheritedFalsification,
            requiredOosSampleHurdle: inheritsFalsification ? 300 : isDuplicate ? 200 : 100,
        };
    }
    calculateSimilarity(a, b) {
        const inputSim = this.jaccardSimilarity(new Set(a.inputs), new Set(b.inputs));
        const transSim = this.jaccardSimilarity(new Set(a.featureTransformations), new Set(b.featureTransformations));
        const routeSim = a.executionRoute === b.executionRoute ? 1.0 : 0.0;
        const regimeSim = a.targetRegime === b.targetRegime ? 1.0 : 0.0;
        const ruleSim = (a.decisionRule === b.decisionRule ? 0.5 : 0) +
            (a.riskRule === b.riskRule ? 0.3 : 0) +
            (a.exitRule === b.exitRule ? 0.2 : 0);
        return inputSim * 0.3 + transSim * 0.2 + routeSim * 0.15 + regimeSim * 0.15 + ruleSim * 0.2;
    }
    jaccardSimilarity(setA, setB) {
        if (setA.size === 0 && setB.size === 0)
            return 1.0;
        let intersection = 0;
        for (const elem of setA) {
            if (setB.has(elem))
                intersection++;
        }
        const union = setA.size + setB.size - intersection;
        return union > 0 ? intersection / union : 0;
    }
}
//# sourceMappingURL=mechanism-fingerprint.js.map