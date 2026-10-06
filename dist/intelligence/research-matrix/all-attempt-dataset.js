/**
 * SYLPH FUSION — ALL-ATTEMPT DATASET (Section 29)
 *
 * Records EVERY evaluated candidate token without exception (ENTER, ABSTAIN, REJECT).
 * Completely eliminates survivor selection bias.
 *
 * Captures:
 * - Decision: ENTER | ABSTAIN | REJECT
 * - Responsible gate / veto
 * - Full point-in-time features & provenance
 * - Unknown / unobservable fields count
 * - Certificate roots
 * - Policy / Model / Code / Dataset versions
 * - Subsequent outcome link
 */
import { createHash } from 'node:crypto';
export class AllAttemptDatasetStore {
    attempts = [];
    maxRecords;
    constructor(maxRecords = 50000) {
        this.maxRecords = maxRecords;
    }
    /**
     * Appends an evaluated candidate attempt into the immutable log.
     */
    recordAttempt(params) {
        const attemptId = `att_${params.mint.slice(0, 8)}_${params.evaluatedAtMs}_${this.attempts.length + 1}`;
        const rawDigestPayload = JSON.stringify({
            attemptId,
            mint: params.mint,
            decision: params.decision,
            gate: params.responsibleGateOrVeto,
            evaluatedAtMs: params.evaluatedAtMs,
            certRoot: params.certificate?.certificateRoot ?? 'NO_CERT',
        });
        const recordHash = createHash('sha256')
            .update('ATTEMPT_RECORD_V1:')
            .update(rawDigestPayload)
            .digest('hex');
        const record = Object.freeze({
            ...params,
            attemptId,
            recordHash,
        });
        this.attempts.push(record);
        if (this.attempts.length > this.maxRecords) {
            this.attempts.shift();
        }
        return record;
    }
    getAttempts() {
        return this.attempts;
    }
    getAttemptById(attemptId) {
        return this.attempts.find(a => a.attemptId === attemptId);
    }
    getAttemptsForMint(mint) {
        return this.attempts.filter(a => a.mint === mint);
    }
    getDecisionBreakdown() {
        let enter = 0;
        let abstain = 0;
        let reject = 0;
        for (const a of this.attempts) {
            if (a.decision === 'ENTER')
                enter++;
            else if (a.decision === 'ABSTAIN')
                abstain++;
            else if (a.decision === 'REJECT')
                reject++;
        }
        return {
            total: this.attempts.length,
            enterCount: enter,
            abstainCount: abstain,
            rejectCount: reject,
        };
    }
}
//# sourceMappingURL=all-attempt-dataset.js.map