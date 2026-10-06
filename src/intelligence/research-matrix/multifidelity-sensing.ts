/**
 * SYLPH FUSION — INFORMATION VELOCITY & MULTIFIDELITY SENSING (Sections 20 & 21)
 *
 * Tracks:
 * - I(t), dI/dt, d^2I/dt^2 (Information velocity and acceleration)
 * - Sensor tiers:
 *   LEVEL 0: cheap launch/event/price/liquidity observations
 *   LEVEL 1: flow and holder metrics
 *   LEVEL 2: economic entity graph
 *   LEVEL 3: inventory/cost-basis reconstruction
 *   LEVEL 4: rare-event twin simulation
 *   LEVEL 5: deep counterfactual / path analysis
 *
 * Controls sensor escalation dynamically:
 * InformationPerCost = ExpectedInformationGain / (DataCost + ComputeCost + LatencyPenalty)
 * Prevents running maximum-cost analysis on every token.
 */

export type SensorLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface SensorProfile {
  readonly level: SensorLevel;
  readonly name: string;
  readonly dataCost: number;       // In arbitrary cost units (e.g. 1.0, 5.0, 20.0...)
  readonly computeCostMs: number;  // Latency in milliseconds
  readonly baseInformationGain: number; // In bits
}

export const SENSOR_PROFILES: readonly SensorProfile[] = [
  { level: 0, name: 'LEVEL_0_OBSERVATION', dataCost: 1.0, computeCostMs: 2, baseInformationGain: 0.15 },
  { level: 1, name: 'LEVEL_1_FLOW_HOLDERS', dataCost: 3.0, computeCostMs: 10, baseInformationGain: 0.35 },
  { level: 2, name: 'LEVEL_2_ENTITY_GRAPH', dataCost: 8.0, computeCostMs: 35, baseInformationGain: 0.60 },
  { level: 3, name: 'LEVEL_3_INVENTORY_RECON', dataCost: 15.0, computeCostMs: 80, baseInformationGain: 0.85 },
  { level: 4, name: 'LEVEL_4_TWIN_SIMULATION', dataCost: 30.0, computeCostMs: 250, baseInformationGain: 1.10 },
  { level: 5, name: 'LEVEL_5_DEEP_COUNTERFACTUAL', dataCost: 60.0, computeCostMs: 600, baseInformationGain: 1.35 },
];

export interface InformationKinematics {
  readonly currentInformationBits: number; // I(t)
  readonly informationVelocity: number;    // dI/dt (bits/sec)
  readonly informationAcceleration: number;// d^2I/dt^2 (bits/sec^2)
  readonly recommendedSensorLevel: SensorLevel;
  readonly shouldEscalateSensor: boolean;
  readonly informationPerCost: number;
}

export class MultifidelitySensingController {
  /**
   * Evaluates information kinematics across consecutive observation timestamps
   * and decides whether sensor escalation is justified.
   *
   * @param infoHistory Array of [timestampMs, infoBits] observations
   * @param currentLevel Current active sensor level
   * @param targetMultiple Target price multiple (higher multiples justify deeper sensing)
   */
  public static evaluate(
    infoHistory: readonly (readonly [number, number])[],
    currentLevel: SensorLevel,
    targetMultiple: number
  ): InformationKinematics {
    if (infoHistory.length < 2) {
      const currentInfo = infoHistory.length === 1 ? infoHistory[0][1] : 0.1;
      return {
        currentInformationBits: currentInfo,
        informationVelocity: 0.0,
        informationAcceleration: 0.0,
        recommendedSensorLevel: 0,
        shouldEscalateSensor: false,
        informationPerCost: 0.15,
      };
    }

    const n = infoHistory.length;
    const [tCurr, iCurr] = infoHistory[n - 1];
    const [tPrev, iPrev] = infoHistory[n - 2];
    const dtSec = Math.max(0.001, (tCurr - tPrev) / 1000);

    const vCurr = (iCurr - iPrev) / dtSec;

    let aCurr = 0;
    if (n >= 3) {
      const [tPrev2, iPrev2] = infoHistory[n - 3];
      const dtPrevSec = Math.max(0.001, (tPrev - tPrev2) / 1000);
      const vPrev = (iPrev - iPrev2) / dtPrevSec;
      aCurr = (vCurr - vPrev) / dtSec;
    }

    // Determine expected information gain if we escalate to currentLevel + 1
    const nextLevel = Math.min(5, currentLevel + 1) as SensorLevel;
    const nextProfile = SENSOR_PROFILES[nextLevel];
    const currProfile = SENSOR_PROFILES[currentLevel];

    const expectedGain = Math.max(0.05, nextProfile.baseInformationGain - currProfile.baseInformationGain);
    const addedCost = nextProfile.dataCost - currProfile.dataCost;
    const latencyPenalty = nextProfile.computeCostMs * 0.02; // 20ms = 0.4 cost unit

    const informationPerCost = expectedGain / (addedCost + latencyPenalty + 0.001);

    // Escalation conditions:
    // 1. Candidate must show positive information velocity (improving signal)
    // 2. High target multiple or viable setup justifies investment
    // 3. Information per cost must exceed hurdle of 0.02 bits/cost
    const shouldEscalate = (
      currentLevel < 5 &&
      vCurr > 0.01 &&
      informationPerCost >= 0.018 &&
      (iCurr >= 0.3 || targetMultiple >= 3.0)
    );

    const recommendedSensorLevel = shouldEscalate ? nextLevel : currentLevel;

    return {
      currentInformationBits: iCurr,
      informationVelocity: vCurr,
      informationAcceleration: aCurr,
      recommendedSensorLevel,
      shouldEscalateSensor: shouldEscalate,
      informationPerCost,
    };
  }
}
