/**
 * SOL-SYLPH Approval State Machine & Approval Lease Engine
 * Blueprint Parts XXXIII, XXXIV
 *
 * Formal state machine:
 * DISCOVERED, VERIFYING, QUARANTINED, OBSERVING, PROVISIONAL,
 * APPROVED, EXECUTION_READY, REJECTED, REVOKED, ABSTAIN.
 *
 * Approval is temporary and contingent upon an active ApprovalLease.
 * Critical events invalidate leases immediately.
 */
export class ApprovalLeaseEngine {
    states = new Map();
    leases = new Map();
    getApprovalState(mint) {
        return this.states.get(mint) ?? 'DISCOVERED';
    }
    transitionState(mint, nextState, reason) {
        const prev = this.states.get(mint) ?? 'DISCOVERED';
        // Disallow invalid transitions
        if (prev === 'QUARANTINED' && nextState === 'EXECUTION_READY') {
            throw new Error(`ILLEGAL_TRANSITION: Cannot move directly from QUARANTINED to EXECUTION_READY for ${mint}`);
        }
        this.states.set(mint, nextState);
        if (nextState === 'REJECTED' || nextState === 'REVOKED' || nextState === 'QUARANTINED') {
            this.revokeLease(mint, reason);
        }
        return nextState;
    }
    issueLease(params) {
        const now = Date.now();
        const ttl = params.ttlMs ?? 15000; // 15 second default lease
        if (params.proofState !== '3/3') {
            throw new Error(`LEASE_REJECTED: Proof state must be 3/3 to issue approval lease (got ${params.proofState})`);
        }
        const lease = {
            leaseId: `lease_${params.mint.slice(0, 8)}_${now}`,
            mint: params.mint,
            issuedAtMs: now,
            expiresAtMs: now + ttl,
            ttlMs: ttl,
            requiredInvariants: params.requiredInvariants ?? [
                'freeze_revoked',
                'mint_revoked_or_safe',
                'exit_capacity_above_minimum',
                'proof_3_3_valid',
            ],
            proofState: params.proofState,
            isValid: true,
        };
        this.leases.set(params.mint, lease);
        this.states.set(params.mint, 'EXECUTION_READY');
        return lease;
    }
    validateLease(mint) {
        const lease = this.leases.get(mint);
        if (!lease) {
            return { valid: false, reason: 'NO_LEASE_ISSUED' };
        }
        if (!lease.isValid) {
            return { valid: false, lease, reason: `LEASE_REVOKED: ${lease.revocationReason}` };
        }
        if (Date.now() > lease.expiresAtMs) {
            return { valid: false, lease, reason: 'LEASE_EXPIRED' };
        }
        return { valid: true, lease };
    }
    revokeLease(mint, reason) {
        const lease = this.leases.get(mint);
        if (lease) {
            lease.isValid = false;
            lease.revocationReason = reason;
            this.states.set(mint, 'REVOKED');
        }
    }
}
//# sourceMappingURL=approval-lease.js.map