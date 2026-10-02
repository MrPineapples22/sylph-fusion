/**
 * PAVLOV: Outcome Attribution & Decision Credit Engine
 * Blueprint Engine #39
 * 
 * Separates decision quality from financial outcome:
 * - GOOD_DECISION_GOOD_OUTCOME (Alpha confirmed)
 * - GOOD_DECISION_BAD_OUTCOME  (Adverse variance / tail event, preserve policy)
 * - BAD_DECISION_GOOD_OUTCOME  (Lucky gamble, do NOT reinforce policy)
 * - BAD_DECISION_BAD_OUTCOME   (System defect, penalize policy)
 * Evaluates TRADES as well as SKIPS, WAITS, BLOCKS, and ABSTENTIONS.
 */

export type PavlovCreditArchetype = 
  | 'GOOD_DECISION_GOOD_OUTCOME'
  | 'GOOD_DECISION_BAD_OUTCOME'
  | 'BAD_DECISION_GOOD_OUTCOME'
  | 'BAD_DECISION_BAD_OUTCOME'
  | 'UNKNOWN';

export type DecisionSoundness = boolean | 'UNKNOWN';

export interface PavlovAttributionRecord {
  readonly attribution_id: string;
  readonly token_mint: string;
  readonly action_taken: string;
  readonly was_decision_sound: DecisionSoundness;
  readonly realized_pnl_pct: number;
  readonly counterfactual_pnl_pct?: number; // PnL if we had done the opposite
  readonly credit_archetype: PavlovCreditArchetype;
  readonly policy_reinforcement_action: 'REINFORCE' | 'NEUTRAL_VARIANCE' | 'DO_NOT_REINFORCE_LUCK' | 'PENALIZE_POLICY' | 'NO_POLICY_UPDATE';
  readonly attribution_notes: string;
  readonly timestamp_ms: number;
}

export class PavlovOutcomeAttributionEngine {
  public static readonly VERSION = '1.0.0';
  private attributions: PavlovAttributionRecord[] = [];

  /**
   * Pure evaluation of supplied process evidence. Callers must verify that evidence
   * before using this result as an assessment. Outcomes and exit triggers are not evidence.
   */
  public static evaluateDecisionSoundness(params: {
    passedSafety?: boolean;
    washTradingProbability?: number;
    driftBps?: number;
    sufficientExitCapacity?: boolean;
    hasDevSoldPrior?: boolean;
    unverifiedExtensions?: boolean;
    executionPermitValid?: boolean;
    isPanicExit?: boolean;
    exitTrigger?: string;
    realizedPnlPct?: number;
    maePct?: number;
  }): { wasDecisionSound: DecisionSoundness; reason: string } {
    if (typeof params.passedSafety !== 'boolean') {
      return { wasDecisionSound: 'UNKNOWN', reason: 'MISSING_VERIFIED_PROCESS_EVIDENCE' };
    }
    if (!params.passedSafety) {
      return { wasDecisionSound: false, reason: 'FAILED_SAFETY_AUDIT' };
    }
    if (params.hasDevSoldPrior) {
      return { wasDecisionSound: false, reason: 'DEV_SOLD_PRIOR_TO_ENTRY' };
    }
    if (params.unverifiedExtensions) {
      return { wasDecisionSound: false, reason: 'UNVERIFIED_TOKEN_EXTENSIONS' };
    }
    if (params.washTradingProbability !== undefined && params.washTradingProbability > 0.35) {
      return { wasDecisionSound: false, reason: 'HIGH_WASH_TRADING_CONTAMINATION' };
    }
    if (params.driftBps !== undefined && params.driftBps > 200) {
      return { wasDecisionSound: false, reason: 'EXCESSIVE_ENTRY_PRICE_DRIFT' };
    }
    if (params.sufficientExitCapacity === false) {
      return { wasDecisionSound: false, reason: 'INSUFFICIENT_STRESSED_EXIT_CAPACITY' };
    }
    if (params.executionPermitValid === false) {
      return { wasDecisionSound: false, reason: 'INVALID_OR_EXPIRED_EXECUTION_PERMIT' };
    }
    return { wasDecisionSound: true, reason: 'SOUND_DECISION_PROCESS' };
  }

  /**
   * Evaluates decision credit for an outcome.
   */
  public attributeOutcome(params: {
    token_mint: string;
    action_taken: string;
    was_decision_sound: DecisionSoundness; // Pre-flight process was valid, risk checks passed, evidence verified
    realized_pnl_pct: number;
    counterfactual_pnl_pct?: number;
  }): PavlovAttributionRecord {
    let archetype: PavlovCreditArchetype;
    let policyAction: 'REINFORCE' | 'NEUTRAL_VARIANCE' | 'DO_NOT_REINFORCE_LUCK' | 'PENALIZE_POLICY' | 'NO_POLICY_UPDATE';
    let notes = '';

    const isProfit = params.realized_pnl_pct > 0;

    if (typeof params.was_decision_sound !== 'boolean') {
      archetype = 'UNKNOWN';
      policyAction = 'NO_POLICY_UPDATE';
      notes = 'Process quality is unassessed: verified process evidence is unavailable.';
    } else if (params.was_decision_sound && isProfit) {
      archetype = 'GOOD_DECISION_GOOD_OUTCOME';
      policyAction = 'REINFORCE';
      notes = 'Sound decision process produced profitable outcome. Reinforce policy weights.';
    } else if (params.was_decision_sound && !isProfit) {
      archetype = 'GOOD_DECISION_BAD_OUTCOME';
      policyAction = 'NEUTRAL_VARIANCE';
      notes = 'Sound decision met adverse tail variance. Do NOT penalize valid process.';
    } else if (!params.was_decision_sound && isProfit) {
      archetype = 'BAD_DECISION_GOOD_OUTCOME';
      policyAction = 'DO_NOT_REINFORCE_LUCK';
      notes = 'Flawed process produced lucky profit. Strictly avoid reinforcing bad habits.';
    } else {
      archetype = 'BAD_DECISION_BAD_OUTCOME';
      policyAction = 'PENALIZE_POLICY';
      notes = 'Flawed process caused loss. Penalize strategy and trigger parameter review.';
    }

    const record: PavlovAttributionRecord = {
      attribution_id: `pav_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      token_mint: params.token_mint,
      action_taken: params.action_taken,
      was_decision_sound: typeof params.was_decision_sound === 'boolean' ? params.was_decision_sound : 'UNKNOWN',
      realized_pnl_pct: params.realized_pnl_pct,
      counterfactual_pnl_pct: params.counterfactual_pnl_pct,
      credit_archetype: archetype,
      policy_reinforcement_action: policyAction,
      attribution_notes: notes,
      timestamp_ms: Date.now()
    };

    this.attributions.push(record);
    return record;
  }

  public getAttributions(): readonly PavlovAttributionRecord[] {
    return this.attributions;
  }
}
