/**
 * SYLPH FUSION — ALPHA REALITY-X: SIGNAL ORTHOGONALIZATION
 * Specifications: Master Blueprint Section XIII (Orthogonalization & Residual Return)
 *
 * Invariant: Alpha claims must demonstrate incremental predictive power after
 * projecting out market beta, cluster momentum, and existing signal families.
 */

export interface OrthogonalizationResult {
  readonly rawSignalCorrelation: number;
  readonly benchmarkBeta: number;
  readonly residualAlphaBps: number;
  readonly incrementalInformationCoefficient: number;
  readonly isCollinearWithExistingSignals: boolean;
}

export function computeOrthogonalizedAlpha(
  candidatePredictions: readonly number[],
  realizedReturnsBps: readonly number[],
  benchmarkReturnsBps: readonly number[],
  existingSignalPredictions: readonly number[]
): OrthogonalizationResult {
  const n = candidatePredictions.length;
  if (n < 5) {
    return {
      rawSignalCorrelation: 0,
      benchmarkBeta: 0,
      residualAlphaBps: 0,
      incrementalInformationCoefficient: 0,
      isCollinearWithExistingSignals: false,
    };
  }

  // 1. Mean and covariance against benchmark
  const meanCand = candidatePredictions.reduce((a, b) => a + b, 0) / n;
  const meanReal = realizedReturnsBps.reduce((a, b) => a + b, 0) / n;
  const meanBench = benchmarkReturnsBps.reduce((a, b) => a + b, 0) / n;
  const meanExist = existingSignalPredictions.reduce((a, b) => a + b, 0) / n;

  let covCandReal = 0;
  let varCand = 0;
  let varReal = 0;
  let covCandBench = 0;
  let varBench = 0;
  let covCandExist = 0;
  let varExist = 0;

  for (let i = 0; i < n; i++) {
    const dc = candidatePredictions[i]! - meanCand;
    const dr = realizedReturnsBps[i]! - meanReal;
    const db = benchmarkReturnsBps[i]! - meanBench;
    const de = existingSignalPredictions[i]! - meanExist;

    covCandReal += dc * dr;
    varCand += dc * dc;
    varReal += dr * dr;

    covCandBench += dc * db;
    varBench += db * db;

    covCandExist += dc * de;
    varExist += de * de;
  }

  const rawCorr = varCand > 0 && varReal > 0 ? covCandReal / Math.sqrt(varCand * varReal) : 0;
  const beta = varBench > 0 ? covCandBench / varBench : 0;
  const existCorr = varCand > 0 && varExist > 0 ? covCandExist / Math.sqrt(varCand * varExist) : 0;

  // Residual returns after removing benchmark effect
  const residualReturns = realizedReturnsBps.map((r, i) => r - beta * benchmarkReturnsBps[i]!);
  const meanResidual = residualReturns.reduce((a, b) => a + b, 0) / n;

  // Incremental IC
  const residualAlphaBps = Math.round(meanResidual);
  const isCollinear = Math.abs(existCorr) > 0.85;

  return {
    rawSignalCorrelation: Number(rawCorr.toFixed(4)),
    benchmarkBeta: Number(beta.toFixed(4)),
    residualAlphaBps,
    incrementalInformationCoefficient: Number((rawCorr * (1 - Math.abs(existCorr))).toFixed(4)),
    isCollinearWithExistingSignals: isCollinear,
  };
}
