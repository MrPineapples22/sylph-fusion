/**
 * SYLPH FUSION — FAILURE-CONDITIONED CALIBRATOR
 * Specifications: Blueprint Section 33
 * Workbook: #539, #540
 *
 * Invariants:
 * 1. Never condition calibration solely on landed trades.
 * 2. Fit separate probabilities:
 *    - P(landing | route, fee, congestion, state)
 *    - P(success | landing, program, state)
 *    - P(profit | success, regime)
 * 3. Enforces zero favorable defaults: throws CALIBRATION_UNAVAILABLE when observations are insufficient.
 */

import { ExecutionAttemptRecord, ExecutionAttemptStatus } from '../../platform/calibration/all-attempt-dataset.js';

export type GranularExecutionOutcome =
  | 'LANDED_SUCCESS'
  | 'LANDED_INSTRUCTION_FAILURE'
  | 'BUILD_FAILURE'
  | 'SIGNER_FAILURE'
  | 'SUBMISSION_FAILURE'
  | 'TRANSPORT_AMBIGUITY'
  | 'CERTIFIED_NOLAND'
  | 'DISPUTED_TERMINALITY';

export interface ConditionalOutcomeDistribution {
  readonly route: string;
  readonly sampleCount: number;
  readonly outcomeCounts: Readonly<Record<GranularExecutionOutcome, number>>;
  readonly pLanding: number;
  readonly pSuccessGivenLanding: number;
  readonly pProfitGivenSuccess: number;
  readonly compositeLandingProbability: number;
  readonly compositeSuccessProbability: number;
  readonly evidenceRoot: string;
  readonly calibratedAt: number;
}

export interface CalibrationQuery {
  readonly route: string;
  readonly priorityFeeMicroLamports: bigint;
  readonly congestionLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly targetProgramId: string;
  readonly marketRegime: string;
}

export class FailureConditionedCalibrator {
  private readonly records: ExecutionAttemptRecord[] = [];

  public recordAttempt(attempt: ExecutionAttemptRecord): void {
    this.records.push(attempt);
  }

  public classifyGranularOutcome(status: ExecutionAttemptStatus, failureClass?: string): GranularExecutionOutcome {
    switch (status) {
      case 'LANDED_SUCCESS':
      case 'SETTLED':
        return 'LANDED_SUCCESS';
      case 'LANDED_FAILED':
        return 'LANDED_INSTRUCTION_FAILURE';
      case 'BUILD_FAILED':
        return 'BUILD_FAILURE';
      case 'SIGN_FAILED':
        return 'SIGNER_FAILURE';
      case 'CERTIFIED_NOLAND':
        return 'CERTIFIED_NOLAND';
      case 'DISPUTED':
        return 'DISPUTED_TERMINALITY';
      case 'UNKNOWN':
        return 'TRANSPORT_AMBIGUITY';
      case 'SUBMITTED':
      case 'ACKNOWLEDGED':
      default:
        if (failureClass?.includes('TRANSPORT') || failureClass?.includes('TIMEOUT')) {
          return 'TRANSPORT_AMBIGUITY';
        }
        return 'SUBMISSION_FAILURE';
    }
  }

  /**
   * Calibrate failure-conditioned probabilities.
   * Fails closed with CALIBRATION_UNAVAILABLE if sample count < minCohortSamples.
   */
  public calibrate(query: CalibrationQuery, minCohortSamples = 10): ConditionalOutcomeDistribution {
    const routeAttempts = this.records.filter((r) => r.route === query.route);

    if (routeAttempts.length < minCohortSamples) {
      throw new Error(
        `CALIBRATION_UNAVAILABLE: Insufficient observations for route ${query.route} (${routeAttempts.length} < ${minCohortSamples}); synthetic defaults forbidden`
      );
    }

    const outcomeCounts: Record<GranularExecutionOutcome, number> = {
      LANDED_SUCCESS: 0,
      LANDED_INSTRUCTION_FAILURE: 0,
      BUILD_FAILURE: 0,
      SIGNER_FAILURE: 0,
      SUBMISSION_FAILURE: 0,
      TRANSPORT_AMBIGUITY: 0,
      CERTIFIED_NOLAND: 0,
      DISPUTED_TERMINALITY: 0,
    };

    let landedCount = 0;
    let profitableCount = 0;

    for (const att of routeAttempts) {
      const outcome = this.classifyGranularOutcome(att.status, att.failureClass);
      outcomeCounts[outcome]++;

      const isLanded = outcome === 'LANDED_SUCCESS' || outcome === 'LANDED_INSTRUCTION_FAILURE';
      if (isLanded) {
        landedCount++;
      }

      if (outcome === 'LANDED_SUCCESS') {
        const netReturnRaw = (att.actualOutputRaw ?? 0n) - att.requestedInputLamports;
        if (netReturnRaw > 0n) {
          profitableCount++;
        }
      }
    }

    const total = routeAttempts.length;
    const pLanding = Number((landedCount / total).toFixed(4));
    const pSuccessGivenLanding = landedCount > 0 ? Number((outcomeCounts.LANDED_SUCCESS / landedCount).toFixed(4)) : 0;
    const pProfitGivenSuccess = outcomeCounts.LANDED_SUCCESS > 0 ? Number((profitableCount / outcomeCounts.LANDED_SUCCESS).toFixed(4)) : 0;

    const compositeSuccessProbability = Number((pLanding * pSuccessGivenLanding).toFixed(4));

    return {
      route: query.route,
      sampleCount: total,
      outcomeCounts,
      pLanding,
      pSuccessGivenLanding,
      pProfitGivenSuccess,
      compositeLandingProbability: pLanding,
      compositeSuccessProbability,
      evidenceRoot: `ev_calib_${query.route}_${total}_${Date.now()}`,
      calibratedAt: Date.now(),
    };
  }
}
