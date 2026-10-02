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
export class PavlovOutcomeAttributionEngine {
    static VERSION = '1.0.0';
    attributions = [];
    /**
     * Evaluates decision soundness based on pre-flight authenticity, price drift, exit capacity, and execution integrity.
     */
    static evaluateDecisionSoundness(params) {
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
    attributeOutcome(params) {
        let archetype;
        let policyAction;
        let notes = '';
        const isProfit = params.realized_pnl_pct > 0;
        if (params.was_decision_sound && isProfit) {
            archetype = 'GOOD_DECISION_GOOD_OUTCOME';
            policyAction = 'REINFORCE';
            notes = 'Sound decision process produced profitable outcome. Reinforce policy weights.';
        }
        else if (params.was_decision_sound && !isProfit) {
            archetype = 'GOOD_DECISION_BAD_OUTCOME';
            policyAction = 'NEUTRAL_VARIANCE';
            notes = 'Sound decision met adverse tail variance. Do NOT penalize valid process.';
        }
        else if (!params.was_decision_sound && isProfit) {
            archetype = 'BAD_DECISION_GOOD_OUTCOME';
            policyAction = 'DO_NOT_REINFORCE_LUCK';
            notes = 'Flawed process produced lucky profit. Strictly avoid reinforcing bad habits.';
        }
        else {
            archetype = 'BAD_DECISION_BAD_OUTCOME';
            policyAction = 'PENALIZE_POLICY';
            notes = 'Flawed process caused loss. Penalize strategy and trigger parameter review.';
        }
        const record = {
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
    getAttributions() {
        return this.attributions;
    }
}
//# sourceMappingURL=pavlov-attribution.js.map