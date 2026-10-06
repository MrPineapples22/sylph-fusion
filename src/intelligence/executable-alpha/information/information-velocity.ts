/**
 * SYLPH FUSION — INFORMATION VELOCITY ENGINE
 * Study: INFORMATION-VELOCITY-X (Section IX)
 *
 * Tracks the rate of information accumulation:
 * - Velocity: v = dI / dt
 * - Acceleration: a = d^2I / dt^2
 * If v is stagnant (< 0.001 nats/sec) while deficit remains large,
 * further waiting is uninformative -> ABSTAIN.
 */

export interface InformationVelocityProfile {
  readonly currentInformationNats: number;
  readonly velocityNatsPerSec: number;
  readonly accelerationNatsPerSec2: number;
  readonly isStagnant: boolean;
  readonly isAccelerating: boolean;
  readonly recommendedAction: 'WAIT_FOR_DATA' | 'ENOUGH_DATA' | 'STAGNANT_ABSTAIN';
}

export class InformationVelocityEngine {
  public static calculate(
    infoT0: number,
    infoT1: number,
    infoT2: number,
    deltaSec: number
  ): InformationVelocityProfile {
    const dt = Math.max(0.1, deltaSec);

    // Finite difference velocity: v1 = (I1 - I0) / dt, v2 = (I2 - I1) / dt
    const v1 = (infoT1 - infoT0) / dt;
    const v2 = (infoT2 - infoT1) / dt;
    const currentVelocity = Number(v2.toFixed(5));

    // Acceleration: a = (v2 - v1) / dt
    const currentAcceleration = Number(((v2 - v1) / dt).toFixed(6));

    const isStagnant = currentVelocity < 0.001 && infoT2 < 0.35;
    const isAccelerating = currentAcceleration > 0.0005;

    let recommendedAction: InformationVelocityProfile['recommendedAction'] = 'WAIT_FOR_DATA';
    if (infoT2 >= 0.45) {
      recommendedAction = 'ENOUGH_DATA';
    } else if (isStagnant) {
      recommendedAction = 'STAGNANT_ABSTAIN';
    }

    return {
      currentInformationNats: infoT2,
      velocityNatsPerSec: currentVelocity,
      accelerationNatsPerSec2: currentAcceleration,
      isStagnant,
      isAccelerating,
      recommendedAction,
    };
  }
}
