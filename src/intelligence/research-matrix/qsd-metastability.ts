/**
 * SYLPH FUSION — QSD & METASTABILITY INTELLIGENCE (Section 14)
 * Quasi-Stationary Distribution analysis for tokens that remain alive in bounded plateau
 * but have not escaped upward or collapsed into terminal absorption (death).
 *
 * Distinguishes healthy accumulation from terminal stagnation.
 */

export interface QSDMetastabilityMetrics {
  readonly residenceTimeSeconds: number;
  readonly productiveResidenceRatio: number; // Fraction of time spent with positive net delta/accumulation
  readonly metastabilityRatio: number;      // Ratio of internal mixing time to absorption time
  readonly directionalEscapeRatio: number;  // Ratio of upward escape attempts to downward leak attempts
  readonly qsdDrift: number;                 // Mean infinitesimal drift in plateau interior
  readonly upwardEscapeHazard: number;       // Rate of crossing upper boundary into continuation
  readonly downwardEscapeHazard: number;     // Rate of crossing lower boundary into liquidation/death
  readonly classification: 'HEALTHY_ACCUMULATION' | 'TERMINAL_STAGNATION' | 'UNRESOLVED_PLATEAU' | 'RAPID_TRANSITION';
  readonly isHealthyAccumulation: boolean;
}

export interface PricePoint {
  readonly timestampMs: number;
  readonly price: number;
  readonly volume: number;
  readonly isBuy: boolean;
}

export class QSDMetastabilityAnalyzer {
  /**
   * Evaluates Quasi-Stationary Distribution behavior on an observed price/flow trajectory.
   *
   * @param trajectory Series of point-in-time observations within the candidate window
   * @param launchPrice Token initial/launch price
   * @param currentMultiple Current price / launch price
   */
  public static analyze(
    trajectory: readonly PricePoint[],
    launchPrice: number,
    currentMultiple: number
  ): QSDMetastabilityMetrics {
    if (trajectory.length < 2 || launchPrice <= 0) {
      return {
        residenceTimeSeconds: 0,
        productiveResidenceRatio: 0.5,
        metastabilityRatio: 0.5,
        directionalEscapeRatio: 1.0,
        qsdDrift: 0,
        upwardEscapeHazard: 0.01,
        downwardEscapeHazard: 0.01,
        classification: 'UNRESOLVED_PLATEAU',
        isHealthyAccumulation: false,
      };
    }

    const tStart = trajectory[0].timestampMs;
    const tEnd = trajectory[trajectory.length - 1].timestampMs;
    const residenceTimeSeconds = Math.max(0.001, (tEnd - tStart) / 1000);

    // Compute returns and bounded plateau bands
    const prices = trajectory.map(p => p.price);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const priceRange = Math.max(1e-12, maxP - minP);
    const midP = (minP + maxP) / 2;

    let productiveTicks = 0;
    let upwardEscapeAttempts = 0;
    let downwardLeakAttempts = 0;
    let cumulativeDrift = 0;

    for (let i = 1; i < trajectory.length; i++) {
      const prev = trajectory[i - 1];
      const curr = trajectory[i];
      const delta = curr.price - prev.price;
      const dt = Math.max(1, curr.timestampMs - prev.timestampMs) / 1000;

      cumulativeDrift += (delta / prev.price) / dt;

      // Productive residence: positive price delta backed by buy flow or steady hold above midpoint
      if (curr.price >= midP && curr.isBuy) {
        productiveTicks++;
      } else if (curr.price > prev.price) {
        productiveTicks += 0.5;
      }

      // Upper and lower boundary tests (top 15% and bottom 15% of corridor)
      if (curr.price > minP + 0.85 * priceRange) {
        upwardEscapeAttempts++;
      }
      if (curr.price < minP + 0.15 * priceRange) {
        downwardLeakAttempts++;
      }
    }

    const totalTicks = trajectory.length - 1;
    const productiveResidenceRatio = Math.min(1.0, Math.max(0.0, productiveTicks / totalTicks));
    const qsdDrift = cumulativeDrift / totalTicks;

    const directionalEscapeRatio = downwardLeakAttempts === 0
      ? upwardEscapeAttempts > 0 ? 10.0 : 1.0
      : upwardEscapeAttempts / downwardLeakAttempts;

    // Upward and downward escape hazards per minute
    const upwardEscapeHazard = (upwardEscapeAttempts / totalTicks) / Math.max(0.1, residenceTimeSeconds / 60);
    const downwardEscapeHazard = (downwardLeakAttempts / totalTicks) / Math.max(0.1, residenceTimeSeconds / 60);

    // Metastability ratio: internal mixing persistence vs rapid decay
    // Higher ratio implies token maintains coherent support structure in the plateau
    const volatilityNormalized = Math.sqrt(
      prices.reduce((acc, p) => acc + Math.pow((p - midP) / midP, 2), 0) / prices.length
    );
    const metastabilityRatio = Math.min(10.0, Math.max(0.05, 1.0 / (volatilityNormalized + 0.1)));

    let classification: QSDMetastabilityMetrics['classification'];
    if (residenceTimeSeconds < 10) {
      classification = 'RAPID_TRANSITION';
    } else if (productiveResidenceRatio >= 0.55 && directionalEscapeRatio >= 1.5 && qsdDrift >= 0) {
      classification = 'HEALTHY_ACCUMULATION';
    } else if (productiveResidenceRatio < 0.35 || directionalEscapeRatio < 0.6 || qsdDrift < -0.05) {
      classification = 'TERMINAL_STAGNATION';
    } else {
      classification = 'UNRESOLVED_PLATEAU';
    }

    const isHealthyAccumulation = classification === 'HEALTHY_ACCUMULATION';

    return {
      residenceTimeSeconds,
      productiveResidenceRatio,
      metastabilityRatio,
      directionalEscapeRatio,
      qsdDrift,
      upwardEscapeHazard,
      downwardEscapeHazard,
      classification,
      isHealthyAccumulation,
    };
  }
}
