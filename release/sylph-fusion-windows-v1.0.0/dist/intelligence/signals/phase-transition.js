/**
 * SOL-SYLPH Phase Transition Detector
 * Blueprint Part XIX
 *
 * Tracks VALUE, DIRECTION, VELOCITY, and ACCELERATION across:
 * ActorGrowth, FreshCapital, EconomicVolume, Liquidity,
 * ExitCapacity, Concentration, SellPressure, DTF.
 * Detects deterioration before a price dump becomes the only evidence.
 */
export class PhaseTransitionDetector {
    history = new Map();
    recordMetrics(mint, values, timestampMs = Date.now()) {
        const list = this.history.get(mint) ?? [];
        list.push({ timestampMs, values });
        if (list.length > 20)
            list.shift();
        this.history.set(mint, list);
        const kinematics = {};
        const alerts = [];
        const metricKeys = Object.keys(values);
        for (const key of metricKeys) {
            const currentVal = values[key];
            if (list.length < 2) {
                kinematics[key] = {
                    metricName: key,
                    value: currentVal,
                    direction: 'FLAT',
                    velocity: 0,
                    acceleration: 0,
                };
                continue;
            }
            const prev1 = list[list.length - 2];
            const dt1 = Math.max(0.5, (timestampMs - prev1.timestampMs) / 1000);
            const v1 = (currentVal - (prev1.values[key] ?? currentVal)) / dt1;
            let a = 0;
            if (list.length >= 3) {
                const prev2 = list[list.length - 3];
                const dt2 = Math.max(0.5, (prev1.timestampMs - prev2.timestampMs) / 1000);
                const v0 = ((prev1.values[key] ?? currentVal) - (prev2.values[key] ?? currentVal)) / dt2;
                a = (v1 - v0) / dt1;
            }
            const dir = v1 > 0.05 ? 'INCREASING' : v1 < -0.05 ? 'DECREASING' : 'FLAT';
            kinematics[key] = {
                metricName: key,
                value: currentVal,
                direction: dir,
                velocity: Number(v1.toFixed(3)),
                acceleration: Number(a.toFixed(3)),
            };
            // Check for lead indicators of deterioration
            if (key === 'exitCapacity' && v1 < -0.2) {
                alerts.push({
                    metricName: key,
                    warning: `Exit capacity evaporating at ${v1.toFixed(2)} SOL/s`,
                    severity: v1 < -0.5 ? 'CRITICAL' : 'HIGH',
                });
            }
            if (key === 'dtf' && (v1 < -0.05 || currentVal < 0.25)) {
                alerts.push({
                    metricName: key,
                    warning: `Distance to failure dropping rapidly (dtf=${currentVal.toFixed(2)}, v=${v1.toFixed(2)})`,
                    severity: 'CRITICAL',
                });
            }
            if (key === 'sellPressure' && v1 > 1.0 && a > 0) {
                alerts.push({
                    metricName: key,
                    warning: `Sell pressure accelerating (+${a.toFixed(2)}/s^2)`,
                    severity: 'HIGH',
                });
            }
        }
        const isDeteriorating = alerts.some(a => a.severity === 'CRITICAL');
        return {
            mint,
            kinematics,
            transitionAlerts: alerts,
            isDeterioratingRapidly: isDeteriorating,
            evaluatedAtMs: timestampMs,
        };
    }
}
//# sourceMappingURL=phase-transition.js.map