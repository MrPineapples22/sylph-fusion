/**
 * SYLPH FUSION — METASTABILITY & ACTION RESIDUAL ENGINE
 * Study 20: QUASI-STATIONARY-RUNNER-X & Study 21: ACTION-RESIDUAL-X (Section XII)
 *
 * Models quasi-stationary distributions (QSD) and computes the Onsager-Machlup
 * action functional residual S[\phi] along the observed state path.
 * Determines whether a price plateau is a temporary metastable trap or a persistent runner state.
 */

export interface MetastabilityReport {
  readonly isMetastableTrap: boolean;
  readonly escapeRatePerSec: number; // Hazard of sudden escape into collapse basin
  readonly quasiStationaryLifetimeSeconds: number;
  readonly onsagerMachlupActionResidual: number; // Departure from optimal least-action path
  readonly pathPlausibilityScore: number; // [0, 1] - high indicates natural physical flow
}

export class MetastabilityEngine {
  public static evaluateMetastability(params: {
    plateauDurationSeconds: number;
    volatilityStdDev: number;
    volumeDecayRatePerMin: number;
    observedDrift: number;
    modelDrift: number;
    diffusionVariance: number;
  }): MetastabilityReport {
    const {
      plateauDurationSeconds,
      volatilityStdDev,
      volumeDecayRatePerMin,
      observedDrift,
      modelDrift,
      diffusionVariance,
    } = params;

    // Kramers escape rate from metastable local minimum:
    // \Gamma \approx \frac{\omega_0 \omega_b}{2 \pi} \exp(-\Delta V / D)
    const noiseLevel = Math.max(0.01, diffusionVariance);
    const barrierDepth = Math.max(0.05, 0.5 - (volumeDecayRatePerMin * 0.4));
    const escapeRatePerSec = Math.min(
      0.5,
      (volatilityStdDev / (2 * Math.PI)) * Math.exp(-barrierDepth / noiseLevel)
    );

    const qsdLifetimeSeconds = Math.max(1.0, 1.0 / Math.max(0.001, escapeRatePerSec));

    // Onsager-Machlup action functional residual:
    // S[\phi] = \frac{1}{2} \int (\dot{x} - b(x))^2 / D + \frac{1}{2} \nabla \cdot b(x) dt
    const driftDiscrepancy = observedDrift - modelDrift;
    const actionResidual = (driftDiscrepancy * driftDiscrepancy) / (2 * noiseLevel);

    // Path plausibility is high when action residual is low (near least-action path)
    const pathPlausibilityScore = Math.exp(-Math.min(10, actionResidual));

    // Flagged as metastable trap if volume is decaying fast or escape is imminent
    const isMetastableTrap =
      volumeDecayRatePerMin > 0.15 ||
      escapeRatePerSec > 0.05 ||
      plateauDurationSeconds > (qsdLifetimeSeconds * 1.5);

    return {
      isMetastableTrap,
      escapeRatePerSec,
      quasiStationaryLifetimeSeconds: qsdLifetimeSeconds,
      onsagerMachlupActionResidual: actionResidual,
      pathPlausibilityScore,
    };
  }
}
