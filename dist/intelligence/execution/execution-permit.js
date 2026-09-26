const copy = (value) => Object.freeze({ ...value });
const positive = (value, label) => { if (!Number.isFinite(value) || value <= 0)
    throw new Error(`INVALID_${label}: must be finite and positive`); };
export class ExecutionPermitEngine {
    permits = new Map();
    reservations = new Map();
    stages = new Map();
    sequence = 0;
    createRiskReservation(mint, amountSol, ttlMs = 10000) {
        if (!mint)
            throw new Error('INVALID_MINT: must be non-empty');
        positive(amountSol, 'RESERVATION_AMOUNT');
        positive(ttlMs, 'RESERVATION_TTL');
        const reservation = { reservationId: `res_${mint.slice(0, 6)}_${Date.now()}_${++this.sequence}`, mint, reservedSol: amountSol, expiresAtMs: Date.now() + ttlMs, isCommitted: false, isReleased: false };
        this.reservations.set(reservation.reservationId, reservation);
        return copy(reservation);
    }
    issuePermit(params) {
        const ttlMs = params.ttlMs ?? 5000;
        if (!params.mint || !params.decisionId || !params.policyHash || !params.evidenceHash)
            throw new Error('PERMIT_REJECTED: identity and provenance are required');
        positive(params.maxNotionalSol, 'PERMIT_NOTIONAL');
        positive(ttlMs, 'PERMIT_TTL');
        if (!Number.isInteger(params.snapshotSlot) || params.snapshotSlot < 0 || !Number.isInteger(params.stateEpoch) || params.stateEpoch < 0)
            throw new Error('PERMIT_REJECTED: slot and epoch must be non-negative integers');
        const reservation = this.reservations.get(params.riskReservationId);
        if (!reservation || reservation.isReleased || reservation.isCommitted || Date.now() > reservation.expiresAtMs)
            throw new Error(`PERMIT_REJECTED: Risk reservation ${params.riskReservationId} is invalid or expired`);
        if (reservation.mint !== params.mint)
            throw new Error('PERMIT_REJECTED: reservation mint mismatch');
        if (params.maxNotionalSol > reservation.reservedSol)
            throw new Error('PERMIT_REJECTED: notional exceeds reservation');
        const permit = { permitId: `permit_${params.mint.slice(0, 6)}_${Date.now()}_${++this.sequence}`, mint: params.mint, decisionId: params.decisionId, policyHash: params.policyHash, evidenceHash: params.evidenceHash, snapshotSlot: params.snapshotSlot, stateEpoch: params.stateEpoch, maxNotionalSol: params.maxNotionalSol, expiryMs: Date.now() + ttlMs, allowedExecutionModes: Object.freeze(['SIMULATION', 'SHADOW']), routeConstraints: Object.freeze(['pump_portal_bonding', 'raydium_v4']), riskReservationId: params.riskReservationId, isConsumed: false };
        this.permits.set(permit.permitId, permit);
        return copy(permit);
    }
    usable(permitId) {
        const permit = this.permits.get(permitId);
        if (!permit)
            throw new Error('Permit not found');
        if (permit.isConsumed)
            throw new Error('Permit already consumed');
        if (Date.now() > permit.expiryMs)
            throw new Error('Permit expired');
        const reservation = this.reservations.get(permit.riskReservationId);
        if (!reservation || reservation.isReleased || reservation.isCommitted || Date.now() > reservation.expiresAtMs)
            throw new Error('Risk reservation invalid or expired');
        return permit;
    }
    abort(permitId, reason) { this.stages.set(permitId, 'ABORTED'); return { valid: false, stage: 'ABORTED', reason }; }
    prepareExecution(permitId) {
        const permit = this.usable(permitId);
        const stage = this.stages.get(permitId);
        if (stage === 'ABORTED')
            throw new Error('Permit aborted');
        if (stage)
            throw new Error(`Invalid permit stage: expected PREPARE, found ${stage}`);
        this.stages.set(permitId, 'PREPARE');
        return { stage: 'PREPARE', permit: copy(permit) };
    }
    revalidateExecution(permitId, currentEpoch, currentSlippageBps, maxAllowedSlippageBps = 500) {
        let permit;
        try {
            permit = this.usable(permitId);
        }
        catch (error) {
            return this.abort(permitId, error instanceof Error ? error.message : 'PERMIT_INVALID');
        }
        if (this.stages.get(permitId) !== 'PREPARE')
            return this.abort(permitId, 'TOCTOU_PREPARE_REQUIRED');
        if (!Number.isFinite(currentEpoch) || !Number.isFinite(currentSlippageBps) || !Number.isFinite(maxAllowedSlippageBps) || currentSlippageBps < 0 || maxAllowedSlippageBps < 0)
            return this.abort(permitId, 'TOCTOU_INVALID_REVALIDATION_INPUT');
        if (currentEpoch !== permit.stateEpoch)
            return this.abort(permitId, `TOCTOU_EPOCH_MISMATCH: State epoch changed from ${permit.stateEpoch} to ${currentEpoch} during execution preparation`);
        if (currentSlippageBps > maxAllowedSlippageBps)
            return this.abort(permitId, `TOCTOU_SLIPPAGE_BLOWOUT: Slippage increased to ${currentSlippageBps}bps > ${maxAllowedSlippageBps}bps`);
        this.stages.set(permitId, 'REVALIDATE');
        return { valid: true, stage: 'REVALIDATE' };
    }
    commitExecution(permitId) {
        const permit = this.usable(permitId);
        if (this.stages.get(permitId) !== 'REVALIDATE')
            throw new Error('TOCTOU_REVALIDATION_REQUIRED');
        const reservation = this.reservations.get(permit.riskReservationId);
        permit.isConsumed = true;
        reservation.isCommitted = true;
        this.stages.set(permitId, 'COMMIT');
        return { stage: 'COMMIT', committedReservationId: permit.riskReservationId };
    }
    releaseReservation(reservationId) { const reservation = this.reservations.get(reservationId); if (reservation && !reservation.isCommitted)
        reservation.isReleased = true; }
}
//# sourceMappingURL=execution-permit.js.map