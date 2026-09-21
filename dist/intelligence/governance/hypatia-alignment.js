/**
 * HYPATIA: System-Wide Objective Alignment Engine
 * Blueprint Engine #25
 *
 * Enforces canonical 9-level objective hierarchy:
 * 1. SECURITY
 * 2. HARD RISK
 * 3. STATE / TRUTH
 * 4. EXITABILITY
 * 5. CAPITAL PRESERVATION
 * 6. DECISION QUALITY
 * 7. OPPORTUNITY
 * 8. LEARNING
 * 9. COMPUTE EFFICIENCY
 *
 * Invariant: Lower objectives cannot violate higher ones.
 * Detects objective conflict, metric gaming, and Goodhart drift.
 */
export var HypatiaObjectiveLevel;
(function (HypatiaObjectiveLevel) {
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["SECURITY"] = 1] = "SECURITY";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["HARD_RISK"] = 2] = "HARD_RISK";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["STATE_TRUTH"] = 3] = "STATE_TRUTH";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["EXITABILITY"] = 4] = "EXITABILITY";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["CAPITAL_PRESERVATION"] = 5] = "CAPITAL_PRESERVATION";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["DECISION_QUALITY"] = 6] = "DECISION_QUALITY";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["OPPORTUNITY"] = 7] = "OPPORTUNITY";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["LEARNING"] = 8] = "LEARNING";
    HypatiaObjectiveLevel[HypatiaObjectiveLevel["COMPUTE_EFFICIENCY"] = 9] = "COMPUTE_EFFICIENCY";
})(HypatiaObjectiveLevel || (HypatiaObjectiveLevel = {}));
export class HypatiaObjectiveAlignmentEngine {
    static VERSION = '1.0.0';
    /**
     * Evaluates a proposed action against the canonical objective hierarchy.
     * If any higher-priority objective suffers a negative impact, the action is rejected.
     */
    static evaluateAction(action) {
        // Sort impacts by priority level (1 = highest priority, 9 = lowest priority)
        const sortedImpacts = [...action.potential_impacts].sort((a, b) => a.level - b.level);
        let highestAffected = HypatiaObjectiveLevel.COMPUTE_EFFICIENCY;
        for (const impact of sortedImpacts) {
            if (impact.level < highestAffected) {
                highestAffected = impact.level;
            }
            // If a higher objective is harmed, check if the proposed action is attempting to serve a lower objective
            if (impact.delta_score < 0) {
                if (action.primary_benefit > impact.level) {
                    return {
                        is_aligned: false,
                        blocking_violation: `Goodhart Violation: Action seeks Level ${action.primary_benefit} benefit but harms higher-priority Level ${impact.level} objective (${impact.justification}).`,
                        highest_affected_level: impact.level,
                        evaluation_summary: 'REJECTED: Lower-tier objective attempted to override higher-tier constraint.'
                    };
                }
                // Even within same level, security or hard risk harms are strictly blocked
                if (impact.level === HypatiaObjectiveLevel.SECURITY || impact.level === HypatiaObjectiveLevel.HARD_RISK) {
                    return {
                        is_aligned: false,
                        blocking_violation: `Hard Invariant Violation: Negative delta on non-compromisable Level ${impact.level} (${impact.justification}).`,
                        highest_affected_level: impact.level,
                        evaluation_summary: 'REJECTED: Security or Hard Risk boundary degradation is prohibited.'
                    };
                }
            }
        }
        return {
            is_aligned: true,
            highest_affected_level: highestAffected,
            evaluation_summary: 'APPROVED: Action preserves lexical objective ordering.'
        };
    }
}
//# sourceMappingURL=hypatia-alignment.js.map