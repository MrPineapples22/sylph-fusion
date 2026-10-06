/**
 * SYLPH FUSION — CAPITAL SURVIVAL ENGINE
 * Study 26: CAPITAL-SURVIVAL-X (Section XIII)
 *
 * Measures the survival duration of net inflow capital inside the pool.
 * If 80% of newly arriving capital is extracted within 30 seconds by existing holders,
 * the token is an extraction siphon rather than an expanding asset.
 */

export interface CapitalSurvivalReport {
  readonly medianRetentionDurationSeconds: number;
  readonly capitalRetentionRatio60s: number; // Fraction of capital surviving after 60s
  readonly extractionVelocityUsdPerSec: number;
  readonly isExtractionSiphon: boolean;
  readonly capitalHalfLifeSeconds: number;
}

export class CapitalSurvivalEngine {
  public static measureSurvival(params: {
    cumulativeInflowsUsd: number;
    cumulativeOutflowsUsd: number;
    poolAgeSeconds: number;
    inflowObservationWindowSeconds?: number;
  }): CapitalSurvivalReport {
    const {
      cumulativeInflowsUsd,
      cumulativeOutflowsUsd,
      poolAgeSeconds,
      inflowObservationWindowSeconds = 60,
    } = params;

    const netRetained = Math.max(0, cumulativeInflowsUsd - cumulativeOutflowsUsd);
    const retentionRatio = cumulativeInflowsUsd > 0 ? netRetained / cumulativeInflowsUsd : 0;

    const extractionVelocityUsdPerSec =
      poolAgeSeconds > 0 ? cumulativeOutflowsUsd / poolAgeSeconds : 0;

    // Decay rate \lambda = -ln(retention) / \Delta t
    const safeRetention = Math.max(0.001, Math.min(0.999, retentionRatio));
    const decayRate = -Math.log(safeRetention) / Math.max(1, inflowObservationWindowSeconds);
    const halfLife = Math.max(1.0, 0.693 / Math.max(0.0001, decayRate));

    const isExtractionSiphon = retentionRatio < 0.20 || halfLife < 15.0;

    return {
      medianRetentionDurationSeconds: halfLife,
      capitalRetentionRatio60s: retentionRatio,
      extractionVelocityUsdPerSec,
      isExtractionSiphon,
      capitalHalfLifeSeconds: halfLife,
    };
  }
}
