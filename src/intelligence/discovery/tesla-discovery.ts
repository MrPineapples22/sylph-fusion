/**
 * TESLA: Active Discovery & Information-Gain Engine
 * Blueprint Engine #12
 * 
 * Asks: "What should SYLPH learn next?"
 * Ranks potential investigatory actions (wallet funding check, creator history, RPC pool inspect)
 * by net expected information gain versus time cost, compute cost, and alpha edge decay.
 * Invariant: WAIT is optimal if information value exceeds delay cost.
 */

export type TeslaInvestigationType = 
  | 'WALLET_FUNDING_ANCESTRY'
  | 'CREATOR_HISTORICAL_LAUNCHES'
  | 'WALLET_CLUSTERING_ANALYSIS'
  | 'RUGCHECK_SECURITY_AUDIT'
  | 'POOL_RESERVE_VERIFICATION'
  | 'HOLDERS_CONCENTRATION_SCAN';

export interface InvestigationCandidate {
  readonly type: TeslaInvestigationType;
  readonly target: string;
  readonly expected_info_gain: number; // 0.0 to 1.0 (entropy reduction)
  readonly time_cost_ms: number;
  readonly compute_cost_score: number;
  readonly alpha_decay_rate_bps_sec: number;
}

export interface TeslaRankingResult {
  readonly top_investigation?: InvestigationCandidate;
  readonly ranked_investigations: readonly InvestigationCandidate[];
  readonly should_wait_and_investigate: boolean;
  readonly net_value_of_waiting: number; // positive = WAIT, negative = ACT_NOW
  readonly reason: string;
}

export class TeslaInformationGainEngine {
  public static readonly VERSION = '1.0.0';

  /**
   * Evaluates and ranks candidate investigatory actions, determining whether waiting is justified.
   */
  public static evaluateNextActions(
    candidates: readonly InvestigationCandidate[],
    currentEdgeConfidence: number
  ): TeslaRankingResult {
    if (!candidates || candidates.length === 0) {
      return {
        ranked_investigations: [],
        should_wait_and_investigate: false,
        net_value_of_waiting: -1.0,
        reason: 'No investigatory candidates available.'
      };
    }

    // Rank candidates by Net Information Value = info_gain - (time_cost * decay + compute_cost)
    const scored = candidates.map(c => {
      const delayCost = (c.time_cost_ms / 1000) * (c.alpha_decay_rate_bps_sec / 10000);
      const computeCost = c.compute_cost_score * 0.05;
      const netValue = c.expected_info_gain - delayCost - computeCost;
      return { candidate: c, netValue };
    }).sort((a, b) => b.netValue - a.netValue);

    const best = scored[0];

    // If current confidence is already very high (> 0.85), waiting is rarely worth the decay
    const shouldWait = best.netValue > 0.15 && currentEdgeConfidence < 0.80;

    let reason = 'Investigation value exceeds delay cost. Recommend WAIT and gather evidence.';
    if (!shouldWait) {
      reason = best.netValue <= 0.15 
        ? 'Edge decay exceeds expected information gain. Recommend ACT or ABSTAIN.'
        : 'High existing confidence; delay is economically unwarranted.';
    }

    return {
      top_investigation: best.candidate,
      ranked_investigations: scored.map(s => s.candidate),
      should_wait_and_investigate: shouldWait,
      net_value_of_waiting: Number(best.netValue.toFixed(3)),
      reason
    };
  }
}
