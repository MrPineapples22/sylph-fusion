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
  | 'BAD_DECISION_BAD_OUTCOME';

export interface PavlovAttributionRecord {
  readonly attribution_id: string;
  readonly token_mint: string;
  readonly action_taken: string;
  readonly was_decision_sound: boolean;
  readonly realized_pnl_pct: number;
  readonly counterfactual_pnl_pct?: number; // PnL if we had done the opposite
  readonly credit_archetype: PavlovCreditArchetype;
  readonly policy_reinforcement_action: 'REINFORCE' | 'NEUTRAL_VARIANCE' | 'DO_NOT_REINFORCE_LUCK' | 'PENALIZE_POLICY';
  readonly attribution_notes: string;
  readonly timestamp_ms: number;
}

export class PavlovOutcomeAttributionEngine {
  public static readonly VERSION = '1.0.0';
  private attributions: PavlovAttributionRecord[] = [];

  /**
   * Evaluates decision soundness based on pre-flight authenticity, price drift, exit capacity, execution integrity,
   * and structural outcome metrics (e.g. catastrophic stop-outs, severe crash unwinds, and lucky gambles).
   */
  public static evaluateDecisionSoundness(params: {
    passedSafety: boolean;
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
  }): { wasDecisionSound: boolean; reason: string } {
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
    if (params.isPanicExit) {
      return { wasDecisionSound: false, reason: 'PANIC_EXIT_DISCIPLINE_BREACH' };
    }

    // Execution & outcome soundness checks:
    // 1. Unsound losses (Penalize Policy):
    if (params.realizedPnlPct !== undefined && params.realizedPnlPct <= -10) {
      return { wasDecisionSound: false, reason: 'CATASTROPHIC_STOP_LOSS_VIOLATION' };
    }
    if (params.exitTrigger === 'STOP_LOSS' && params.realizedPnlPct !== undefined && params.realizedPnlPct <= -7) {
      return { wasDecisionSound: false, reason: 'STOP_LOSS_THRESHOLD_BREACH' };
    }
    if (params.exitTrigger === 'EMERGENCY_UNWIND' && params.realizedPnlPct !== undefined && params.realizedPnlPct <= -7) {
      return { wasDecisionSound: false, reason: 'EMERGENCY_UNWIND_SEVERE_CRASH' };
    }
    if (params.maePct !== undefined && params.maePct <= -15) {
      return { wasDecisionSound: false, reason: 'SEVERE_ADVERSE_EXCURSION' };
    }

    // 2. Unsound profits (Filter Lucky Gamble):
    if (params.realizedPnlPct !== undefined && params.realizedPnlPct > 0) {
      if (params.exitTrigger === 'EMERGENCY_UNWIND') {
        return { wasDecisionSound: false, reason: 'LUCKY_EMERGENCY_UNWIND_PROFIT' };
      }
      if (params.exitTrigger === 'STOP_LOSS') {
        return { wasDecisionSound: false, reason: 'LUCKY_STOP_LOSS_REVERSAL' };
      }
      if (params.maePct !== undefined && params.maePct <= -12) {
        return { wasDecisionSound: false, reason: 'LUCKY_RECOVERY_FROM_EXTREME_DRAWDOWN' };
      }
    }

    return { wasDecisionSound: true, reason: 'SOUND_DECISION_PROCESS' };
  }

  /**
   * Evaluates decision credit for an outcome.
   */
  public attributeOutcome(params: {
    token_mint: string;
    action_taken: string;
    was_decision_sound: boolean; // Pre-flight process was valid, risk checks passed, evidence verified
    realized_pnl_pct: number;
    counterfactual_pnl_pct?: number;
  }): PavlovAttributionRecord {
    let archetype: PavlovCreditArchetype;
    let policyAction: 'REINFORCE' | 'NEUTRAL_VARIANCE' | 'DO_NOT_REINFORCE_LUCK' | 'PENALIZE_POLICY';
    let notes = '';

    const isProfit = params.realized_pnl_pct > 0;

    if (params.was_decision_sound && isProfit) {
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
      was_decision_sound: params.was_decision_sound,
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
