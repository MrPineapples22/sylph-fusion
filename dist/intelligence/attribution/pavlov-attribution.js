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