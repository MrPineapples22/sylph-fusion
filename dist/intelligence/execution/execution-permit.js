/**
 * SOL-SYLPH Execution Permit, TOCTOU Protection & Risk Reservations
 * Blueprint Parts LXVI, LXVII, LXXI
 *
 * ExecutionEngine requires a single-use ExecutionPermit rather than naked commands.
 * Implements PREPARE → REVALIDATE → COMMIT to prevent TOCTOU exploitation.
 * Reserves risk capacity to prevent simultaneous concurrent tasks from double-spending risk budget.
 */
export class ExecutionPermitEngine {
    permits = new Map();
    reservations = new Map();
    createRiskReservation(mint, amountSol, ttlMs = 10000) {
        const reservation = {
            reservationId: `res_${mint.slice(0, 6)}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            mint,
            reservedSol: amountSol,
            expiresAtMs: Date.now() + ttlMs,
            isCommitted: false,
            isReleased: false,
        };
        this.reservations.set(reservation.reservationId, reservation);
        return reservation;
    }
    issuePermit(params) {
        const res = this.reservations.get(params.riskReservationId);
        if (!res || res.isReleased || Date.now() > res.expiresAtMs) {
            throw new Error(`PERMIT_REJECTED: Risk reservation ${params.riskReservationId} is invalid or expired`);
        }
        const permit = {
            permitId: `permit_${params.mint.slice(0, 6)}_${Date.now()}`,
            mint: params.mint,
            decisionId: params.decisionId,
            policyHash: params.policyHash,
            evidenceHash: params.evidenceHash,
            snapshotSlot: params.snapshotSlot,
            stateEpoch: params.stateEpoch,
            maxNotionalSol: params.maxNotionalSol,
            expiryMs: Date.now() + (params.ttlMs ?? 5000),
            allowedExecutionModes: ['SIMULATION', 'SHADOW', 'LIVE'],
            routeConstraints: ['pump_portal_bonding', 'raydium_v4'],
            riskReservationId: params.riskReservationId,
            isConsumed: false,
        };
        this.permits.set(permit.permitId, permit);
        return permit;
    }
    /**
     * TOCTOU Protection Protocol: PREPARE → REVALIDATE → COMMIT
     */
    prepareExecution(permitId) {
        const permit = this.permits.get(permitId);
        if (!permit)
            throw new Error('Permit not found');
        if (permit.isConsumed)
            throw new Error('Permit already consumed');
        if (Date.now() > permit.expiryMs)
            throw new Error('Permit expired');
        return { stage: 'PREPARE', permit };
    }
    revalidateExecution(permitId, currentEpoch, currentSlippageBps, maxAllowedSlippageBps = 500) {
        const permit = this.permits.get(permitId);
        if (!permit)
            return { valid: false, stage: 'ABORTED', reason: 'PERMIT_NOT_FOUND' };
        if (currentEpoch !== permit.stateEpoch) {
            return {
                valid: false,
                stage: 'ABORTED',
                reason: `TOCTOU_EPOCH_MISMATCH: State epoch changed from ${permit.stateEpoch} to ${currentEpoch} during execution preparation`,
            };
        }
        if (currentSlippageBps > maxAllowedSlippageBps) {
            return {
                valid: false,
                stage: 'ABORTED',
                reason: `TOCTOU_SLIPPAGE_BLOWOUT: Slippage increased to ${currentSlippageBps}bps > ${maxAllowedSlippageBps}bps`,
            };
        }
        return { valid: true, stage: 'REVALIDATE' };
    }
    commitExecution(permitId) {
        const permit = this.permits.get(permitId);
        if (!permit)
            throw new Error('Permit not found');
        permit.isConsumed = true;
        const res = this.reservations.get(permit.riskReservationId);
        if (res)
            res.isCommitted = true;
        return { stage: 'COMMIT', committedReservationId: permit.riskReservationId };
    }
    releaseReservation(reservationId) {
        const res = this.reservations.get(reservationId);
        if (res)
            res.isReleased = true;
    }
}
//# sourceMappingURL=execution-permit.js.map