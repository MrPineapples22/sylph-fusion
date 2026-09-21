/**
 * BAYES: Decision-Theoretic Action Engine
 * Blueprint Engine #23
 * 
 * Formalizes decision-making under uncertainty across 9 canonical actions:
 * ENTER | WAIT | INVESTIGATE | ENTER_SMALL | SCALE | HOLD | REDUCE | EXIT | ABSTAIN.
 * Compares: Expected Utility, Downside Tail Risk, Information Value, and Delay Cost.
 * Implements Stop-Thinking Rule: Stop investigating when marginal info gain < delay + compute decay.
 */

export type BayesAction = 
  | 'ENTER'
  | 'WAIT'
  | 'INVESTIGATE'
  | 'ENTER_SMALL'
  | 'SCALE'
  | 'HOLD'
  | 'REDUCE'
  | 'EXIT'
  | 'ABSTAIN';

export interface ActionUtilityEvaluation {
  readonly action: BayesAction;
  readonly expected_utility: number;
  readonly downside_tail_risk: number;
  readonly execution_cost_bps: number;
  readonly exitability_factor: number;
  readonly portfolio_synergy: number;
}

export interface BayesDecisionResult {
  readonly token_mint: string;
  readonly selected_action: BayesAction;
  readonly recommended_allocation_pct: number; // 0.0 to 1.0 (of max position size)
  readonly expected_utility: number;
  readonly stop_thinking_triggered: boolean;
  readonly action_rankings: readonly ActionUtilityEvaluation[];
  readonly decision_rationale: string;
  readonly evaluated_at_ms: number;
}

export class BayesDecisionTheoreticActionEngine {
  public static readonly VERSION = '1.0.0';

  /**
   * Computes expected utilities for all candidate actions and selects optimal action.
   */
  public static evaluateDecision(params: {
    token_mint: string;
    expected_ev_pnl: number;
    tail_risk_drawdown: number;
    exitability: number;
    uncertainty_mass: number;
    info_gain_potential: number;
    delay_cost: number;
    current_position_size_sol: number;
    max_position_size_sol: number;
  }): BayesDecisionResult {
    const hasPosition = params.current_position_size_sol > 0;
    const infoGain = params.info_gain_potential;
    const delayCost = params.delay_cost;

    // Stop-thinking rule: If marginal information gain is less than delay cost, do not investigate further
    const stopThinking = infoGain <= delayCost;

    const evaluations: ActionUtilityEvaluation[] = [];

    // 1. ABSTAIN
    evaluations.push({
      action: 'ABSTAIN',
      expected_utility: 0.0,
      downside_tail_risk: 0.0,
      execution_cost_bps: 0,
      exitability_factor: 1.0,
      portfolio_synergy: 0.0
    });

    // 2. WAIT
    const waitUtility = !stopThinking ? (infoGain - delayCost) * 10 : -5.0;
    evaluations.push({
      action: 'WAIT',
      expected_utility: Number(waitUtility.toFixed(2)),
      downside_tail_risk: -1.0,
      execution_cost_bps: 0,
      exitability_factor: 1.0,
      portfolio_synergy: 0.0
    });

    // 3. INVESTIGATE
    const invUtility = !stopThinking ? (infoGain * 15 - delayCost * 8) : -10.0;
    evaluations.push({
      action: 'INVESTIGATE',
      expected_utility: Number(invUtility.toFixed(2)),
      downside_tail_risk: -2.0,
      execution_cost_bps: 0,
      exitability_factor: 1.0,
      portfolio_synergy: 0.0
    });

    if (hasPosition) {
      // Manage open position: HOLD, REDUCE, EXIT, SCALE
      const holdUtility = (params.expected_ev_pnl * 0.7) - (Math.abs(params.tail_risk_drawdown) * 0.3);
      evaluations.push({
        action: 'HOLD',
        expected_utility: Number(holdUtility.toFixed(2)),
        downside_tail_risk: params.tail_risk_drawdown,
        execution_cost_bps: 0,
        exitability_factor: params.exitability,
        portfolio_synergy: 0.1
      });

      evaluations.push({
        action: 'REDUCE',
        expected_utility: Number((holdUtility * 0.5 + 5.0).toFixed(2)),
        downside_tail_risk: params.tail_risk_drawdown * 0.5,
        execution_cost_bps: 50,
        exitability_factor: params.exitability,
        portfolio_synergy: 0.2
      });

      const exitUtility = params.expected_ev_pnl < 0 ? 15.0 : -10.0;
      evaluations.push({
        action: 'EXIT',
        expected_utility: Number(exitUtility.toFixed(2)),
        downside_tail_risk: 0.0,
        execution_cost_bps: 80,
        exitability_factor: params.exitability,
        portfolio_synergy: 0.0
      });
    } else {
      // Entry options: ENTER, ENTER_SMALL
      const baseUtility = (params.expected_ev_pnl * params.exitability) - 
                          (Math.abs(params.tail_risk_drawdown) * params.uncertainty_mass * 1.5);

      evaluations.push({
        action: 'ENTER',
        expected_utility: Number(baseUtility.toFixed(2)),
        downside_tail_risk: params.tail_risk_drawdown,
        execution_cost_bps: 60,
        exitability_factor: params.exitability,
        portfolio_synergy: 0.15
      });

      // ENTER_SMALL reduces downside risk when uncertainty is elevated
      const smallUtility = (params.expected_ev_pnl * 0.5 * params.exitability) - 
                           (Math.abs(params.tail_risk_drawdown) * 0.3 * params.uncertainty_mass);
      evaluations.push({
        action: 'ENTER_SMALL',
        expected_utility: Number(smallUtility.toFixed(2)),
        downside_tail_risk: params.tail_risk_drawdown * 0.3,
        execution_cost_bps: 40,
        exitability_factor: params.exitability,
        portfolio_synergy: 0.25
      });
    }

    // Sort by expected utility
    const sorted = evaluations.sort((a, b) => b.expected_utility - a.expected_utility);
    let best = sorted[0];

    // Safety override: If expected utility is negative across active trade actions, default to ABSTAIN
    if (best.expected_utility <= 0 && best.action !== 'WAIT' && best.action !== 'INVESTIGATE') {
      best = evaluations.find(e => e.action === 'ABSTAIN') ?? best;
    }

    let allocPct = 0.0;
    if (best.action === 'ENTER') allocPct = 1.0;
    else if (best.action === 'ENTER_SMALL') allocPct = 0.35;
    else if (best.action === 'SCALE') allocPct = 0.50;

    return {
      token_mint: params.token_mint,
      selected_action: best.action,
      recommended_allocation_pct: allocPct,
      expected_utility: best.expected_utility,
      stop_thinking_triggered: stopThinking,
      action_rankings: sorted,
      decision_rationale: `Selected ${best.action} with expected utility ${best.expected_utility}. Stop-thinking: ${stopThinking}.`,
      evaluated_at_ms: Date.now()
    };
  }
}
