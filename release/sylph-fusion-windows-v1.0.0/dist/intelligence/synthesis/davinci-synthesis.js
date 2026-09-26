/**
 * DA VINCI: Strategy Synthesis & Hypothesis Discovery Engine
 * Blueprint Engine #36
 *
 * Generates candidate hypotheses, feature combinations, and novel interaction signals.
 * Invariant: All outputs remain unverified research candidates until validated by Franklin/Fisher.
 * Maintains a permanent archive of rejected hypotheses.
 */
export class DaVinciStrategySynthesisEngine {
    static VERSION = '1.0.0';
    synthesized = new Map();
    rejectedArchive = [];
    /**
     * Synthesizes a new hypothesis from feature interactions.
     */
    synthesizeHypothesis(params) {
        const id = `dv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const hyp = {
            hypothesis_id: id,
            name: params.name,
            feature_combination: params.feature_combination,
            condition_logic: params.condition_logic,
            initial_rationale: params.initial_rationale,
            is_negative_signal: Boolean(params.is_negative_signal),
            status: 'PROPOSED',
            created_at_ms: Date.now()
        };
        this.synthesized.set(id, hyp);
        return hyp;
    }
    rejectHypothesis(id, reason) {
        const existing = this.synthesized.get(id);
        if (!existing)
            return;
        const rejected = {
            ...existing,
            status: 'REJECTED',
            rejection_reason: reason
        };
        this.synthesized.set(id, rejected);
        this.rejectedArchive.push(rejected);
    }
    getActiveProposals() {
        return Array.from(this.synthesized.values()).filter(h => h.status === 'PROPOSED');
    }
    getRejectedArchive() {
        return this.rejectedArchive;
    }
}
//# sourceMappingURL=davinci-synthesis.js.map