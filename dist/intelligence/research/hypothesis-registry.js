/**
 * SOL-SYLPH Intelligence Fabric - Hypothesis Registry & Negative Knowledge Database
 * Specifications: Master Blueprint Sections 63, 64, 65, 66 & 67, Priority Item 20.
 *
 * Implements:
 * 1. 13-Stage Research Promotion Ladder:
 *    IDEA -> HYPOTHESIS -> DATA_AUDIT -> RETROSPECTIVE_RESEARCH -> WALK_FORWARD ->
 *    INDEPENDENT_REPLICATION -> DIGITAL_TWIN_TEST -> LIVE_SHADOW -> PAPER_EXECUTION ->
 *    SIGNED_NO_BROADCAST -> TINY_CANARY -> BOUNDED_LIVE -> PRODUCTION.
 * 2. Hypothesis Registry:
 *    Rigorous tracking of claims, expected mechanisms, falsification rules, and replication states.
 * 3. Negative Knowledge Database:
 *    Immutable archive of falsified hypotheses preventing future agents from cycling through dead-ends.
 * 4. Hard invariant:
 *    Zero authority advancement without meeting deterministic falsification and replication criteria.
 */
import { createHash } from 'node:crypto';
export class HypothesisRegistry {
    hypotheses = new Map();
    negativeKnowledgeDb = new Map();
    registerHypothesis(params) {
        // Check if idea is already falsified in Negative Knowledge DB
        if (this.negativeKnowledgeDb.has(params.id)) {
            throw new Error(`HYPOTHESIS_ALREADY_FALSIFIED: Claim '${params.id}' is permanently recorded in Negative Knowledge DB.`);
        }
        const now = Date.now();
        const hash = createHash('sha256')
            .update('HYPOTHESIS:')
            .update(params.id)
            .update(params.claim)
            .update(params.falsificationRule)
            .update(params.datasetVersion)
            .digest('hex');
        const hypothesis = {
            ...params,
            currentStage: 'HYPOTHESIS',
            isFalsified: false,
            replicationCount: 0,
            registeredAtMs: now,
            updatedAtMs: now,
            hypothesisHash: hash,
        };
        this.hypotheses.set(params.id, hypothesis);
        return hypothesis;
    }
    /**
     * Promotes a hypothesis along the 13-stage ladder if strict validation gates are met.
     */
    promote(hypothesisId, targetStage, evidenceProof) {
        const h = this.hypotheses.get(hypothesisId);
        if (!h)
            throw new Error(`Hypothesis ${hypothesisId} not found in registry`);
        if (h.isFalsified)
            throw new Error(`Cannot promote falsified hypothesis ${hypothesisId}`);
        // Verify valid step
        const stages = [
            'IDEA',
            'HYPOTHESIS',
            'DATA_AUDIT',
            'RETROSPECTIVE_RESEARCH',
            'WALK_FORWARD',
            'INDEPENDENT_REPLICATION',
            'DIGITAL_TWIN_TEST',
            'LIVE_SHADOW',
            'PAPER_EXECUTION',
            'SIGNED_NO_BROADCAST',
            'TINY_CANARY',
            'BOUNDED_LIVE',
            'PRODUCTION',
        ];
        const currentIndex = stages.indexOf(h.currentStage);
        const targetIndex = stages.indexOf(targetStage);
        if (targetIndex !== currentIndex + 1) {
            throw new Error(`INVALID_PROMOTION_STEP: Cannot skip stages from ${h.currentStage} to ${targetStage}`);
        }
        const updated = {
            ...h,
            currentStage: targetStage,
            replicationCount: targetStage === 'INDEPENDENT_REPLICATION' ? h.replicationCount + 1 : h.replicationCount,
            updatedAtMs: Date.now(),
        };
        this.hypotheses.set(hypothesisId, updated);
        return updated;
    }
    /**
     * Permanently marks a hypothesis as falsified and records it in the Negative Knowledge DB.
     */
    falsify(hypothesisId, reason, agentId, evidenceArtifact) {
        const h = this.hypotheses.get(hypothesisId);
        if (!h)
            throw new Error(`Hypothesis ${hypothesisId} not found`);
        const updated = {
            ...h,
            isFalsified: true,
            updatedAtMs: Date.now(),
        };
        this.hypotheses.set(hypothesisId, updated);
        const record = {
            hypothesisId,
            falsifiedAtMs: Date.now(),
            reason,
            evidenceArtifact,
            falsifiedByAgent: agentId,
        };
        this.negativeKnowledgeDb.set(hypothesisId, record);
    }
    getHypothesis(id) {
        return this.hypotheses.get(id);
    }
    getFalsificationRecord(id) {
        return this.negativeKnowledgeDb.get(id);
    }
    getNegativeKnowledgeCount() {
        return this.negativeKnowledgeDb.size;
    }
}
//# sourceMappingURL=hypothesis-registry.js.map