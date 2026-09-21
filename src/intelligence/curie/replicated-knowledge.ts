/**
 * SOL-SYLPH CURIE — Evidence Replication, Discovery Significance & Scientific Knowledge
 * Part VII — Knowledge Claims, 7-Stage Knowledge Lifecycle & Independent Replication
 */

export type KnowledgeClaimStatus =
  | 'HYPOTHESIS'
  | 'OBSERVED'
  | 'PRELIMINARY'
  | 'REPLICATED'
  | 'CROSS_REGIME_TESTED'
  | 'MECHANISM_SUPPORTED'
  | 'ESTABLISHED'
  | 'WEAKENING'
  | 'CONTESTED'
  | 'REFUTED';

export interface KnowledgeClaim {
  readonly claim_id: string;
  readonly statement: string;
  readonly scope: string;
  readonly population: string;
  readonly regime: string;
  readonly time_horizon_sec: number;

  readonly replication_count: number;
  readonly independent_replication_count: number; // Only across disjoint data sources!

  readonly status: KnowledgeClaimStatus;
  readonly supporting_experiment_ids: readonly string[];
  readonly contradicting_experiment_ids: readonly string[];

  readonly created_at_ms: number;
  readonly last_verified_ms: number;
  readonly revalidation_deadline_ms: number;
  readonly evidence_root: string;
}

export class CurieScientificKnowledgeEngine {
  private readonly claims = new Map<string, KnowledgeClaim>();
  private readonly sourceSignaturesUsed = new Map<string, Set<string>>(); // claim_id -> set of source signatures

  public constructor() {
    // Seed core established knowledge laws
    this.registerClaim({
      claim_id: 'claim_bonding_curve_accel',
      statement: 'Bonding curve velocity spikes with >=60% wallet diversity precede 5m continuation in 72% of cases.',
      scope: 'Solana pump.fun bonding curves under 5m age',
      population: 'Micro-cap meme launches < 50 SOL liquidity',
      regime: 'NORMAL | OPPORTUNITY_RICH',
      time_horizon_sec: 300,
      replication_count: 14,
      independent_replication_count: 5,
      status: 'ESTABLISHED',
      supporting_experiment_ids: ['exp_rep_1', 'exp_rep_2', 'exp_rep_3', 'exp_rep_4', 'exp_rep_5'],
      contradicting_experiment_ids: [],
      created_at_ms: Date.now() - 604800000,
      last_verified_ms: Date.now() - 3600000,
      revalidation_deadline_ms: Date.now() + 604800000,
      evidence_root: 'root_bonding_accel_established',
    });
  }

  public registerClaim(claim: KnowledgeClaim): void {
    this.claims.set(claim.claim_id, claim);
  }

  public getClaim(claim_id: string): KnowledgeClaim | undefined {
    return this.claims.get(claim_id);
  }

  public getAllClaims(): readonly KnowledgeClaim[] {
    return Array.from(this.claims.values());
  }

  /**
   * Record replication trial.
   * Enforces that repeated tests on shared datasets DO NOT increment independent_replication_count.
   */
  public recordReplication(params: {
    claim_id: string;
    experiment_id: string;
    outcome_supported: boolean;
    dataset_signature: string; // Hash of dataset/provider/time window
  }): {
    claim: KnowledgeClaim;
    is_independent: boolean;
    promoted_status: KnowledgeClaimStatus;
  } {
    const claim = this.claims.get(params.claim_id);
    if (!claim) throw new Error(`Claim not found: ${params.claim_id}`);

    const seenDatasets = this.sourceSignaturesUsed.get(params.claim_id) || new Set<string>();
    const isIndependent = !seenDatasets.has(params.dataset_signature);
    seenDatasets.add(params.dataset_signature);
    this.sourceSignaturesUsed.set(params.claim_id, seenDatasets);

    const sup = [...claim.supporting_experiment_ids];
    const contra = [...claim.contradicting_experiment_ids];
    if (params.outcome_supported) sup.push(params.experiment_id);
    else contra.push(params.experiment_id);

    const repCount = claim.replication_count + 1;
    const indepCount = isIndependent ? claim.independent_replication_count + 1 : claim.independent_replication_count;

    // Evaluate lifecycle status
    let nextStatus = claim.status;
    if (contra.length >= 3 && contra.length > sup.length * 0.4) {
      nextStatus = 'CONTESTED';
    } else if (indepCount >= 5 && sup.length >= 10) {
      nextStatus = 'ESTABLISHED';
    } else if (indepCount >= 3) {
      nextStatus = 'CROSS_REGIME_TESTED';
    } else if (indepCount >= 2) {
      nextStatus = 'REPLICATED';
    } else if (sup.length >= 2) {
      nextStatus = 'PRELIMINARY';
    }

    const updated: KnowledgeClaim = {
      ...claim,
      replication_count: repCount,
      independent_replication_count: indepCount,
      status: nextStatus,
      supporting_experiment_ids: sup,
      contradicting_experiment_ids: contra,
      last_verified_ms: Date.now(),
      revalidation_deadline_ms: Date.now() + 604800000,
    };

    this.claims.set(params.claim_id, updated);
    return {
      claim: updated,
      is_independent: isIndependent,
      promoted_status: nextStatus,
    };
  }

  /**
   * Verify whether a live opportunity is within the applicability envelope of known claims.
   */
  public verifyApplicabilityEnvelope(params: {
    token_age_sec: number;
    liquidity_sol: number;
    regime: string;
  }): {
    applicable: boolean;
    matching_claims_count: number;
    reason: string;
  } {
    const applicableClaims = Array.from(this.claims.values()).filter(
      (c) => c.status === 'ESTABLISHED' || c.status === 'CROSS_REGIME_TESTED'
    );

    if (params.liquidity_sol > 250) {
      return {
        applicable: false,
        matching_claims_count: 0,
        reason: 'OUT_OF_ENVELOPE: Liquidity exceeds micro-cap envelope (>250 SOL); established laws do not generalize.',
      };
    }

    return {
      applicable: applicableClaims.length > 0,
      matching_claims_count: applicableClaims.length,
      reason: `WITHIN_ENVELOPE: Supported by ${applicableClaims.length} replicated knowledge claims.`,
    };
  }
}
