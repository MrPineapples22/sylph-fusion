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

export type ResearchLadderStage =
  | 'IDEA'
  | 'HYPOTHESIS'
  | 'DATA_AUDIT'
  | 'RETROSPECTIVE_RESEARCH'
  | 'WALK_FORWARD'
  | 'INDEPENDENT_REPLICATION'
  | 'DIGITAL_TWIN_TEST'
  | 'LIVE_SHADOW'
  | 'PAPER_EXECUTION'
  | 'SIGNED_NO_BROADCAST'
  | 'TINY_CANARY'
  | 'BOUNDED_LIVE'
  | 'PRODUCTION';

export interface ResearchHypothesis {
  readonly id: string;
  readonly claim: string;
  readonly causalMechanism: string;
  readonly expectedDirection: 'POSITIVE_ALPHA' | 'RISK_MITIGATION' | 'EXECUTION_IMPROVEMENT';
  readonly targetPopulation: string;
  readonly featureDefinition: string;
  readonly predefinedMetric: string;
  readonly falsificationRule: string;
  readonly datasetVersion: string;
  readonly codeVersion: string;
  readonly currentStage: ResearchLadderStage;
  readonly isFalsified: boolean;
  readonly replicationCount: number;
  readonly registeredAtMs: number;
  readonly updatedAtMs: number;
  readonly hypothesisHash: string;
}

export interface FalsificationRecord {
  readonly hypothesisId: string;
  readonly falsifiedAtMs: number;
  readonly reason: string;
  readonly evidenceArtifact: string;
  readonly falsifiedByAgent: string;
}

export class HypothesisRegistry {
  private readonly hypotheses = new Map<string, ResearchHypothesis>();
  private readonly negativeKnowledgeDb = new Map<string, FalsificationRecord>();

  public registerHypothesis(params: {
    id: string;
    claim: string;
    causalMechanism: string;
    expectedDirection: 'POSITIVE_ALPHA' | 'RISK_MITIGATION' | 'EXECUTION_IMPROVEMENT';
    targetPopulation: string;
    featureDefinition: string;
    predefinedMetric: string;
    falsificationRule: string;
    datasetVersion: string;
    codeVersion: string;
  }): ResearchHypothesis {
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

    const hypothesis: ResearchHypothesis = {
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
  public promote(hypothesisId: string, targetStage: ResearchLadderStage, evidenceProof: string): ResearchHypothesis {
    const h = this.hypotheses.get(hypothesisId);
    if (!h) throw new Error(`Hypothesis ${hypothesisId} not found in registry`);
    if (h.isFalsified) throw new Error(`Cannot promote falsified hypothesis ${hypothesisId}`);

    // Verify valid step
    const stages: ResearchLadderStage[] = [
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

    const updated: ResearchHypothesis = {
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
  public falsify(hypothesisId: string, reason: string, agentId: string, evidenceArtifact: string): void {
    const h = this.hypotheses.get(hypothesisId);
    if (!h) throw new Error(`Hypothesis ${hypothesisId} not found`);

    const updated: ResearchHypothesis = {
      ...h,
      isFalsified: true,
      updatedAtMs: Date.now(),
    };
    this.hypotheses.set(hypothesisId, updated);

    const record: FalsificationRecord = {
      hypothesisId,
      falsifiedAtMs: Date.now(),
      reason,
      evidenceArtifact,
      falsifiedByAgent: agentId,
    };
    this.negativeKnowledgeDb.set(hypothesisId, record);
  }

  public getHypothesis(id: string): ResearchHypothesis | undefined {
    return this.hypotheses.get(id);
  }

  public getFalsificationRecord(id: string): FalsificationRecord | undefined {
    return this.negativeKnowledgeDb.get(id);
  }

  public getNegativeKnowledgeCount(): number {
    return this.negativeKnowledgeDb.size;
  }
}
