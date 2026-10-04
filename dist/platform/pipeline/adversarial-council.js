/**
 * SYLPH FUSION — ADVERSARIAL EVIDENCE COUNCIL & RESOURCE ADMISSION
 * Specifications: Prompt 30 (Skeptic/Prover Layer), Prompt 32 (Risk Composition),
 *                 Prompt 33 (Resource Admission Before Capital),
 *                 Prompt 34 (Economic Workload Deduplication)
 *
 * Epistemic Rules:
 * 1. Prover asks: What certified evidence supports this opportunity?
 * 2. Skeptic asks: What certified evidence could falsify it?
 * 3. EvidenceCouncil determines: SUFFICIENT | INSUFFICIENT | CONTRADICTORY | DEGRADED | UNKNOWN.
 * 4. INVARIANT: No majority vote may convert missing evidence into truth. UNKNOWN != FALSE.
 * 5. Order: RISK_APPROVED -> RESOURCE_ADMITTED -> CAPITAL_RESERVED.
 * 6. Workload Deduplication: One economicFactId = one economic workload permit.
 */
import { hashCanonical } from './canonical-hashing.js';
export class AdversarialEvidenceCouncil {
    /**
     * Evaluates Prover affirmative claims against Skeptic falsification probes.
     * Produces an immutable, hash-bound CouncilVerdict.
     */
    evaluateDialectic(economicFactId, prover, skepticChecks, evaluatedAt) {
        const rejectionReasons = [];
        // 1. Prover validation: missing essential evidence -> INSUFFICIENT
        if (!prover.temporalValidityVerified || prover.authenticityScore <= 0 || prover.liquidityLamports <= 0n) {
            rejectionReasons.push('PROVER_EVIDENCE_DEFICIT: Incomplete or unverified opportunity evidence');
        }
        // 2. Skeptic falsification review
        let fatalVeto = false;
        let highUncertainty = false;
        for (const check of skepticChecks) {
            if (!check.passed) {
                if (check.severity === 'FATAL_VETO') {
                    fatalVeto = true;
                    rejectionReasons.push(`SKEPTIC_FATAL_VETO: ${check.checkName} - ${check.reason ?? 'Failed invariant'}`);
                }
                else if (check.severity === 'HIGH_UNCERTAINTY') {
                    highUncertainty = true;
                    rejectionReasons.push(`SKEPTIC_UNCERTAINTY: ${check.checkName} - ${check.reason ?? 'High variance'}`);
                }
            }
        }
        let status = 'SUFFICIENT';
        if (fatalVeto) {
            status = 'CONTRADICTORY';
        }
        else if (rejectionReasons.length > 0 && !highUncertainty) {
            status = 'INSUFFICIENT';
        }
        else if (highUncertainty) {
            status = 'DEGRADED';
        }
        const approved = status === 'SUFFICIENT' && rejectionReasons.length === 0;
        const proverRoot = hashCanonical(prover);
        const skepticRoot = hashCanonical(skepticChecks);
        const preimage = {
            economicFactId,
            status,
            approved,
            proverRoot,
            skepticRoot,
            rejectionReasons,
            evaluatedAt,
        };
        const councilVerdictHash = hashCanonical(preimage);
        return Object.freeze({
            ...preimage,
            councilVerdictHash,
        });
    }
}
export class ResourceAdmissionController {
    activePermitsByFactId = new Map();
    maxActiveLiabilities;
    maxVerificationQueue;
    constructor(maxActiveLiabilities = 5, maxVerificationQueue = 20) {
        this.maxActiveLiabilities = maxActiveLiabilities;
        this.maxVerificationQueue = maxVerificationQueue;
    }
    /**
     * Evaluates operational capacity and admits or rejects the economic workload.
     * Enforces Prompt 33 & 34: One economicFactId = one work permit, no duplicate work.
     */
    admitWorkload(economicFactId, capacity, timestamp) {
        // Prompt 34: Deduplication check
        const existing = this.activePermitsByFactId.get(economicFactId);
        if (existing && existing.admitted) {
            // Re-return existing permit to prevent duplicate capital/signer reservations
            return existing;
        }
        // Capacity checks
        if (!capacity.streamFeedHealthy) {
            return this.reject(economicFactId, timestamp, 'STREAM_FEED_UNHEALTHY');
        }
        if (!capacity.archiveQuorumAvailable) {
            return this.reject(economicFactId, timestamp, 'ARCHIVE_QUORUM_UNAVAILABLE');
        }
        if (capacity.rpcCapacityAvailablePct < 15) {
            return this.reject(economicFactId, timestamp, 'RPC_CAPACITY_EXHAUSTED');
        }
        if (capacity.verificationQueueDepth > this.maxVerificationQueue) {
            return this.reject(economicFactId, timestamp, 'VERIFICATION_QUEUE_CONGESTED');
        }
        if (capacity.activeUnresolvedLiabilities >= this.maxActiveLiabilities) {
            return this.reject(economicFactId, timestamp, 'ACTIVE_LIABILITIES_AT_CEILING');
        }
        if (capacity.memoryPressurePct > 90) {
            return this.reject(economicFactId, timestamp, 'MEMORY_PRESSURE_CRITICAL');
        }
        const resourceReservationId = `res_${hashCanonical({ economicFactId, timestamp }).slice(0, 16)}`;
        const economicWorkPermitId = `work_${hashCanonical({ economicFactId, resourceReservationId }).slice(0, 16)}`;
        const safetyCapacityRoot = hashCanonical(capacity);
        const permit = Object.freeze({
            economicFactId,
            resourceReservationId,
            economicWorkPermitId,
            safetyCapacityRoot,
            issuedAt: timestamp,
            admitted: true,
        });
        this.activePermitsByFactId.set(economicFactId, permit);
        return permit;
    }
    releaseWorkload(economicFactId) {
        this.activePermitsByFactId.delete(economicFactId);
    }
    reject(economicFactId, timestamp, reason) {
        return Object.freeze({
            economicFactId,
            resourceReservationId: '',
            economicWorkPermitId: '',
            safetyCapacityRoot: '',
            issuedAt: timestamp,
            admitted: false,
            denialReason: reason,
        });
    }
}
//# sourceMappingURL=adversarial-council.js.map