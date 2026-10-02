/**
 * SOL-SYLPH Intelligence Fabric - Value of Information (VOI) & Act/Wait/Abstain Policy
 * Specifications: 500-Item Roadmap Layer I (#5, #11, #12), Layer II (#172, #173, #174), Layer III (#203, #204).
 *
 * Implements:
 * 1. ValueOfInformationEngine: Evaluates expected information gain vs. alpha burn rate from waiting for additional observations.
 * 2. ActWaitAbstainPolicy: Computes the optimal statistical action (ACT, WAIT, ABSTAIN) with an explicit wait budget.
 */

import { AlphaHalfLifeEstimate, AlphaHalfLifeEngine } from '../timing/alpha-half-life.js';

export type PolicyAction = 'ACT' | 'WAIT' | 'ABSTAIN';

export interface VoiEvaluation {
  readonly action: PolicyAction;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly netEvBps: number;
  readonly expectedInformationGainBps: number;
  readonly expectedAlphaBurnBps: number;
  readonly netBenefitOfWaitingBps: number;
  readonly waitBudgetMs: number;
  readonly rationale: string;
}

export class ValueOfInformationEngine {
  /**
   * Evaluates whether taking an immediate action or waiting for another discrete
   * observation (e.g. next slot geyser tick, provider confirmation) optimizes net capturable EV.
   *
   * @param params.confidence Estimated winning probability (0.0 to 1.0)
   * @param params.uncertainty Conformal prediction interval width / epistemic entropy (0.0 to 1.0)
   * @param params.netEvBps Net expected value of the opportunity in basis points
   * @param params.elapsedMs Elapsed milliseconds since initial candidate detection
   * @param params.halfLifeEstimate Dynamic alpha half-life estimate
   * @param params.candidateObservationWindowMs Proposed wait interval to evaluate (default 100ms)
   */
  public static evaluatePolicy(params: {
    confidence: number;
    uncertainty: number;
    netEvBps: number;
    elapsedMs: number;
    halfLifeEstimate: AlphaHalfLifeEstimate;
    candidateObservationWindowMs?: number;
  }): VoiEvaluation {
    const { confidence, uncertainty, netEvBps, elapsedMs, halfLifeEstimate } = params;
    const windowMs = params.candidateObservationWindowMs ?? 100;
    const hurdleBps = halfLifeEstimate.hurdleBps;

    // 1. Check if opportunity is already past its economic event horizon
    if (halfLifeEstimate.economicEventHorizonMs > 0 && elapsedMs >= halfLifeEstimate.economicEventHorizonMs) {
      return {
        action: 'ABSTAIN',
        confidence,
        uncertainty,
        netEvBps: 0,
        expectedInformationGainBps: 0,
        expectedAlphaBurnBps: 0,
        netBenefitOfWaitingBps: 0,
        waitBudgetMs: 0,
        rationale: `Economic event horizon reached (${elapsedMs}ms >= ${halfLifeEstimate.economicEventHorizonMs}ms); alpha exhausted`,
      };
    }

    // 2. Compute expected alpha burn over candidate wait window
    const currentRemainingEdge = AlphaHalfLifeEngine.calculateRemainingEdge(
      halfLifeEstimate.initialEdgeBps,
      elapsedMs,
      halfLifeEstimate
    );
    const postWaitRemainingEdge = AlphaHalfLifeEngine.calculateRemainingEdge(
      halfLifeEstimate.initialEdgeBps,
      elapsedMs + windowMs,
      halfLifeEstimate
    );
    const expectedAlphaBurnBps = Math.max(0, currentRemainingEdge - postWaitRemainingEdge);

    // 3. Compute Value of Information (VOI):
    // VOI is high when the decision is near the indifference boundary (confidence ~ 0.50)
    // and epistemic uncertainty is large.
    // Near threshold distance d = |confidence - threshold|
    const decisionThreshold = 0.55;
    const marginToThreshold = Math.abs(confidence - decisionThreshold);

    // Entropy proxy: max at threshold, scaled by conformal uncertainty
    const boundaryAmbiguity = Math.max(0, 1.0 - (marginToThreshold * 4)); // peaks when within +/- 0.25 of threshold
    const expectedInformationGainBps = Math.round(uncertainty * boundaryAmbiguity * (Math.abs(netEvBps) + hurdleBps) * 0.5);

    const netBenefitOfWaitingBps = expectedInformationGainBps - expectedAlphaBurnBps;

    // 4. Decision Logic:
    // If net EV is deeply negative or confidence is abysmal, ABSTAIN immediately (waiting won't rescue it)
    if (netEvBps <= -hurdleBps || confidence < 0.35) {
      return {
        action: 'ABSTAIN',
        confidence,
        uncertainty,
        netEvBps,
        expectedInformationGainBps,
        expectedAlphaBurnBps,
        netBenefitOfWaitingBps,
        waitBudgetMs: 0,
        rationale: `Negative statistical expectation (Net EV: ${netEvBps} bps, Confidence: ${confidence.toFixed(2)}); abstaining`,
      };
    }

    // If waiting yields positive net benefit AND total wait time fits inside the horizon
    const fitsInHorizon = (elapsedMs + windowMs) < halfLifeEstimate.economicEventHorizonMs;
    if (netBenefitOfWaitingBps > 15 && fitsInHorizon && uncertainty > 0.18) {
      return {
        action: 'WAIT',
        confidence,
        uncertainty,
        netEvBps,
        expectedInformationGainBps,
        expectedAlphaBurnBps,
        netBenefitOfWaitingBps,
        waitBudgetMs: windowMs,
        rationale: `Ambiguous boundary (uncertainty ${uncertainty.toFixed(2)}): VOI (+${expectedInformationGainBps} bps) exceeds burn (-${expectedAlphaBurnBps} bps); waiting ${windowMs}ms for next confirmation`,
      };
    }

    // If net EV exceeds hurdle and confidence is high, ACT immediately
    if (netEvBps >= hurdleBps && confidence >= decisionThreshold) {
      return {
        action: 'ACT',
        confidence,
        uncertainty,
        netEvBps,
        expectedInformationGainBps,
        expectedAlphaBurnBps,
        netBenefitOfWaitingBps,
        waitBudgetMs: 0,
        rationale: `Actionable edge (+${netEvBps} bps >= ${hurdleBps} bps hurdle) with sufficient certainty; executing immediately before burn destroys edge`,
      };
    }

    // Default fail-safe: Abstain
    return {
      action: 'ABSTAIN',
      confidence,
      uncertainty,
      netEvBps,
      expectedInformationGainBps,
      expectedAlphaBurnBps,
      netBenefitOfWaitingBps,
      waitBudgetMs: 0,
      rationale: `Insufficient edge or unfavorable risk/burn balance; abstaining`,
    };
  }
}
