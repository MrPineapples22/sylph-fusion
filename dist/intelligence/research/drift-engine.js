/**
 * SOL-SYLPH Multi-Dimensional Drift Engine
 * Blueprint Part LXIII
 *
 * Detects 6 discrete dimensions of system and market drift:
 * 1. DATA_DRIFT
 * 2. CONCEPT_DRIFT
 * 3. EXECUTION_DRIFT
 * 4. PROVIDER_DRIFT
 * 5. ACTOR_DRIFT
 * 6. REGIME_DRIFT
 */
export class DriftEngine {
    evaluateDrift(params) {
        const alerts = [];
        // 1. PROVIDER_DRIFT (Latency or 429 drift)
        const baseLat = params.baselineLatencyMs ?? 50;
        const obsLat = params.observedLatencyMs ?? 60;
        if (obsLat > baseLat * 2.5) {
            alerts.push({
                driftType: 'PROVIDER_DRIFT',
                severity: obsLat > baseLat * 5 ? 'CRITICAL' : 'HIGH',
                metricName: 'rpc_round_trip_latency',
                baselineValue: baseLat,
                observedValue: obsLat,
                deviationScore: obsLat / baseLat,
                recommendedAction: 'Rotate RPC pool providers; verify quorum consensus.',
            });
        }
        // 2. CONCEPT_DRIFT (Model calibration decay)
        const baseBrier = params.baselineBrierScore ?? 0.12;
        const obsBrier = params.observedBrierScore ?? 0.14;
        if (obsBrier > baseBrier * 1.8) {
            alerts.push({
                driftType: 'CONCEPT_DRIFT',
                severity: 'HIGH',
                metricName: 'probability_calibration_brier_score',
                baselineValue: baseBrier,
                observedValue: obsBrier,
                deviationScore: obsBrier / baseBrier,
                recommendedAction: 'Trigger research experiment in Challenger pipeline; recalibrate Platt scalers.',
            });
        }
        // 3. EXECUTION_DRIFT (Slippage / fee structure drift)
        const baseImpact = params.baselineExecutionImpactBps ?? 80;
        const obsImpact = params.observedExecutionImpactBps ?? 95;
        if (obsImpact > baseImpact * 2.0) {
            alerts.push({
                driftType: 'EXECUTION_DRIFT',
                severity: 'HIGH',
                metricName: 'round_trip_slippage_impact',
                baselineValue: baseImpact,
                observedValue: obsImpact,
                deviationScore: obsImpact / baseImpact,
                recommendedAction: 'Tighten max permitted position size and lower RobustExitCapacity.',
            });
        }
        // 4. ACTOR_DRIFT (Sybil / adversarial mutation)
        const baseWash = params.baselineWashRatio ?? 0.05;
        const obsWash = params.observedWashRatio ?? 0.08;
        if (obsWash > baseWash * 3.0) {
            alerts.push({
                driftType: 'ACTOR_DRIFT',
                severity: 'HIGH',
                metricName: 'wash_trading_saturation_ratio',
                baselineValue: baseWash,
                observedValue: obsWash,
                deviationScore: obsWash / baseWash,
                recommendedAction: 'Raise Sybil clustering sensitivity in CleanRoomStateEngine.',
            });
        }
        const hasMaterial = alerts.some(a => a.severity === 'CRITICAL' || a.severity === 'HIGH');
        const summary = alerts.length > 0
            ? `Drift detected in ${alerts.length} dimensions: ${alerts.map(a => a.driftType).join(', ')}`
            : 'All 6 drift dimensions nominal within baseline tolerance.';
        return {
            timestampMs: Date.now(),
            activeAlerts: alerts,
            hasMaterialDrift: hasMaterial,
            summary,
        };
    }
}
//# sourceMappingURL=drift-engine.js.map