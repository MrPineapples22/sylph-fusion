/**
 * SYLPH FUSION — MINIMUM-ACTION TRANSITION PATH SYSTEM
 * Specification: Master Blueprint Section 12 (Rare-Transition Analysis)
 *
 * Evaluates empirical rare-transition trajectory action:
 *   A[gamma] = -log P(gamma | X_0)
 * Estimates the least-improbable extreme-runner trajectory.
 *
 * Invariant: Does not force every winner into one fingerprint. Recognizes 6 distinct
 * pathway classes and measures pathway entropy & commitment.
 */

import { type ResearchPolicyStateV1 } from './research-policy-state.js';

export type PathwayClass =
  | 'VIRAL_EXPLOSION'
  | 'QUIET_ACCUMULATION'
  | 'GRADUATION_SECONDARY_IGNITION'
  | 'COMPETITOR_CAPITAL_CAPTURE'
  | 'EXTERNAL_CATALYST'
  | 'NOVEL_PATH';

export interface TransitionPathAnalysis {
  readonly pathwayClass: PathwayClass;
  readonly trajectoryAction: number;          // A[gamma] = -log P(gamma)
  readonly pathDistance: number;              // Distance to target manifold
  readonly pathVelocity: number;              // Rate of progression along path
  readonly pathAcceleration: number;          // Rate of change of path velocity
  readonly pathwayEntropy: number;             // Ambiguity across candidate pathways
  readonly pathCommitment: number;            // 0..1 confidence in assigned path
  readonly isViableTrajectory: boolean;
  readonly explanation: string;
}

export class TransitionPathEngineX {
  /**
   * Analyzes the current candidate trajectory against known empirical rare-event pathways.
   */
  public evaluateTransitionPath(state: ResearchPolicyStateV1): TransitionPathAnalysis {
    const ageSec = Math.max(1, state.market.tokenAgeSeconds.value ?? 1);
    const velocity = state.market.priceVelocityBpsPerSec.value ?? 0;
    const accel = state.market.priceAccelerationBpsPerSec2.value ?? 0;
    const buyVolume = state.flow.economicBuyVolumeSol.value ?? 0.1;
    const arrivalRate = state.flow.buyerArrivalRatePerSec.value ?? 0.1;
    const actorRatio = state.authenticity.independentActorRatio.value ?? 0.5;
    const isGraduated = state.venue !== 'PUMP_FUN_BONDING_CURVE';

    // 1. Identify dominant pathway signatures:
    let pathwayClass: PathwayClass = 'NOVEL_PATH';
    let pathCommitment = 0.5;

    if (isGraduated && buyVolume > 10.0 && velocity > 50) {
      pathwayClass = 'GRADUATION_SECONDARY_IGNITION';
      pathCommitment = 0.85;
    } else if (arrivalRate > 2.0 && velocity > 150 && actorRatio > 0.6) {
      pathwayClass = 'VIRAL_EXPLOSION';
      pathCommitment = 0.80;
    } else if (ageSec > 90 && Math.abs(velocity) < 20 && actorRatio > 0.7 && buyVolume > 5.0) {
      pathwayClass = 'QUIET_ACCUMULATION';
      pathCommitment = 0.75;
    } else if (buyVolume > 15.0 && actorRatio < 0.45) {
      pathwayClass = 'COMPETITOR_CAPITAL_CAPTURE';
      pathCommitment = 0.65;
    } else if (velocity > 300) {
      pathwayClass = 'EXTERNAL_CATALYST';
      pathCommitment = 0.60;
    }

    // 2. Trajectory Action: A[gamma] = -log P(gamma | X0)
    // Low action = more probable/natural transition path; High action = highly improbable
    const baseLogP = pathwayClass === 'VIRAL_EXPLOSION' ? 2.5 :
      pathwayClass === 'QUIET_ACCUMULATION' ? 3.0 :
      pathwayClass === 'GRADUATION_SECONDARY_IGNITION' ? 2.8 : 4.2;

    const frictionPenalty = Math.max(0, 1.0 - actorRatio) * 2.0;
    const trajectoryAction = Number((baseLogP + frictionPenalty).toFixed(4));

    // 3. Path Metrics
    const pathDistance = Number(Math.max(0.1, 10.0 - (buyVolume / 5.0)).toFixed(3));
    const pathVelocity = Number((velocity / 100.0).toFixed(3));
    const pathAcceleration = Number((accel / 100.0).toFixed(3));

    // Pathway Entropy: Measures distribution across candidate pathway hypotheses
    const pathwayEntropy = Number((1.2 - (pathCommitment * 0.7)).toFixed(3));
    const isViableTrajectory = trajectoryAction < 5.5 && pathVelocity >= -0.5;

    const explanation = `Pathway: ${pathwayClass} (Action: ${trajectoryAction}, Commitment: ${(pathCommitment * 100).toFixed(0)}%, Velocity: ${pathVelocity}).`;

    return {
      pathwayClass,
      trajectoryAction,
      pathDistance,
      pathVelocity,
      pathAcceleration,
      pathwayEntropy,
      pathCommitment,
      isViableTrajectory,
      explanation,
    };
  }
}
