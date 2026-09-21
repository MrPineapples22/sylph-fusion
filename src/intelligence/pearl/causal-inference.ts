/**
 * SOL-SYLPH PEARL — Causal Identification, Natural Experiments & Self-Impact Tracking
 * Part X — Causal Questions, Identifiability, Confounders vs Colliders & Self-Caused Evidence
 */

export type CausalNodeRole =
  | 'CAUSE'
  | 'CONFOUNDER'
  | 'MEDIATOR'
  | 'COLLIDER'
  | 'OUTCOME'
  | 'UNKNOWN';

export type IdentifiabilityState =
  | 'IDENTIFIED'
  | 'PLAUSIBLY_IDENTIFIED'
  | 'PARTIALLY_IDENTIFIED'
  | 'ASSUMPTION_SENSITIVE'
  | 'NOT_IDENTIFIABLE'
  | 'UNKNOWN';

export type CausalScoreClassification =
  | 'CAUSAL_CANDIDATE'
  | 'PROXY'
  | 'MEDIATOR'
  | 'CONSEQUENCE'
  | 'REDUNDANT_CORRELATE'
  | 'UNKNOWN';

export interface CausalQuestion {
  readonly question_id: string;
  readonly treatment: string;
  readonly outcome: string;
  readonly population: string;
  readonly candidate_confounders: readonly string[];
  readonly candidate_mediators: readonly string[];
  readonly candidate_colliders: readonly string[];
  readonly identification_strategy: string;
  readonly required_assumptions: readonly string[];
  readonly identifiability_state: IdentifiabilityState;
  readonly uncertainty: number;
}

export interface NaturalExperimentMatch {
  readonly experiment_id: string;
  readonly token_a_treatment: string;
  readonly token_b_control: string;
  readonly matched_features: readonly string[];
  readonly outcome_difference_pct: number;
  readonly causal_estimate: number;
  readonly confidence: number;
}

export class PearlCausalEngine {
  private readonly selfCausedEvents = new Set<string>();

  /**
   * Evaluate causal identifiability of a market question.
   */
  public evaluateIdentifiability(params: {
    treatment: string;
    outcome: string;
    confounders: readonly string[];
    has_unobserved_confounder: boolean;
    has_collider_conditioning: boolean;
  }): CausalQuestion {
    let state: IdentifiabilityState = 'IDENTIFIED';
    const assumptions: string[] = ['No unobserved confounders (Exchangeability)', 'Positivity across treatment levels'];

    if (params.has_collider_conditioning) {
      state = 'NOT_IDENTIFIABLE';
      assumptions.push('Conditioning on collider introduces Berkson/selection bias');
    } else if (params.has_unobserved_confounder) {
      state = 'ASSUMPTION_SENSITIVE';
      assumptions.push('Causal interpretation strictly sensitive to unobserved insider coordination');
    } else if (params.confounders.length > 5) {
      state = 'PARTIALLY_IDENTIFIED';
    } else if (params.confounders.length > 0) {
      state = 'PLAUSIBLY_IDENTIFIED';
      assumptions.push('Confounders partially addressed via backdoor adjustment');
    }

    return {
      question_id: `cq_${params.treatment}_to_${params.outcome}`,
      treatment: params.treatment,
      outcome: params.outcome,
      population: 'Solana Meme Token Micro-Caps',
      candidate_confounders: params.confounders,
      candidate_mediators: ['bonding_curve_velocity', 'dex_liquidity_depth'],
      candidate_colliders: ['kol_tweet_co_occurrence', 'trending_bot_inclusion'],
      identification_strategy: 'Backdoor Adjustment with Propensity Matching',
      required_assumptions: assumptions,
      identifiability_state: state,
      uncertainty: state === 'IDENTIFIED' ? 0.15 : state === 'PLAUSIBLY_IDENTIFIED' ? 0.35 : 0.85,
    };
  }

  /**
   * Conduct Natural Experiment comparison across matched twins.
   */
  public compareNaturalExperiment(params: {
    token_treatment: { mint: string; treatment_present: boolean; return_5m_pct: number };
    token_control: { mint: string; treatment_present: boolean; return_5m_pct: number };
    matched_covariates: readonly string[];
  }): NaturalExperimentMatch {
    const diff = params.token_treatment.return_5m_pct - params.token_control.return_5m_pct;
    return {
      experiment_id: `natexp_${params.token_treatment.mint.slice(0, 6)}_${params.token_control.mint.slice(0, 6)}`,
      token_a_treatment: params.token_treatment.mint,
      token_b_control: params.token_control.mint,
      matched_features: params.matched_covariates,
      outcome_difference_pct: Number(diff.toFixed(2)),
      causal_estimate: Number((diff * 0.8).toFixed(2)), // conservative shrinkage
      confidence: 0.78,
    };
  }

  /**
   * Audit existing scoring components for causal validity.
   */
  public auditScores(): Record<string, CausalScoreClassification> {
    return {
      creator_wallet_prior_rugs: 'CAUSAL_CANDIDATE',
      top_10_holder_concentration: 'CAUSAL_CANDIDATE',
      pump_score_momentum: 'PROXY',
      bonding_curve_velocity: 'MEDIATOR',
      social_hype_mentions: 'CONSEQUENCE',
      wash_trading_overlap: 'REDUNDANT_CORRELATE',
    };
  }

  /**
   * Register execution as self-caused evidence to prevent reflexive feedback loops.
   */
  public registerSelfExecution(mint: string, txSignature: string): void {
    this.selfCausedEvents.add(`${mint}:${txSignature}`);
  }

  /**
   * Check if a price spike was caused by our own order.
   */
  public isSelfCaused(mint: string, txSignature?: string): boolean {
    if (!txSignature) return false;
    return this.selfCausedEvents.has(`${mint}:${txSignature}`);
  }
}
