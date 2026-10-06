/**
 * SYLPH FUSION — RUNNER HOLD CERTIFICATE & STATE MACHINE
 * Sections XXXVI & XXXVII: Runner State Machine & Runner-Hold Certificate
 *
 * Implements the full runner lifecycle state machine:
 * PROTECTED -> RUNNER_CANDIDATE -> EXTREME_RUNNER -> PRINCIPAL_RECOVERED -> DISTRIBUTION -> CLOSED
 * With immediate emergency transitions:
 * -> FAILURE_REGIME -> EMERGENCY_EXIT
 *
 * Invariant: Runner hold authority requires a cryptographically bound certificate
 * with explicit expiration slots and fail-closed conditions.
 */
import { createHash } from 'node:crypto';
export class RunnerHoldManager {
    static MAX_CERTIFICATE_VALIDITY_SLOTS = 15n; // Valid for ~6 seconds
    /**
     * Evaluates state machine transition given current state and evidence.
     */
    static transitionState(currentState, triggers) {
        if (triggers.positionClosed)
            return 'CLOSED';
        if (triggers.isEmergencyTriggered)
            return 'EMERGENCY_EXIT';
        if (triggers.failureCommittorExceeded)
            return 'FAILURE_REGIME';
        switch (currentState) {
            case 'PROTECTED':
                return triggers.multipleReached2x ? 'RUNNER_CANDIDATE' : 'PROTECTED';
            case 'RUNNER_CANDIDATE':
                if (triggers.principalRecovered)
                    return 'PRINCIPAL_RECOVERED';
                return triggers.multipleReached2x ? 'EXTREME_RUNNER' : 'RUNNER_CANDIDATE';
            case 'EXTREME_RUNNER':
                if (triggers.principalRecovered)
                    return 'PRINCIPAL_RECOVERED';
                if (triggers.volumeExhausted)
                    return 'DISTRIBUTION';
                return 'EXTREME_RUNNER';
            case 'PRINCIPAL_RECOVERED':
                if (triggers.volumeExhausted)
                    return 'DISTRIBUTION';
                return 'PRINCIPAL_RECOVERED';
            case 'DISTRIBUTION':
                return 'DISTRIBUTION';
            case 'FAILURE_REGIME':
                return 'EMERGENCY_EXIT';
            case 'EMERGENCY_EXIT':
                return 'CLOSED';
            case 'CLOSED':
                return 'CLOSED';
            default:
                return 'CLOSED';
        }
    }
    /**
     * Issues or rejects a RunnerHoldCertificate.
     */
    static issueCertificate(params) {
        const { positionId, mint, runnerState, currentSlot, informationSufficient, calibratedRunnerProb, failureCommittor, capitalRenewalScore, inventoryLiabilityAcceptable, exitReachabilityPositive, liquidityStressAcceptable, authenticityStillValid, } = params;
        const baseRate = 0.0277;
        const lift = calibratedRunnerProb / baseRate;
        // Fail-closed conditions:
        const holdAuthorized = informationSufficient &&
            authenticityStillValid &&
            exitReachabilityPositive &&
            liquidityStressAcceptable &&
            inventoryLiabilityAcceptable &&
            failureCommittor <= 0.45 &&
            capitalRenewalScore >= 0.35 &&
            lift >= 2.0 &&
            runnerState !== 'FAILURE_REGIME' &&
            runnerState !== 'EMERGENCY_EXIT' &&
            runnerState !== 'CLOSED';
        const validUntilSlot = currentSlot + RunnerHoldManager.MAX_CERTIFICATE_VALIDITY_SLOTS;
        const digest = createHash('sha256')
            .update([
            positionId,
            mint,
            runnerState,
            holdAuthorized ? 'AUTHORIZED' : 'DENIED',
            calibratedRunnerProb.toFixed(4),
            failureCommittor.toFixed(4),
            validUntilSlot.toString(),
        ].join('::'))
            .digest('hex');
        return {
            positionId,
            mint,
            runnerState,
            informationSufficient,
            calibratedRunnerProb,
            liftVsBaseRate: lift,
            failureCommittor,
            capitalRenewalScore,
            inventoryLiabilityAcceptable,
            exitReachabilityPositive,
            liquidityStressAcceptable,
            authenticityStillValid,
            holdAuthorized,
            validUntilSlot,
            certificateDigest: digest,
        };
    }
}
//# sourceMappingURL=runner-hold.js.map