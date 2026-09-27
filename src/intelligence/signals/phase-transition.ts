/**
 * SOL-SYLPH Phase Transition Detector
 * Blueprint Part XIX
 *
 * Tracks VALUE, DIRECTION, VELOCITY, and ACCELERATION across:
 * ActorGrowth, FreshCapital, EconomicVolume, Liquidity,
 * ExitCapacity, Concentration, SellPressure, DTF.
 * Detects deterioration before a price dump becomes the only evidence.
 */

export interface MetricKinematics {
  readonly metricName: string;
  readonly value: number;
  readonly direction: 'INCREASING' | 'DECREASING' | 'FLAT';
  readonly velocity: number;     // Rate of change (units/sec)
  readonly acceleration: number; // Rate of change of velocity (units/sec^2)
}

export interface TransitionRiskAlert {
  readonly metricName: string;
  readonly warning: string;
  readonly severity: 'HIGH' | 'CRITICAL';
}

export interface PhaseTransitionReport {
  readonly mint: string;
  readonly kinematics: Record<string, MetricKinematics>;
  readonly transitionAlerts: readonly TransitionRiskAlert[];
  readonly isDeterioratingRapidly: boolean;
  readonly evaluatedAtMs: number;
}

export class PhaseTransitionDetector {
  private readonly history = new Map<string, { timestampMs: number; values: Record<string, number> }[]>();

  public recordMetrics(mint: string, values: Record<string, number>, timestampMs: number = Date.now()): PhaseTransitionReport {
    const list = this.history.get(mint) ?? [];
    list.push({ timestampMs, values });
    if (list.length > 20) list.shift();
    this.history.set(mint, list);

    const kinematics: Record<string, MetricKinematics> = {};
    const alerts: TransitionRiskAlert[] = [];

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

  /**
   * Tracks 1st derivative (velocity in SOL/s) and 2nd derivative (acceleration in SOL/s^2)
   * of bonding curve reserve accumulation to detect surging breakouts vs fading momentum.
   */
  public trackCurveReserves(mint: string, reserveSol: number, timestampMs: number = Date.now()): {
    velocitySolPerSec: number;
    accelerationSolPerSec2: number;
    regime: 'SURGING_BREAKOUT' | 'HEALTHY_ACCUMULATION' | 'DECELERATING' | 'OUTFLOW';
  } {
    let snaps = this.history.get(mint);
    if (!snaps) {
      snaps = [];
      this.history.set(mint, snaps);
    }

    snaps.push({ timestampMs, values: { reserveSol } });
    if (snaps.length > 30) snaps.shift();

    if (snaps.length < 2) {
      return { velocitySolPerSec: 0, accelerationSolPerSec2: 0, regime: 'HEALTHY_ACCUMULATION' };
    }

    const prev = snaps[snaps.length - 2];
    const dt = Math.max(0.1, (timestampMs - prev.timestampMs) / 1000);
    const velocity = (reserveSol - (prev.values.reserveSol || 0)) / dt;

    let acceleration = 0;
    if (snaps.length >= 3) {
      const prev2 = snaps[snaps.length - 3];
      const dtPrev = Math.max(0.1, (prev.timestampMs - prev2.timestampMs) / 1000);
      const prevVelocity = ((prev.values.reserveSol || 0) - (prev2.values.reserveSol || 0)) / dtPrev;
      acceleration = (velocity - prevVelocity) / dt;
    }

    let regime: 'SURGING_BREAKOUT' | 'HEALTHY_ACCUMULATION' | 'DECELERATING' | 'OUTFLOW' = 'HEALTHY_ACCUMULATION';
    if (velocity < 0) regime = 'OUTFLOW';
    else if (acceleration > 0.5 && velocity > 1.0) regime = 'SURGING_BREAKOUT';
    else if (acceleration < -0.2 && velocity < 0.3) regime = 'DECELERATING';

    return {
      velocitySolPerSec: Number(velocity.toFixed(4)),
      accelerationSolPerSec2: Number(acceleration.toFixed(4)),
      regime,
    };
  }

}
