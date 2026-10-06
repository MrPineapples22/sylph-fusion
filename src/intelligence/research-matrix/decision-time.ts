/**
 * SYLPH FUSION — EARLIEST DECISION TIME X (Section 24)
 * Solves the optimal stopping boundary for decision timing:
 * Computes:
 * - Value(Act Now)
 * - Value(Wait)
 * - Value(Abstain)
 *
 * Factors in:
 * - False positive cost (entering a dud / rug)
 * - False negative cost (passing on a true runner)
 * - Total execution hurdle (fees, slippage, priority tips)
 * - Opportunity decay (price running away while waiting)
 * - Information expected from waiting (reduction in Bayes error)
 * - Capture loss from waiting (slippage / higher entry basis)
 * - Failure hazard (risk of token dying before next decision point)
 *
 * Core Principle:
 * Prevents entering too early with insufficient evidence,
 * and prevents waiting until the opportunity is gone.
 */

export interface DecisionTimingInputs {
  readonly currentAgeSeconds: number;
  readonly expectedGrossAlpha: number;     // Nominal expected return multiple - 1.0
  readonly failureHazardPerSec: number;    // Hazard rate of collapse
  readonly informationVelocityBitsPerSec: number;
  readonly priceDriftPerSec: number;       // Rate at which entry price runs away
  readonly totalExecutionHurdleFraction: number; // Fees + base slippage + priority tips
  readonly posteriorProbability: number;   // p(target)
  readonly bayesErrorFloor: number;
}

export interface DecisionTimingEvaluation {
  readonly valueActNow: number;
  readonly valueWait: number;
  readonly valueAbstain: number;
  readonly optimalAction: 'ACT_NOW' | 'WAIT' | 'ABSTAIN';
  readonly valueDifference: number; // valueActNow - max(valueWait, valueAbstain)
  readonly captureLossFromWaiting: number;
  readonly expectedInformationGainFromWaiting: number;
  readonly failureHazardPenalty: number;
}

export class EarliestDecisionTimeSolver {
  /**
   * Solves the continuous optimal stopping decision between Act Now, Wait, and Abstain.
   */
  public static solve(inputs: DecisionTimingInputs): DecisionTimingEvaluation {
    const {
      currentAgeSeconds,
      expectedGrossAlpha,
      failureHazardPerSec,
      informationVelocityBitsPerSec,
      priceDriftPerSec,
      totalExecutionHurdleFraction,
      posteriorProbability,
      bayesErrorFloor,
    } = inputs;

    // 1. Value(Abstain) = 0.0 (Reference benchmark: no capital lost, zero fee paid)
    const valueAbstain = 0.0;

    // 2. Value(Act Now): Expected net payoff under current information
    // Expected return minus execution friction minus risk-weighted penalty of false entry
    const falsePositiveCost = 1.0 + totalExecutionHurdleFraction; // Loss of entire principal + fee
    const grossEdge = posteriorProbability * expectedGrossAlpha;
    const falseEntryPenalty = (1.0 - posteriorProbability) * falsePositiveCost;
    const valueActNow = grossEdge - falseEntryPenalty - totalExecutionHurdleFraction;

    // 3. Value(Wait dt): Waiting allows information to accumulate, but incurs costs:
    // dt = 3.0 seconds decision interval
    const dt = 3.0;
    const expectedInformationGainFromWaiting = Math.max(0, informationVelocityBitsPerSec * dt);
    const failureHazardPenalty = Math.min(0.9, failureHazardPerSec * dt);
    const captureLossFromWaiting = Math.max(0, priceDriftPerSec * dt);

    // Reduction in uncertainty from waiting improves posterior calibration:
    const improvedPosterior = Math.min(
      0.98,
      posteriorProbability + (expectedInformationGainFromWaiting > 0.05 ? 0.05 : 0.0)
    );
    const futureGrossEdge = improvedPosterior * Math.max(0, expectedGrossAlpha - captureLossFromWaiting);
    const futureFalsePenalty = (1.0 - improvedPosterior) * falsePositiveCost;

    // Discount future value by survival probability (1 - hazard)
    const valueWait = (1.0 - failureHazardPenalty) * (futureGrossEdge - futureFalsePenalty - totalExecutionHurdleFraction);

    let optimalAction: DecisionTimingEvaluation['optimalAction'];
    if (valueActNow > valueWait && valueActNow > valueAbstain) {
      optimalAction = 'ACT_NOW';
    } else if (valueWait > valueAbstain && valueWait >= valueActNow) {
      optimalAction = 'WAIT';
    } else {
      optimalAction = 'ABSTAIN';
    }

    const valueDifference = valueActNow - Math.max(valueWait, valueAbstain);

    return {
      valueActNow,
      valueWait,
      valueAbstain,
      optimalAction,
      valueDifference,
      captureLossFromWaiting,
      expectedInformationGainFromWaiting,
      failureHazardPenalty,
    };
  }
}
