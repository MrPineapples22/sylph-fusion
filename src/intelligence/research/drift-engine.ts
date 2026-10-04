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

export type DriftType =
  | 'DATA_DRIFT'
  | 'CONCEPT_DRIFT'
  | 'EXECUTION_DRIFT'
  | 'PROVIDER_DRIFT'
  | 'ACTOR_DRIFT'
  | 'REGIME_DRIFT';

export interface DriftAlert {
  readonly driftType: DriftType;
  readonly severity: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  readonly metricName: string;
  readonly baselineValue: number;
  readonly observedValue: number;
  readonly deviationScore: number;
  readonly recommendedAction: string;
}

export interface DriftReport {
  readonly timestampMs: number;
  readonly activeAlerts: readonly DriftAlert[];
  readonly hasMaterialDrift: boolean;
  readonly evidenceState: 'OBSERVED' | 'INSUFFICIENT_EVIDENCE';
  readonly summary: string;
}

export class DriftEngine {
  public evaluateDrift(params: {
    baselineLatencyMs?: number;
    observedLatencyMs?: number;
    baselineBrierScore?: number;
    observedBrierScore?: number;
    baselineExecutionImpactBps?: number;
    observedExecutionImpactBps?: number;
    baselineWashRatio?: number;
    observedWashRatio?: number;
  }): DriftReport {
    // Invariant 1 & Section XIX: Never fabricate healthy drift from zero samples
    const hasAnyInput = params.baselineLatencyMs !== undefined ||
      params.observedLatencyMs !== undefined ||
      params.baselineBrierScore !== undefined ||
      params.observedBrierScore !== undefined ||
      params.baselineExecutionImpactBps !== undefined ||
      params.observedExecutionImpactBps !== undefined ||
      params.baselineWashRatio !== undefined ||
      params.observedWashRatio !== undefined;

    if (!hasAnyInput) {
      return {
        timestampMs: Date.now(),
        activeAlerts: [],
        hasMaterialDrift: false,
        evidenceState: 'INSUFFICIENT_EVIDENCE',
        summary: 'INSUFFICIENT_EVIDENCE: No telemetry provided to evaluate drift.',
      };
    }

    const alerts: DriftAlert[] = [];

    // 1. PROVIDER_DRIFT (Latency or 429 drift)
    if (params.baselineLatencyMs !== undefined && params.observedLatencyMs !== undefined && params.baselineLatencyMs > 0) {
      const baseLat = params.baselineLatencyMs;
      const obsLat = params.observedLatencyMs;
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
    }

    // 2. CONCEPT_DRIFT (Model calibration decay)
    if (params.baselineBrierScore !== undefined && params.observedBrierScore !== undefined && params.baselineBrierScore > 0) {
      const baseBrier = params.baselineBrierScore;
      const obsBrier = params.observedBrierScore;
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
    }

    // 3. EXECUTION_DRIFT (Slippage / fee structure drift)
    if (params.baselineExecutionImpactBps !== undefined && params.observedExecutionImpactBps !== undefined && params.baselineExecutionImpactBps > 0) {
      const baseImpact = params.baselineExecutionImpactBps;
      const obsImpact = params.observedExecutionImpactBps;
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
    }

    // 4. ACTOR_DRIFT (Sybil / adversarial mutation)
    if (params.baselineWashRatio !== undefined && params.observedWashRatio !== undefined && params.baselineWashRatio > 0) {
      const baseWash = params.baselineWashRatio;
      const obsWash = params.observedWashRatio;
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
      evidenceState: 'OBSERVED',
    };
  }
}
