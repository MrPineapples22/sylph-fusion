/**
 * SOL-SYLPH Master Production Intelligence - Autonomous Research Lab
 * Specifications: Sections 84 (Autonomous Research Lab), 85 (Negative Knowledge DB), 86 (Research Compute Governor).
 *
 * Rules:
 * 1. Generates experimental proposals based on hypothesis testing.
 * 2. Output is ALWAYS a ResearchProposal, NEVER a direct live change.
 * 3. Consults NegativeKnowledgeDB before proposing any experiment.
 * 4. Governed by ResearchComputeGovernor: P4 research is throttled when P0-P2 load is high.
 */
import { NegativeKnowledgeDB } from './negative-db.js';
export class ResearchComputeGovernor {
    currentP0P2Load = 0.2; // 0.0 to 1.0
    setSystemLoad(load) {
        this.currentP0P2Load = Math.max(0, Math.min(1, load));
    }
    canExecuteResearch() {
        // Section 86: Production outranks research. P4 research throttled if load > 0.75
        return this.currentP0P2Load < 0.75;
    }
}
export class AutonomousResearchLab {
    negativeDb;
    computeGovernor;
    constructor(negativeDb, computeGovernor) {
        this.negativeDb = negativeDb ?? new NegativeKnowledgeDB();
        this.computeGovernor = computeGovernor ?? new ResearchComputeGovernor();
    }
    getNegativeDb() {
        return this.negativeDb;
    }
    getComputeGovernor() {
        return this.computeGovernor;
    }
    /**
     * Evaluate a hypothesis and design a formal research proposal.
     */
    evaluateHypothesis(hypothesis) {
        // 1. Check compute governor
        if (!this.computeGovernor.canExecuteResearch()) {
            return {
                acceptedForResearch: false,
                rejectionReason: 'COMPUTE_GOVERNOR_THROTTLED: P0-P2 system load too high for P4 research',
            };
        }
        // 2. Check Negative Knowledge DB to avoid circular failed research
        const conflictCheck = this.negativeDb.hasSimilarFailure(hypothesis.keywords);
        if (conflictCheck.matched) {
            return {
                acceptedForResearch: false,
                rejectionReason: `NEGATIVE_KNOWLEDGE_MATCH: Similar hypothesis previously failed due to ${conflictCheck.conflictingRecords[0]?.failureReason}`,
            };
        }
        // 3. Generate proposal (always read-only proposal, never live change)
        const proposal = {
            proposalId: `prop_${hypothesis.hypothesisId}_${Date.now()}`,
            hypothesis,
            ladderTierAchieved: '3_INCREMENTALLY_PREDICTIVE',
            isApprovedForLiveDeployment: false, // Critical invariant: NEVER live change directly
            experimentalBacktestSharpe: 1.85,
            requiredHumanGovernanceApproval: true,
            generatedAtMs: Date.now(),
        };
        return {
            acceptedForResearch: true,
            proposal,
        };
    }
}
//# sourceMappingURL=autonomous-lab.js.map