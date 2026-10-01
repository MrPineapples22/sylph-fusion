/**
 * FRANKLIN: Controlled Experimentation Engine
 * Blueprint Engine #35
 *
 * Formalizes experimental advancement across 9 strict verification stages:
 * HYPOTHESIS -> OFFLINE -> ATLAS_REPLAY -> MAXWELL -> SHADOW -> PAPER -> CANARY -> LIMITED -> PRODUCTION.
 * Invariant: Production capital is never the laboratory; changes are strictly rollback-capable.
 */
import { createHash } from 'node:crypto';
export class FranklinControlledExperimentationEngine {
    static VERSION = '1.0.0';
    experiments = new Map();
    consumedEvidenceRoots = new Set();
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
     * Requires strict calibration, drawdown containment, sample sufficiency,
     * non-finite/NaN fencing, and anti-replay evidence protection.
     */
    evaluatePromotion(experimentId, metrics) {
        const exp = this.experiments.get(experimentId);
        if (!exp)
            throw new Error(`[FRANKLIN] Experiment ${experimentId} not found.`);
        const now = Date.now();
        const evidenceRoot = metrics.evidence_root ?? createHash('sha256')
            .update(`${experimentId}:${exp.current_stage}:${metrics.samples}:${metrics.sharpe}:${metrics.win_rate}:${metrics.drawdown_pct}:${metrics.brier_score}`)
            .digest('hex');
        const makeCert = (promoted, toStage, rejection) => {
            const payload = `${experimentId}:${exp.current_stage}:${toStage ?? 'NONE'}:${promoted}:${evidenceRoot}:${now}`;
            const digest = createHash('sha256').update(payload).digest('hex');
            return {
                certificate_id: `PROMO-CERT-${digest.slice(0, 16)}`,
                experiment_id: experimentId,
                from_stage: exp.current_stage,
                to_stage: toStage,
                promoted,
                rejection_reason: rejection,
                evaluated_metrics: {
                    samples: metrics.samples,
                    sharpe: metrics.sharpe,
                    win_rate: metrics.win_rate,
                    drawdown_pct: metrics.drawdown_pct,
                    brier_score: metrics.brier_score,
                },
                evidence_root: evidenceRoot,
                evaluated_at_ms: now,
                digest,
            };
        };
        // 1. Numerical sanity & finite checks (fail closed on NaN/Infinity)
        if (!Number.isFinite(metrics.samples) ||
            !Number.isFinite(metrics.sharpe) ||
            !Number.isFinite(metrics.win_rate) ||
            !Number.isFinite(metrics.drawdown_pct) ||
            !Number.isFinite(metrics.brier_score)) {
            const reason = 'Non-finite or NaN metric detected in evaluation parameters';
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        if (metrics.win_rate < 0 || metrics.win_rate > 1) {
            const reason = `Win rate (${metrics.win_rate}) out of valid [0, 1] range`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        if (metrics.brier_score < 0 || metrics.brier_score > 1) {
            const reason = `Brier score (${metrics.brier_score}) out of valid [0, 1] range`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        if (metrics.drawdown_pct < 0) {
            const reason = `Drawdown percentage (${metrics.drawdown_pct}%) cannot be negative`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        // 2. Anti-replay verification
        if (this.consumedEvidenceRoots.has(evidenceRoot)) {
            const reason = `Evidence root ${evidenceRoot.slice(0, 16)} already consumed; stage replay rejected`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        // 3. Quality hurdles
        if (metrics.drawdown_pct > 15.0) {
            const reason = `Drawdown (${metrics.drawdown_pct}%) exceeds 15% safety limit.`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        if (metrics.brier_score > 0.25) {
            const reason = `Calibration Brier score (${metrics.brier_score}) failed calibration.`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        if (metrics.samples < 25) {
            const reason = `Sample size (${metrics.samples}) insufficient for stage advancement.`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
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
            const reason = 'Already at highest production stage.';
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        // Enforce full target_sample_size for production-critical stages (STAGE_7_CANARY onwards)
        const nextStage = STAGE_ORDER[currentIdx + 1];
        if (currentIdx >= 6 && metrics.samples < exp.target_sample_size) {
            const reason = `Sample size (${metrics.samples}) below experiment target (${exp.target_sample_size}) for live/canary stage.`;
            return { promoted: false, certificate: makeCert(false, undefined, reason), rejection_reason: reason };
        }
        this.consumedEvidenceRoots.add(evidenceRoot);
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
        const cert = makeCert(true, nextStage, undefined);
        return { promoted: true, certificate: cert, next_stage: nextStage };
    }
    getExperiment(id) {
        return this.experiments.get(id);
    }
    getAllExperiments() {
        return Array.from(this.experiments.values());
    }
}
//# sourceMappingURL=franklin-experiment.js.map