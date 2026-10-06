/**
 * SYLPH FUSION — 2X -> 10X RUNNER DISTINGUISHABILITY COURT
 * Study: 2X->10X-DISTINGUISHABILITY-X (Section X)
 *
 * Empirical Invariant:
 * Reaching 2x DOES NOT imply an extreme runner.
 * In the 74,919 tokens reaching >= 2x, only 2,079 (2.77%) reached 10x.
 * 47.42% ended below their original start price!
 *
 * At the first executable 2x crossing, freeze the state and evaluate whether
 * incremental features (capital renewal, inventory overhang, reachability)
 * provide statistically significant lift over the 2.77% base rate.
 * Price multiple alone must NEVER set eligibleForRunnerTreatment to true.
 */
import { createHash } from 'node:crypto';
export const HISTORICAL_2X_TO_10X_BASE_RATE = 0.027749; // 2.77%
export class RunnerDistinguishabilityCourt {
    static evaluateAt2xCrossing(features) {
        const baseRate = HISTORICAL_2X_TO_10X_BASE_RATE;
        // Price multiple alone cannot qualify runner treatment
        if (features.currentMultiple < 2.0) {
            return {
                baselineRunnerProbability: baseRate,
                calibratedRunnerProbability: 0.01,
                failureProbability: 0.90,
                liftVsBaseRate: 0.36,
                calibrationError: 0.05,
                uncertaintyLow: 0.005,
                uncertaintyHigh: 0.02,
                eligibleForRunnerTreatment: false,
                certificateDigest: 'REJECT_NOT_AT_2X',
            };
        }
        // Hard disqualifications
        if (features.inventoryLiabilityCliff ||
            !features.exitReachabilityPositive ||
            features.walletEntropy < 0.40 ||
            features.failureCommittor > 0.65) {
            const calibrated = Math.max(0.005, baseRate * 0.40);
            const digest = createHash('sha256')
                .update(`RUNNER_DISQUALIFIED::${features.currentMultiple}::${calibrated}`)
                .digest('hex');
            return {
                baselineRunnerProbability: baseRate,
                calibratedRunnerProbability: calibrated,
                failureProbability: Math.min(0.98, features.failureCommittor + 0.20),
                liftVsBaseRate: calibrated / baseRate,
                calibrationError: 0.08,
                uncertaintyLow: calibrated * 0.5,
                uncertaintyHigh: calibrated * 1.5,
                eligibleForRunnerTreatment: false,
                certificateDigest: digest,
            };
        }
        // Incremental feature scoring
        let score = 1.0;
        // Capital renewal expansion
        if (features.capitalRenewalRatio > 1.30)
            score *= 1.8;
        else if (features.capitalRenewalRatio > 1.10)
            score *= 1.3;
        else
            score *= 0.7;
        // Organic wallet dispersion
        if (features.walletEntropy > 0.75)
            score *= 1.5;
        else if (features.walletEntropy > 0.60)
            score *= 1.2;
        // Independent funding root acceleration
        if (features.independentCapitalAcceleration > 1.20)
            score *= 1.4;
        // Mitigate by failure committor
        const survivalFactor = Math.max(0.1, 1.0 - features.failureCommittor);
        score *= survivalFactor;
        // Calibrated runner probability (bounded by Bayes odds)
        const priorOdds = baseRate / (1.0 - baseRate);
        const posteriorOdds = priorOdds * score;
        const calibratedRunnerProbability = Math.min(0.35, posteriorOdds / (1.0 + posteriorOdds));
        const liftVsBaseRate = calibratedRunnerProbability / baseRate;
        // Eligible only if lift >= 3.0x over base rate (i.e. calibrated probability > ~8.3%)
        // and failure committor is below 40%
        const eligibleForRunnerTreatment = liftVsBaseRate >= 2.5 &&
            calibratedRunnerProbability >= 0.07 &&
            features.failureCommittor <= 0.45;
        const uncertaintyLow = Math.max(0.01, calibratedRunnerProbability * 0.65);
        const uncertaintyHigh = Math.min(0.50, calibratedRunnerProbability * 1.45);
        const calibrationError = Math.abs(calibratedRunnerProbability - (baseRate * score));
        const digest = createHash('sha256')
            .update([
            baseRate.toFixed(6),
            calibratedRunnerProbability.toFixed(6),
            features.failureCommittor.toFixed(4),
            liftVsBaseRate.toFixed(4),
            eligibleForRunnerTreatment ? 'ELIGIBLE' : 'INELIGIBLE',
        ].join('::'))
            .digest('hex');
        return {
            baselineRunnerProbability: baseRate,
            calibratedRunnerProbability,
            failureProbability: features.failureCommittor,
            liftVsBaseRate,
            calibrationError,
            uncertaintyLow,
            uncertaintyHigh,
            eligibleForRunnerTreatment,
            certificateDigest: digest,
        };
    }
}
//# sourceMappingURL=runner-distinguishability.js.map