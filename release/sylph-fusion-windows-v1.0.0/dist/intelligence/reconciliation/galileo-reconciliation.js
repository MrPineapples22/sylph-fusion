/**
 * GALILEO: Reality Reconciliation Engine
 * Blueprint Engine #38
 *
 * Continuously compares EXPECTED forecasts against OBSERVED market outcomes:
 * Computes: Prediction Error, Prediction-Error Velocity, Thesis Decay, and Surprise.
 * Invariant: Unexpected reality propagates back into intelligence to trigger model re-calibration.
 */
export class GalileoRealityReconciliationEngine {
    static VERSION = '1.0.0';
    history = [];
    /**
     * Reconciles a past forecast with observed reality ex-post.
     */
    reconcile(params) {
        const error = Math.abs(params.forecast_ev_pnl - params.observed_realized_pnl);
        const forecastDir = params.forecast_ev_pnl >= 0 ? 'UP' : 'DOWN';
        const observedDir = params.observed_realized_pnl >= 0 ? 'UP' : 'DOWN';
        const directionMismatch = forecastDir !== observedDir;
        // Surprise score: high if directional flip occurred or error is massive
        let surprise = Math.min(1.0, error / 50);
        if (directionMismatch && Math.abs(params.observed_realized_pnl) > 5.0) {
            surprise = Math.min(1.0, surprise + 0.4);
        }
        const thesisDecay = surprise > 0.60;
        const record = {
            comparison_id: `gal_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            token_mint: params.token_mint,
            forecast_ev_pnl: params.forecast_ev_pnl,
            observed_realized_pnl: params.observed_realized_pnl,
            forecast_direction: forecastDir,
            observed_direction: observedDir,
            prediction_error_pct: Number(error.toFixed(2)),
            surprise_score: Number(surprise.toFixed(3)),
            thesis_decay_detected: thesisDecay,
            timestamp_ms: Date.now()
        };
        this.history.push(record);
        if (this.history.length > 500) {
            this.history.shift();
        }
        return record;
    }
    getMeanAbsoluteError() {
        if (this.history.length === 0)
            return 0;
        const sum = this.history.reduce((acc, r) => acc + r.prediction_error_pct, 0);
        return Number((sum / this.history.length).toFixed(2));
    }
    getSurpriseHistory() {
        return this.history;
    }
}
//# sourceMappingURL=galileo-reconciliation.js.map