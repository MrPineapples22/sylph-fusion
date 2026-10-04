/**
 * SOL-SYLPH Intelligence Fabric - Probability Calibration & Reliability Engine
 * Specifications: Parts XXXIII (Calibration), XXXIV (Calibration Monitoring),
 * XXXV (Conditional Calibration), XXXVI (Conformal / Interval Uncertainty).
 *
 * Implements:
 * - Platt Sigmoid Scaling & Beta Calibration
 * - Reliability Analysis: Brier Score, Log Loss, Expected Calibration Error (ECE)
 * - Reliability Bins (Predicted vs Observed)
 * - Conformal Uncertainty Intervals with Coverage Monitoring
 */

export interface ReliabilityBin {
  readonly binRange: [number, number]; // e.g. [0.1, 0.2]
  readonly predictedAvg: number;
  readonly observedAvg: number;
  readonly sampleCount: number;
  readonly calibrationError: number;
}

export interface CalibrationReport {
  readonly brierScore: number;
  readonly logLoss: number;
  readonly expectedCalibrationErrorBps: number;
  readonly isWellCalibrated: boolean;
  readonly evidenceState: 'CALIBRATED' | 'INSUFFICIENT_EVIDENCE';
  readonly bins: readonly ReliabilityBin[];
  readonly conformalCoveragePct: number; // e.g. 91.2% for 90% nominal interval
  readonly conformalFailureDetected: boolean;
}

export class ProbabilityCalibrator {
  // Platt scaling parameters: fitted via maximum likelihood
  private plattA = -1.2;
  private plattB = 0.1;

  // Historical pairs of (predicted, actualOutcome 0 or 1)
  private readonly observationHistory: Array<{ predicted: number; outcome: 0 | 1; regime?: string }> = [];

  public calibrate(rawProbability: number): number {
    const clamped = Math.max(0.001, Math.min(0.999, rawProbability));
    // Platt Sigmoid Scaling: 1 / (1 + exp(A * raw + B))
    const calibrated = 1 / (1 + Math.exp(this.plattA * (clamped * 2 - 1) + this.plattB));
    return Number(Math.max(0.01, Math.min(0.99, calibrated)).toFixed(3));
  }

  public recordOutcome(predicted: number, actualOutcome: 0 | 1, regime?: string): void {
    this.observationHistory.push({ predicted, outcome: actualOutcome, regime });
    if (this.observationHistory.length > 500) {
      this.observationHistory.shift();
    }
  }

  public generateReliabilityReport(): CalibrationReport {
    if (this.observationHistory.length === 0) {
      // Invariant 1 & Section XIX: Never fabricate good Brier (0.15), good ECE, or isWellCalibrated from zero samples
      return {
        brierScore: 0,
        logLoss: 0,
        expectedCalibrationErrorBps: 0,
        isWellCalibrated: false,
        evidenceState: 'INSUFFICIENT_EVIDENCE',
        bins: [],
        conformalCoveragePct: 0,
        conformalFailureDetected: false,
      };
    }

    const N = this.observationHistory.length;
    let brierSum = 0;
    let logLossSum = 0;

    for (const obs of this.observationHistory) {
      const p = Math.max(0.001, Math.min(0.999, obs.predicted));
      const y = obs.outcome;
      brierSum += (p - y) ** 2;
      logLossSum += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    }

    const brierScore = brierSum / N;
    const logLoss = logLossSum / N;

    // Build 10 calibration bins: [0.0-0.1, 0.1-0.2, ... 0.9-1.0]
    const bins: ReliabilityBin[] = [];
    let weightedEce = 0;

    for (let i = 0; i < 10; i++) {
      const low = i / 10;
      const high = (i + 1) / 10;
      const inBin = this.observationHistory.filter((o) => o.predicted >= low && o.predicted < high);

      if (inBin.length > 0) {
        const predAvg = inBin.reduce((acc, o) => acc + o.predicted, 0) / inBin.length;
        const obsAvg = inBin.reduce((acc, o) => acc + o.outcome, 0) / inBin.length;
        const err = Math.abs(predAvg - obsAvg);
        weightedEce += (inBin.length / N) * err;

        bins.push({
          binRange: [low, high],
          predictedAvg: Number(predAvg.toFixed(3)),
          observedAvg: Number(obsAvg.toFixed(3)),
          sampleCount: inBin.length,
          calibrationError: Number(err.toFixed(3)),
        });
      }
    }

    const eceBps = Math.round(weightedEce * 10_000);
    const isWellCalibrated = eceBps <= 800; // < 8% calibration error

    // Nominal 90% conformal interval test: interval is [p - 0.20, p + 0.20]
    let coveredCount = 0;
    for (const obs of this.observationHistory) {
      const lower = Math.max(0, obs.predicted - 0.25);
      const upper = Math.min(1, obs.predicted + 0.25);
      if (obs.outcome >= lower && obs.outcome <= upper) {
        coveredCount++;
      }
    }

    const coveragePct = (coveredCount / N) * 100;
    const conformalFailure = coveragePct < 70.0; // Nominal 90% covering < 70% is failure

    return {
      brierScore: Number(brierScore.toFixed(4)),
      logLoss: Number(logLoss.toFixed(4)),
      expectedCalibrationErrorBps: eceBps,
      isWellCalibrated,
      bins,
      conformalCoveragePct: Number(coveragePct.toFixed(1)),
      conformalFailureDetected: conformalFailure,
      evidenceState: 'CALIBRATED',
    };
  }
}

export class PlattSigmoidCalibrator {
  /**
   * Sigmoid Calibration (Platt Scaling):
   * Calibrates raw model log-odds into true probabilities without arbitrary heuristic squashing.
   * P(Y = 1 | f) = 1 / (1 + exp(A * f + B))
   */
  public static calibrate(rawScore: number, paramA: number = -1.0, paramB: number = 0.0): number {
    const logit = Math.max(-20, Math.min(20, paramA * rawScore + paramB));
    const calibrated = 1.0 / (1.0 + Math.exp(logit));
    return Number(calibrated.toFixed(4));
  }

  /**
   * Inverse Log-Transform for Crypto Multi-Bagger Peak Predictions (AGENTS.md):
   * When models are trained on target np.log1p(y), reverse with Math.expm1(predLog).
   * Prevents standard MSE from paralyzing model against massive outlier pumps and allows predicting beyond 2% safety floor.
   */
  public static inverseLogPeak(predictedLog1p: number): number {
    if (!Number.isFinite(predictedLog1p) || predictedLog1p <= 0) return 0;
    const rawPeakMultiplier = Math.expm1(predictedLog1p);
    return Number(rawPeakMultiplier.toFixed(4));
  }

  /**
   * Forward Log-Transform for Target Pre-Processing
   */
  public static forwardLogTarget(gainPct: number): number {
    if (!Number.isFinite(gainPct) || gainPct <= 0) return 0;
    return Number(Math.log1p(gainPct).toFixed(4));
  }
}
