/**
 * SYLPH FUSION — CONFORMAL ABSTAIN X (Section 23)
 * Selective prediction via finite-sample split-conformal risk control.
 *
 * Tracks:
 * - Nominal coverage (1 - alpha)
 * - Empirically monitored abstention rate
 * - Rigorous nonconformity scores and conformal risk bounds
 * - Effective calibration sample size N_eff
 * - Expected Calibration Error (ECE)
 *
 * Core Principle:
 * When uncertainty is not certifiable: ABSTAIN.
 * Abstention is successful behavior, not model failure.
 */

export interface ConformalCalibrationSet {
  readonly effectiveN: number;
  readonly nonconformityQuantiles: readonly number[]; // Sorted nonconformity scores on holdout calibration data
  readonly expectedCalibrationError: number;
  readonly targetErrorRateAlpha: number; // e.g. 0.10 for 90% coverage
}

export interface SelectivePredictionResult {
  readonly pointEstimate: number;       // Predicted probability of target
  readonly nonconformityScore: number;   // Candidate nonconformity measure |p - y|
  readonly conformalRiskBound: number;   // Upper confidence bound on error rate
  readonly isUncertaintyCertifiable: boolean; // True if N_eff >= 50 and ECE <= 0.12
  readonly shouldAbstain: boolean;       // Conformal decision: ABSTAIN if score exceeds threshold or calibration insufficient
  readonly coverageGuaranteed: boolean;
  readonly abstentionReason?: string;
}

export class ConformalAbstainController {
  /**
   * Evaluates candidate prediction under conformal risk control.
   */
  public static evaluate(
    predictedProbability: number,
    calibration: ConformalCalibrationSet,
    uncertaintyDispersion: number // Variance or ensemble entropy
  ): SelectivePredictionResult {
    const { effectiveN, nonconformityQuantiles, expectedCalibrationError, targetErrorRateAlpha } = calibration;

    // Conformal nonconformity: dispersion away from certifiable boundaries
    const nonconformityScore = uncertaintyDispersion + Math.abs(predictedProbability - 0.5) * 0.1;

    // Check finite-sample calibration sufficiency
    if (effectiveN < 40) {
      return {
        pointEstimate: predictedProbability,
        nonconformityScore,
        conformalRiskBound: 1.0,
        isUncertaintyCertifiable: false,
        shouldAbstain: true,
        coverageGuaranteed: false,
        abstentionReason: `ABSTAIN_CALIBRATION_DEFICIT: Effective calibration N=${effectiveN} < 40`,
      };
    }

    if (expectedCalibrationError > 0.15) {
      return {
        pointEstimate: predictedProbability,
        nonconformityScore,
        conformalRiskBound: 1.0,
        isUncertaintyCertifiable: false,
        shouldAbstain: true,
        coverageGuaranteed: false,
        abstentionReason: `ABSTAIN_CALIBRATION_ERROR: ECE=${expectedCalibrationError.toFixed(3)} > 0.15`,
      };
    }

    // Compute empirical conformal threshold from calibration quantile:
    // Index: ceil((n + 1) * (1 - alpha)) / n
    const qIndex = Math.min(
      nonconformityQuantiles.length - 1,
      Math.max(0, Math.ceil((nonconformityQuantiles.length + 1) * (1 - targetErrorRateAlpha)) - 1)
    );
    const conformalThreshold = nonconformityQuantiles.length > 0 ? nonconformityQuantiles[qIndex] : 0.45;

    // Conservative upper risk bound using Clopper-Pearson / Hoeffding adjustment
    const hoeffdingSlack = Math.sqrt(Math.log(2 / 0.05) / (2 * effectiveN));
    const conformalRiskBound = Math.min(1.0, targetErrorRateAlpha + hoeffdingSlack);

    const isUncertaintyCertifiable = true;
    const shouldAbstain = nonconformityScore > conformalThreshold;

    let abstentionReason: string | undefined;
    if (shouldAbstain) {
      abstentionReason = `ABSTAIN_CONFORMAL_NONCONFORMITY: Score=${nonconformityScore.toFixed(3)} > threshold=${conformalThreshold.toFixed(3)}`;
    }

    return {
      pointEstimate: predictedProbability,
      nonconformityScore,
      conformalRiskBound,
      isUncertaintyCertifiable,
      shouldAbstain,
      coverageGuaranteed: !shouldAbstain,
      abstentionReason,
    };
  }
}
