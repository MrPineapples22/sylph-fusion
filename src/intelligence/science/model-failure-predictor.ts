/**
 * SOL-SYLPH Intelligence Fabric - Model-Failure Predictor & Decision Stability Engine
 * Specifications: 500-Item Roadmap Layer I (#91-#96), Layer II (#178, #179), Layer III (#220).
 *
 * Implements:
 * 1. ModelFailurePredictor: Predicts P(MULTIPLIER-X is wrong) given specialist disagreement geometry and novelty.
 * 2. SpecialistDisagreementGeometry: Quantifies inter-specialist conflict between momentum, safety, and liquidity.
 * 3. DecisionStabilityRadius: Measures the perturbation radius before the trading verdict reverses.
 */

import { SpieFactors } from '../spie/spie-engine.js';

export interface ModelFailureEvaluation {
  readonly failureProbability: number;          // P(MULTIPLIER-X wrong), 0.0 to 1.0
  readonly isModelFailureVeto: boolean;         // True if failure probability > 0.45
  readonly specialistDisagreementSpread: number;// Inter-factor variance / conflict score (0.0 to 1.0)
  readonly predictionFragility: number;         // 0.0 (robust) to 1.0 (hypersensitive)
  readonly decisionStabilityRadius: number;     // Normalized distance to decision flip threshold
  readonly dominantConflictDimension: string;   // Name of the contradictory factor
  readonly rationale: string;
}

export class ModelFailurePredictor {
  /**
   * Evaluates the meta-probability that the primary intelligence recommendation is erroneous.
   *
   * @param params.factors Upstream SPIE and specialist factor scores
   * @param params.confidence Primary calibrated win probability (0.0 to 1.0)
   * @param params.conformalUncertainty Epistemic interval width (0.0 to 1.0)
   * @param params.netEvBps Net expected value of the candidate
   */
  public static evaluateFailureProbability(params: {
    factors: Partial<SpieFactors>;
    confidence: number;
    conformalUncertainty: number;
    netEvBps: number;
  }): ModelFailureEvaluation {
    const { factors, confidence, conformalUncertainty, netEvBps } = params;

    // 1. Specialist Disagreement Geometry:
    // Extract key orthogonal pillars
    const momentum = factors.momentum ?? 0.5;
    const safety = factors.safety ?? 0.5;
    const liquidity = factors.liquidityDepth ?? 0.5;
    const walletQuality = factors.walletQuality ?? 0.5;
    const execution = factors.executionFeasibility ?? 0.5;

    const values = [momentum, safety, liquidity, walletQuality, execution];
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + ((v - mean) ** 2), 0) / values.length;
    const specialistDisagreementSpread = Number(Math.min(1.0, Math.sqrt(variance) * 2.5).toFixed(3));

    // Detect asymmetric trap contradictions:
    // High momentum (> 0.80) coupled with low safety (< 0.35) or low wallet quality (< 0.35)
    let severeContradiction = false;
    let dominantConflictDimension = 'NONE';

    if (momentum > 0.75 && safety < 0.40) {
      severeContradiction = true;
      dominantConflictDimension = `MOMENTUM_VS_SAFETY (${momentum.toFixed(2)} vs ${safety.toFixed(2)})`;
    } else if (momentum > 0.75 && walletQuality < 0.35) {
      severeContradiction = true;
      dominantConflictDimension = `MOMENTUM_VS_SYBIL_DECEPTION (${momentum.toFixed(2)} vs ${walletQuality.toFixed(2)})`;
    } else if (momentum > 0.75 && execution < 0.35) {
      severeContradiction = true;
      dominantConflictDimension = `MOMENTUM_VS_EXECUTION_FEASIBILITY (${momentum.toFixed(2)} vs ${execution.toFixed(2)})`;
    }

    // 2. Prediction Fragility:
    // Measure how close net EV is to the hurdle rate (100 bps)
    const hurdle = 100;
    const netEvMargin = Math.max(0, netEvBps - hurdle);
    const fragilityFromMargin = netEvMargin < 150 ? 1.0 - (netEvMargin / 150) : 0.0;
    const predictionFragility = Number(
      Math.min(1.0, (fragilityFromMargin * 0.6) + (conformalUncertainty * 0.4)).toFixed(3)
    );

    // 3. Decision Stability Radius:
    // Higher radius means a larger perturbation is required to flip the decision
    const confidenceMargin = Math.abs(confidence - 0.55);
    const decisionStabilityRadius = Number(
      Math.max(0.01, (confidenceMargin * 2.0) * (1.0 - specialistDisagreementSpread)).toFixed(3)
    );

    // 4. Composite Probability of Model Failure:
    // Weighted combination of disagreement spread, uncertainty, fragility, and contradiction
    const contradictionPenalty = severeContradiction ? 0.35 : 0.0;
    const rawFailureScore =
      (specialistDisagreementSpread * 0.30) +
      (conformalUncertainty * 0.25) +
      (predictionFragility * 0.20) +
      contradictionPenalty;

    const failureProbability = Number(
      Math.max(0.05, Math.min(0.95, rawFailureScore)).toFixed(3)
    );

    const isModelFailureVeto = failureProbability > 0.45 || (severeContradiction && conformalUncertainty > 0.25);

    const rationale = isModelFailureVeto
      ? `MODEL_FAILURE_VETO: P(Failure) = ${(failureProbability * 100).toFixed(1)}% exceeds 45% threshold. Conflict: ${dominantConflictDimension}, Disagreement Spread: ${specialistDisagreementSpread}`
      : `Model stability confirmed: P(Failure) = ${(failureProbability * 100).toFixed(1)}%, Stability Radius: ${decisionStabilityRadius}`;

    return {
      failureProbability,
      isModelFailureVeto,
      specialistDisagreementSpread,
      predictionFragility,
      decisionStabilityRadius,
      dominantConflictDimension,
      rationale,
    };
  }
}
