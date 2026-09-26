/**
 * FRANKLIN: Controlled Experimentation Engine
 * Blueprint Engine #35
 *
 * Formalizes experimental advancement across 9 strict verification stages:
 * HYPOTHESIS -> OFFLINE -> ATLAS_REPLAY -> MAXWELL -> SHADOW -> PAPER -> CANARY -> LIMITED -> PRODUCTION.
 * Invariant: Production capital is never the laboratory; changes are strictly rollback-capable.
 */
export class FranklinControlledExperimentationEngine {
    static VERSION = '1.0.0';
    experiments = new Map();
    registerExperiment(params) {
        const now = Date.now();
        const expId = `exp_${now}_${Math.floor(Math.random() * 1000)}`;
        const candidate = {
            experiment_id: expId,
            name: params.name,
            hypothesis: params.hypothesis,
            current_stage: 'STAGE_1_HYPOTHESIS',
            sample_size_achieved: 0,
            target_sample_size: params.target_sample_size ?? 100,
            sharpe_ratio: 0,
            win_rate: 0,
            max_drawdown_pct: 0,
            calibration_brier_score: 1.0,
            created_at_ms: now,
            rollback_version: params.rollback_version
        };
        this.experiments.set(expId, candidate);
        return candidate;
    }
    /**
     * Evaluates an experiment for promotion to the next stage.
     * Requires strict calibration, drawdown containment, and sample sufficiency.
     */
    evaluatePromotion(experimentId, metrics) {
        const exp = this.experiments.get(experimentId);
        if (!exp)
            throw new Error(`[FRANKLIN] Experiment ${experimentId} not found.`);
        // Quality hurdles
        if (metrics.drawdown_pct > 15.0) {
            return { promoted: false, rejection_reason: `Drawdown (${metrics.drawdown_pct}%) exceeds 15% safety limit.` };
        }
        if (metrics.brier_score > 0.25) {
            return { promoted: false, rejection_reason: `Calibration Brier score (${metrics.brier_score}) failed calibration.` };
        }
        if (metrics.samples < 25) {
            return { promoted: false, rejection_reason: `Sample size (${metrics.samples}) insufficient for stage advancement.` };
        }
        const STAGE_ORDER = [
            'STAGE_1_HYPOTHESIS',
            'STAGE_2_OFFLINE',
            'STAGE_3_ATLAS_REPLAY',
            'STAGE_4_MAXWELL',
            'STAGE_5_SHADOW',
            'STAGE_6_PAPER',
            'STAGE_7_CANARY',
            'STAGE_8_LIMITED',
            'STAGE_9_PRODUCTION'
        ];
        const currentIdx = STAGE_ORDER.indexOf(exp.current_stage);
        if (currentIdx >= STAGE_ORDER.length - 1) {
            return { promoted: false, rejection_reason: 'Already at highest production stage.' };
        }
        const nextStage = STAGE_ORDER[currentIdx + 1];
        const updated = {
            ...exp,
            current_stage: nextStage,
            sample_size_achieved: metrics.samples,
            sharpe_ratio: metrics.sharpe,
            win_rate: metrics.win_rate,
            max_drawdown_pct: metrics.drawdown_pct,
            calibration_brier_score: metrics.brier_score
        };
        this.experiments.set(experimentId, updated);
        return { promoted: true, next_stage: nextStage };
    }
    getExperiment(id) {
        return this.experiments.get(id);
    }
    getAllExperiments() {
        return Array.from(this.experiments.values());
    }
}
//# sourceMappingURL=franklin-experiment.js.map