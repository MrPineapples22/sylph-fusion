/**
 * SOL-SYLPH Master Production Intelligence - Evidence Council & Dependency Graph
 * Specifications: Sections 26 (Do Not Use Simple Voting), 29 (Evidence Council),
 * 34 (Contradiction Engine), 35 (Assumption Registry).
 *
 * Rules:
 * 1. Never implement simplistic voting (7 BUY, 3 SELL -> BUY).
 * 2. Track feature/source overlap between agents; calculate EffectiveEvidenceCount.
 * 3. Contradictions between models increase uncertainty or force abstention.
 */
export class EvidenceDependencyGraph {
    agentProfiles = new Map();
    registerAgentProfile(profile) {
        this.agentProfiles.set(profile.agentId, profile);
    }
    /**
     * Calculates EffectiveEvidenceCount by discounting agents that share the same data sources or features.
     */
    calculateEffectiveEvidenceCount(participatingAgentIds) {
        if (participatingAgentIds.length === 0)
            return 0;
        const observedSources = new Set();
        const observedFeatureFamilies = new Set();
        for (const id of participatingAgentIds) {
            const p = this.agentProfiles.get(id);
            if (p) {
                for (const s of p.primaryDataSources)
                    observedSources.add(s);
                for (const f of p.featureFamiliesUsed)
                    observedFeatureFamilies.add(f);
            }
            else {
                observedSources.add(id);
            }
        }
        // Effective count is bounded by independent data sources and feature families
        const sourceFactor = Math.min(participatingAgentIds.length, observedSources.size * 1.2);
        const featureFactor = Math.min(participatingAgentIds.length, observedFeatureFamilies.size * 1.1);
        const effective = Math.min(participatingAgentIds.length, Math.max(1, (sourceFactor + featureFactor) / 2));
        return Number(effective.toFixed(2));
    }
}
export class EvidenceCouncil {
    dependencyGraph;
    constructor(dependencyGraph = new EvidenceDependencyGraph()) {
        this.dependencyGraph = dependencyGraph;
    }
    evaluate(assessments, skepticVeto) {
        const now = Date.now();
        const hardVetoes = [];
        if (assessments.length === 0) {
            return {
                state: 'INSUFFICIENT_EVIDENCE',
                effectiveEvidenceCount: 0,
                rawAgentCount: 0,
                consensusProbability: 0,
                meanConfidence: 0,
                contradictionDetected: false,
                hardVetoes: ['zero_assessments_submitted'],
                authorizedToProceed: false,
                evaluatedAtMs: now,
            };
        }
        if (skepticVeto) {
            hardVetoes.push('skeptic_veto');
        }
        // 1. Calculate Effective Evidence Count
        const agentIds = assessments.map((a) => a.agentId);
        const effectiveCount = this.dependencyGraph.calculateEffectiveEvidenceCount(agentIds);
        // 2. Check Contradictions (e.g. High Bullish + Extreme OOD)
        let contradictionDetected = false;
        let contradictionDetails;
        let sumProb = 0;
        let sumConf = 0;
        let minProb = 1.0;
        let maxProb = 0.0;
        for (const a of assessments) {
            sumProb += a.bullishProbability;
            sumConf += a.confidence;
            if (a.bullishProbability < minProb)
                minProb = a.bullishProbability;
            if (a.bullishProbability > maxProb)
                maxProb = a.bullishProbability;
            // Check logical contradictions
            if (a.bullishProbability >= 0.8 && a.isOod) {
                contradictionDetected = true;
                contradictionDetails = `Contradiction: Agent ${a.agentId} claims high bullish (${a.bullishProbability}) while in extreme OOD`;
            }
            if (a.violatedAssumptions.length > 0) {
                hardVetoes.push(...a.violatedAssumptions.map((v) => `violated_assumption: ${v}`));
            }
        }
        const meanProb = sumProb / assessments.length;
        const meanConf = sumConf / assessments.length;
        // Disagreement between independent agents > 0.5 spread
        if (maxProb - minProb >= 0.5) {
            contradictionDetected = true;
            contradictionDetails = `High agent divergence: spread ${(maxProb - minProb).toFixed(2)} between agents`;
        }
        // 3. Determine Council State
        let state = 'WEAK_CONSENSUS';
        if (contradictionDetected) {
            state = 'CONFLICTED';
        }
        else if (effectiveCount < 2.0) {
            state = 'INSUFFICIENT_EVIDENCE';
        }
        else if (meanProb >= 0.65 && meanConf >= 0.7) {
            state = 'STRONG_CONSENSUS';
        }
        else if (meanProb < 0.45) {
            state = 'CONFLICTED';
        }
        const authorized = !skepticVeto &&
            hardVetoes.length === 0 &&
            !contradictionDetected &&
            (state === 'STRONG_CONSENSUS' || state === 'WEAK_CONSENSUS') &&
            effectiveCount >= 2.0;
        return {
            state,
            effectiveEvidenceCount: effectiveCount,
            rawAgentCount: assessments.length,
            consensusProbability: Number(meanProb.toFixed(3)),
            meanConfidence: Number(meanConf.toFixed(3)),
            contradictionDetected,
            contradictionDetails,
            hardVetoes,
            authorizedToProceed: authorized,
            evaluatedAtMs: now,
        };
    }
}
//# sourceMappingURL=evidence-council.js.map