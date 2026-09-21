/**
 * SOL-SYLPH Master Production Intelligence - Counterfactual Engine
 * Specifications: Section 77 (Counterfactual Engine).
 *
 * Shadow-track rejected and alternative decisions.
 * Compares:
 * - Reject vs Enter Now vs Wait 5s vs Wait 15s.
 * - Measures filter value (capital saved vs opportunity cost).
 */

import { OutcomeTruthRecord } from './outcome-truth.js';

export interface CounterfactualComparison {
  readonly mint: string;
  readonly evaluatedAtMs: number;
  readonly decisionTaken: 'ENTER' | 'REJECT' | 'WAIT';
  readonly actualOutcome: OutcomeTruthRecord;
  readonly counterfactualReturns: {
    readonly enterNowPct: number;
    readonly wait5sPct: number;
    readonly wait15sPct: number;
  };
  readonly filterAssessment: {
    readonly isTruePositive: boolean; // Entered and won
    readonly isTrueNegative: boolean; // Rejected and dumped/rugged
    readonly isFalsePositive: boolean; // Entered and dumped/rugged
    readonly isFalseNegative: boolean; // Rejected but ran
    readonly filterValueScore: number; // Positive = good filtering, Negative = bad filtering
  };
}

export class CounterfactualEngine {
  /**
   * Evaluate decision against counterfactual scenarios using outcome checkpoints.
   */
  public evaluateDecision(
    mint: string,
    decisionTaken: 'ENTER' | 'REJECT' | 'WAIT',
    outcome: OutcomeTruthRecord
  ): CounterfactualComparison {
    const entryPrice = outcome.entryPriceUsd;
    const p5s = outcome.checkpoints['5s']?.recordedPriceUsd ?? entryPrice;
    const p15s = outcome.checkpoints['15s']?.recordedPriceUsd ?? entryPrice;
    const p1m = outcome.checkpoints['1m']?.recordedPriceUsd ?? entryPrice;

    const enterNowPct = entryPrice > 0 ? (p1m - entryPrice) / entryPrice : 0;
    const wait5sPct = p5s > 0 ? (p1m - p5s) / p5s : 0;
    const wait15sPct = p15s > 0 ? (p1m - p15s) / p15s : 0;

    const isRugOrDump = outcome.primaryLabel === 'RUG' || outcome.primaryLabel === 'HARD_DUMP' || outcome.primaryLabel === 'FAILED';
    const isRunner = outcome.primaryLabel === 'RUNNER' || outcome.primaryLabel === 'MAJOR_RUNNER';

    let isTruePositive = false;
    let isTrueNegative = false;
    let isFalsePositive = false;
    let isFalseNegative = false;

    if (decisionTaken === 'ENTER') {
      if (isRunner) isTruePositive = true;
      if (isRugOrDump) isFalsePositive = true;
    } else if (decisionTaken === 'REJECT') {
      if (isRugOrDump) isTrueNegative = true;
      if (isRunner) isFalseNegative = true;
    }

    // Filter value score: +1 for capital saved on rug, +1 for runner captured, -1 for buying rug, -1 for skipping runner
    let filterValueScore = 0;
    if (isTruePositive) filterValueScore += 1;
    if (isTrueNegative) filterValueScore += 1;
    if (isFalsePositive) filterValueScore -= 1.5; // asymmetric penalty for entering rugs
    if (isFalseNegative) filterValueScore -= 0.8;

    return {
      mint,
      evaluatedAtMs: Date.now(),
      decisionTaken,
      actualOutcome: outcome,
      counterfactualReturns: {
        enterNowPct,
        wait5sPct,
        wait15sPct,
      },
      filterAssessment: {
        isTruePositive,
        isTrueNegative,
        isFalsePositive,
        isFalseNegative,
        filterValueScore,
      },
    };
  }
}
