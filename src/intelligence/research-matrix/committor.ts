/**
 * SYLPH FUSION — COMMITTOR-X (RARE-EVENT TRANSITION COMMITTORS)
 * Specification: Master Blueprint Section 13 (Committor Analysis)
 *
 * Estimates q_target(x) = P(reach target before failure | X = x)
 * for targets in {2x, 5x, 10x, 20x, 100x, failure}.
 *
 * Invariant: q100 alone must NEVER trigger a trade.
 * It must be synthesized with reachability, capturability, information sufficiency,
 * calibration, execution, and exitability.
 */

import { type PredictionTarget } from './bayes-error-frontier.js';
import { type ResearchPolicyStateV1 } from './research-policy-state.js';

export interface CommittorState {
  readonly qFailure: number;
  readonly q2x: number;
  readonly q5x: number;
  readonly q10x: number;
  readonly q20x: number;
  readonly q100x: number;
  readonly dominantCommittor: PredictionTarget;
  readonly netConvexHazardRatio: number;
  readonly isFailureDominant: boolean;
  readonly explanation: string;
}

export class CommittorEngineX {
  /**
   * Computes point-in-time committor probabilities of hitting specific upside targets
   * before encountering terminal failure / collapse.
   */
  public evaluateCommittors(state: ResearchPolicyStateV1): CommittorState {
    const ageSec = Math.max(1, state.market.tokenAgeSeconds.value ?? 1);
    const returnsBps = state.market.priceReturnsBps.value ?? 0;
    const velocity = state.market.priceVelocityBpsPerSec.value ?? 0;
    const entropy = state.inventory.costBasisDistributionEntropy.value ?? 1.0;
    const washProb = state.authenticity.washTradingProbability.value ?? 0.1;
    const independentActors = state.authenticity.independentActorRatio.value ?? 0.5;
    const sellLiability = state.inventory.sellLiabilitySol.value ?? 5.0;
    const realReserves = state.market.realQuoteReservesSol.value ?? 1.0;

    // Failure hazard driver: High sell overhang, low entropy, or negative velocity over time
    const failurePressure = Math.min(0.98, Math.max(0.05,
      (sellLiability / Math.max(0.1, realReserves * 2.0)) * 0.45 +
      (1.0 - independentActors) * 0.30 +
      washProb * 0.25 +
      (ageSec > 120 && returnsBps < 500 ? 0.20 : 0.0)
    ));

    const qFailure = Number(failurePressure.toFixed(4));

    // Survival probability complement: (1 - qFailure)
    const survivalCapacity = Math.max(0.01, 1.0 - qFailure);

    // Upside committors scale down exponentially with required multiple:
    // P(reach mX before failure) = survivalCapacity * baseTransitionProbability * momentumFactor
    const momentumFactor = Math.min(2.0, Math.max(0.2, 1.0 + (velocity / 200.0)));
    const entropyFactor = Math.min(1.5, Math.max(0.5, entropy));

    const q2x = Number(Math.min(0.85, survivalCapacity * 0.35 * momentumFactor * entropyFactor).toFixed(4));
    const q5x = Number(Math.min(0.40, survivalCapacity * 0.08 * momentumFactor * entropyFactor).toFixed(4));
    const q10x = Number(Math.min(0.15, survivalCapacity * 0.025 * momentumFactor * entropyFactor).toFixed(4));
    const q20x = Number(Math.min(0.05, survivalCapacity * 0.008 * momentumFactor * entropyFactor).toFixed(4));
    const q100x = Number(Math.min(0.01, survivalCapacity * 0.001 * momentumFactor * entropyFactor).toFixed(5));

    const isFailureDominant = qFailure > 0.65 || qFailure > (q2x + q5x + q10x);
    const netConvexHazardRatio = qFailure > 0 ? Number(((q2x * 2.0 + q5x * 5.0 + q10x * 10.0) / (qFailure * 10.0)).toFixed(4)) : 1.0;

    let dominantCommittor: PredictionTarget = 'FAILURE';
    if (!isFailureDominant) {
      if (q10x > 0.08) dominantCommittor = 'RUNNER_10X';
      else if (q5x > 0.15) dominantCommittor = 'RUNNER_5X';
      else if (q2x > 0.20) dominantCommittor = 'RUNNER_2X';
    }

    const explanation = isFailureDominant
      ? `FAILURE_DOMINANT: Committor q_failure (${qFailure}) dominates upside committors (q_2x: ${q2x}, q_10x: ${q10x}).`
      : `COMMITTOR_FAVORABLE: Upside potential exceeds failure hazard (q_2x: ${q2x}, q_5x: ${q5x}, hazard ratio: ${netConvexHazardRatio}).`;

    return {
      qFailure,
      q2x,
      q5x,
      q10x,
      q20x,
      q100x,
      dominantCommittor,
      netConvexHazardRatio,
      isFailureDominant,
      explanation,
    };
  }
}
