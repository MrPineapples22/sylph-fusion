/**
 * SYLPH FUSION — PROSPECTIVE LAW COURT ENGINE
 * Section XXVIII & Study 47: EXECUTABLE-LAW-COURT-X
 *
 * Freezes the entire policy contract BEFORE prospective trial begins:
 * - Code hash & release root
 * - Feature schema & thresholds
 * - Decision & exit policies
 * - Sizing rules & cost models
 *
 * Invariant:
 * Every eligible candidate MUST remain in the denominator.
 * No survivor bias, no cherry-picking, no parameter changes during adjudication.
 */
import { createHash } from 'node:crypto';
export class ProspectiveLawCourt {
    contract;
    trials = [];
    constructor(sessionParams) {
        const { sessionId, codeHash, featureSchemaRoot, decisionPolicyVersion, exitPolicyVersion, fixedStakeUsd = 250.0, } = sessionParams;
        const frozenAt = Date.now();
        const digest = createHash('sha256')
            .update([
            sessionId,
            codeHash,
            featureSchemaRoot,
            decisionPolicyVersion,
            exitPolicyVersion,
            fixedStakeUsd.toFixed(2),
            frozenAt.toString(),
        ].join('::'))
            .digest('hex');
        this.contract = {
            courtSessionId: sessionId,
            codeHash,
            featureSchemaRoot,
            decisionPolicyVersion,
            exitPolicyVersion,
            fixedStakeUsd,
            frozenAtTimestampMs: frozenAt,
            contractDigest: digest,
        };
    }
    getFrozenContract() {
        return this.contract;
    }
    recordTrialVerdict(verdict) {
        this.trials.push(verdict);
    }
    adjudicate() {
        const total = this.trials.length;
        let entered = 0;
        let abstained = 0;
        let rejected = 0;
        let entryQuoteMissing = 0;
        let entryFailure = 0;
        let noLand = 0;
        let exitFailure = 0;
        let completeLoss = 0;
        let successfulRunner = 0;
        let unresolved = 0;
        let cumulativeNetPnL = 0;
        for (const t of this.trials) {
            if (t.decision === 'ENTER')
                entered++;
            else if (t.decision === 'ABSTAIN')
                abstained++;
            else if (t.decision === 'REJECT')
                rejected++;
            cumulativeNetPnL += t.netRealizedPnLUsd;
            if (!t.isResolved)
                unresolved++;
            if (t.outcomes.includes('ENTRY_NOLAND'))
                noLand++;
            if (t.outcomes.includes('EXIT_NOLAND') || t.outcomes.includes('EXIT_UNREACHABLE'))
                exitFailure++;
            if (t.outcomes.includes('COLLAPSED_90') || t.outcomes.includes('COLLAPSED_80'))
                completeLoss++;
            if (t.outcomes.includes('REACHED_10X') && t.outcomes.includes('PROFITABLE_AFTER_COST'))
                successfulRunner++;
            if (t.outcomes.includes('MISSING_OUTCOME'))
                entryQuoteMissing++;
        }
        const netExecutableExpectancyUsd = total > 0 ? cumulativeNetPnL / total : 0;
        let courtRuling = 'PROMOTION_INSUFFICIENT_EVIDENCE';
        if (total >= 100) {
            if (netExecutableExpectancyUsd > 0 && successfulRunner > 0) {
                courtRuling = 'PROMOTION_APPROVED';
            }
            else {
                courtRuling = 'PROMOTION_DISMISSED_NEGATIVE_EXPECTANCY';
            }
        }
        return {
            totalCandidatesPresented: total,
            enteredCount: entered,
            abstainedCount: abstained,
            rejectedCount: rejected,
            entryQuoteMissingCount: entryQuoteMissing,
            entryFailureCount: entryFailure,
            noLandCount: noLand,
            exitFailureCount: exitFailure,
            completeLossCount: completeLoss,
            successfulRunnerCount: successfulRunner,
            unresolvedCount: unresolved,
            netExecutableExpectancyUsd,
            courtRuling,
        };
    }
}
//# sourceMappingURL=prospective-law-court.js.map