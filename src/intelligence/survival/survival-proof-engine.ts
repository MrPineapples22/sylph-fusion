/**
 * SYLPH SURVIVAL PROOF ENGINE & ASSUMPTION REGISTRY
 * Parts XLIII, XLIV, XLV, XLVI, XLVII, XLVIII, XLIX, L, LI, LII, LIII, LIV —
 * Safety vs Liveness, Target Safe State, Proof Ladder (P0–P5), Proof Debt & Deterministic Fallback
 *
 * Distinguishes whether an action is safe (invariants hold) from whether the system
 * can still reach a safe capital state (liveness). Tracks epistemic proof debt and assumptions.
 */

export type ProofStrengthLevel =
  | 'P0_UNKNOWN'
  | 'P1_OBSERVED'
  | 'P2_CORROBORATED'
  | 'P3_VERIFIED'
  | 'P4_STRESS_VERIFIED'
  | 'P5_FORMALLY_CONSTRAINED';

export type TerminalSurvivalState =
  | 'NORMAL_OPERATION'
  | 'EXIT_TEMPORARILY_BLOCKED'
  | 'EXIT_SEMANTICALLY_BLOCKED'
  | 'LIQUIDITY_EXHAUSTED'
  | 'CHAIN_UNCERTAIN'
  | 'AUTONOMOUS_RECOVERY_EXHAUSTED'
  | 'SAFE_STATE_UNREACHABLE';

export interface TargetSafeState {
  readonly max_exposure_sol: number;
  readonly max_unknown_capital_sol: number;
  readonly min_exit_coverage_pct: number;
  readonly min_emergency_reserve_sol: number;
  readonly max_unresolved_intents: number;
}

export interface SurvivalClaim {
  readonly claim_id: string;
  readonly claim_text: string;
  readonly proof_level: ProofStrengthLevel;
  readonly dependencies: readonly string[];
  readonly verified_slot: number;
  readonly is_revoked: boolean;
}

export class SurvivalProofEngine {
  private proofGeneration = 1;
  private readonly claims = new Map<string, SurvivalClaim>();
  private readonly targetSafeState: TargetSafeState = {
    max_exposure_sol: 25.0,
    max_unknown_capital_sol: 5.0,
    min_exit_coverage_pct: 80.0,
    min_emergency_reserve_sol: 5.0,
    max_unresolved_intents: 2,
  };

  constructor() {
    this.registerClaim({
      claim_id: 'CLAIM_CAPITAL_TRUTH',
      claim_text: 'Authoritative Capital Ledger is synchronized and non-negative',
      proof_level: 'P5_FORMALLY_CONSTRAINED',
      dependencies: [],
      verified_slot: 1,
      is_revoked: false,
    });
    this.registerClaim({
      claim_id: 'CLAIM_VAULT_ISOLATION',
      claim_text: 'Custody signer isolated and enforcing hard spending bounds',
      proof_level: 'P5_FORMALLY_CONSTRAINED',
      dependencies: [],
      verified_slot: 1,
      is_revoked: false,
    });
  }

  public registerClaim(claim: SurvivalClaim): void {
    this.claims.set(claim.claim_id, claim);
  }

  public invalidateClaim(claimId: string): void {
    const claim = this.claims.get(claimId);
    if (claim) {
      this.claims.set(claimId, { ...claim, is_revoked: true });
      this.proofGeneration++;
    }
  }

  /**
   * Computes Progress Function: Distance to Target Safe State (Part XLV).
   * Emergency actions must monotonically reduce this distance.
   */
  public calculateDistanceToSafeState(current: {
    exposure_sol: number;
    unknown_capital_sol: number;
    exit_coverage_pct: number;
    emergency_reserve_sol: number;
    unresolved_intents_count: number;
  }): { distance: number; is_in_safe_state: boolean; terminal_state: TerminalSurvivalState } {
    let dist = 0;

    if (current.exposure_sol > this.targetSafeState.max_exposure_sol) {
      dist += (current.exposure_sol - this.targetSafeState.max_exposure_sol) * 2;
    }
    if (current.unknown_capital_sol > this.targetSafeState.max_unknown_capital_sol) {
      dist += (current.unknown_capital_sol - this.targetSafeState.max_unknown_capital_sol) * 4;
    }
    if (current.exit_coverage_pct < this.targetSafeState.min_exit_coverage_pct) {
      dist += (this.targetSafeState.min_exit_coverage_pct - current.exit_coverage_pct) * 0.5;
    }
    if (current.emergency_reserve_sol < this.targetSafeState.min_emergency_reserve_sol) {
      dist += (this.targetSafeState.min_emergency_reserve_sol - current.emergency_reserve_sol) * 10;
    }
    if (current.unresolved_intents_count > this.targetSafeState.max_unresolved_intents) {
      dist += (current.unresolved_intents_count - this.targetSafeState.max_unresolved_intents) * 5;
    }

    let terminal: TerminalSurvivalState = 'NORMAL_OPERATION';
    if (current.exit_coverage_pct < 10) {
      terminal = 'LIQUIDITY_EXHAUSTED';
    } else if (dist > 100) {
      terminal = 'AUTONOMOUS_RECOVERY_EXHAUSTED';
    }

    return {
      distance: Number(dist.toFixed(2)),
      is_in_safe_state: dist === 0,
      terminal_state: terminal,
    };
  }

  /**
   * Evaluates aggregate Proof Debt (Part LIII).
   * Uncorroborated or stale claims increase proof debt; if too high, system clamps to REDUCE_ONLY.
   */
  public evaluateProofDebt(): { proof_debt_score: number; requires_reduction_mode: boolean } {
    let debt = 0;
    for (const c of this.claims.values()) {
      if (c.is_revoked) debt += 10;
      else if (c.proof_level === 'P0_UNKNOWN') debt += 5;
      else if (c.proof_level === 'P1_OBSERVED') debt += 2;
    }

    return {
      proof_debt_score: debt,
      requires_reduction_mode: debt > 15,
    };
  }

  public getProofGeneration(): number {
    return this.proofGeneration;
  }
}
