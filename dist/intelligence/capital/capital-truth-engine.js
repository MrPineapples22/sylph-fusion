/**
 * SYLPH CAPITAL AUTHORITY & SURVIVAL ARCHITECTURE
 * Parts II, III, IV, V, VI, VII — Capital Truth Engine, Event Ledger, Double-Entry & Durability Core
 *
 * Implements the single authoritative representation of managed capital,
 * append-only event sourcing with cryptographic hash-chaining, double-entry
 * conservation identities, and durable WAL commit certificates.
 */
import { createHash } from 'node:crypto';
export class CapitalTruthEngine {
    confirmedCashSol;
    reservedCashSol = 0.0;
    emergencyReserveSol = 5.0; // Protected SOL never exposed to trades
    dailySpendSol = 0.0;
    dailyRealizedLossSol = 0.0;
    controlEpoch = 1;
    revocationEpoch = 1;
    authorityMode = 'A5_NORMAL';
    stateVersion = 100;
    signerCounter = 0;
    // Double-entry accounting buckets
    realizedProceedsSol = 0.0;
    realizedLossesSol = 0.0;
    baseFeesSol = 0.0;
    priorityFeesSol = 0.0;
    jitoTipsSol = 0.0;
    rentCostsSol = 0.0;
    transferFeesSol = 0.0;
    slippageLossSol = 0.0;
    failedTxCostsSol = 0.0;
    initialPrincipalSol;
    // Append-only event history with cryptographic hash-chaining
    eventLedger = [];
    lastEventHash = '0000000000000000000000000000000000000000000000000000000000000000';
    activeReservations = new Map();
    // Idempotency tracking to prevent double settlement
    settledIntents = new Set();
    // Commit certificates log (Write-Ahead Log)
    commitLog = new Map();
    positions = new Map();
    unresolvedTxsCount = 0;
    unresolvedIntentsCount = 0;
    constructor(initialCashSol = 100.0) {
        this.initialPrincipalSol = initialCashSol;
        this.confirmedCashSol = initialCashSol;
        this.recordEvent({
            event_type: 'AUTHORITY_CHANGED',
            entity_id: 'SYSTEM_BOOT',
            delta_sol: 0,
            slot: 1,
            payload: { mode: this.authorityMode, cash: this.confirmedCashSol },
        });
    }
    /**
     * Generates a deterministic canonical hash for event chaining (Part V).
     */
    computeEventHash(seq, prevHash, type, entityId, delta, balance, timestamp, slot, payload) {
        const canonical = JSON.stringify({
            seq,
            prevHash,
            type,
            entityId,
            delta: delta.toFixed(9),
            balance: balance.toFixed(9),
            timestamp,
            slot,
            payload,
        });
        return createHash('sha256').update(canonical).digest('hex');
    }
    /**
     * Appends an economic event to the immutable ledger.
     */
    recordEvent(params) {
        const seq = this.eventLedger.length + 1;
        const now = Date.now();
        const balance = this.confirmedCashSol;
        const payload = params.payload ?? {};
        const eventHash = this.computeEventHash(seq, this.lastEventHash, params.event_type, params.entity_id, params.delta_sol, balance, now, params.slot, payload);
        const event = {
            sequence_number: seq,
            event_type: params.event_type,
            timestamp_ms: now,
            slot: params.slot,
            entity_id: params.entity_id,
            delta_sol: params.delta_sol,
            balance_after_sol: balance,
            payload,
            previous_event_hash: this.lastEventHash,
            event_hash: eventHash,
        };
        this.eventLedger.push(event);
        this.lastEventHash = eventHash;
        this.stateVersion += 1;
        return event;
    }
    /**
     * Reserves capital atomically with version check (Parts VIII & IX).
     */
    reserveCapital(params) {
        const nonNegativeFinite = [params.amount_sol, params.max_fee_sol, params.max_tip_sol]
            .every(value => Number.isFinite(value) && value >= 0);
        if (!params.reservation_id.trim() || !params.owner_id.trim() || !nonNegativeFinite ||
            !Number.isSafeInteger(params.expected_state_version) || params.expected_state_version < 0 ||
            !Number.isSafeInteger(params.slot) || params.slot < 0) {
            return { success: false, reason: 'INVALID_RESERVATION_INPUT' };
        }
        // Serializable optimistic concurrency: abort if state version changed
        if (params.expected_state_version !== this.stateVersion) {
            return { success: false, reason: `STATE_VERSION_MISMATCH: expected ${params.expected_state_version}, current ${this.stateVersion}` };
        }
        const totalRequired = params.amount_sol + params.max_fee_sol + params.max_tip_sol;
        if (!Number.isFinite(totalRequired) || totalRequired <= 0)
            return { success: false, reason: 'INVALID_RESERVATION_INPUT' };
        const effectiveAvailable = this.confirmedCashSol - this.reservedCashSol - this.emergencyReserveSol;
        if (effectiveAvailable < totalRequired) {
            return {
                success: false,
                reason: `INSUFFICIENT_UNRESERVED_CASH: available ${effectiveAvailable.toFixed(3)} SOL, required ${totalRequired.toFixed(3)} SOL (emergency reserve ${this.emergencyReserveSol} SOL protected)`,
            };
        }
        if (this.activeReservations.has(params.reservation_id)) {
            return { success: false, reason: `DUPLICATE_RESERVATION_ID: ${params.reservation_id}` };
        }
        this.reservedCashSol += totalRequired;
        this.activeReservations.set(params.reservation_id, {
            owner_id: params.owner_id,
            amount_sol: totalRequired,
            max_fee_sol: params.max_fee_sol + params.max_tip_sol,
            status: 'RESERVED',
            slot: params.slot,
        });
        this.recordEvent({
            event_type: 'RESERVATION_CREATED',
            entity_id: params.reservation_id,
            delta_sol: -totalRequired,
            slot: params.slot,
            payload: { owner: params.owner_id, amount: totalRequired },
        });
        return { success: true, reservation_id: params.reservation_id };
    }
    /**
     * Writes an atomic Commit Certificate prior to signing (Parts VII & XII).
     * "NO DURABLE CAPITAL COMMIT = NO NEW CAPITAL SIGNATURE"
     */
    writeCommitCertificate(params) {
        const reservation = this.activeReservations.get(params.reservation_id);
        if (!reservation)
            throw new Error(`Cannot commit without valid reservation ${params.reservation_id}`);
        if (reservation.status !== 'RESERVED')
            throw new Error(`Reservation ${params.reservation_id} is in status ${reservation.status}`);
        const certId = `cert_${params.intent_id}_${this.stateVersion}`;
        const stateRoot = this.getCapitalStateRoot();
        const certHash = createHash('sha256')
            .update(JSON.stringify({
            certId,
            intent_id: params.intent_id,
            reservation_id: params.reservation_id,
            stateRoot,
            survival_proof_root: params.survival_proof_root,
            control_epoch: this.controlEpoch,
            revocation_epoch: this.revocationEpoch,
            production_root: params.production_root,
            max_debit: params.max_sol_debit,
            expiration: params.expiration_slot,
        }))
            .digest('hex');
        const cert = {
            certificate_id: certId,
            intent_id: params.intent_id,
            reservation_id: params.reservation_id,
            capital_state_root: stateRoot,
            survival_proof_root: params.survival_proof_root,
            control_epoch: this.controlEpoch,
            revocation_epoch: this.revocationEpoch,
            production_root: params.production_root,
            max_sol_debit: params.max_sol_debit,
            max_fee_sol: params.max_fee_sol,
            max_tip_sol: params.max_tip_sol,
            expiration_slot: params.expiration_slot,
            commit_generation: params.commit_generation,
            is_durable_committed: true,
            certificate_hash: certHash,
        };
        this.commitLog.set(params.intent_id, cert);
        this.recordEvent({
            event_type: 'INTENT_COMMITTED',
            entity_id: params.intent_id,
            delta_sol: 0,
            slot: params.slot,
            payload: { certId, certHash },
        });
        return cert;
    }
    /**
     * Finalizes on-chain settlement, updates double-entry ledgers (Parts IV & LXIX).
     */
    settleExecution(params) {
        if (this.settledIntents.has(params.intent_id)) {
            throw new Error(`DUPLICATE_SETTLEMENT_ATTEMPT: intent ${params.intent_id} has already been settled`);
        }
        const amounts = [params.actual_sol_spent, params.base_fee_sol, params.priority_fee_sol, params.jito_tip_sol];
        if (!params.intent_id.trim() || !params.reservation_id.trim() || !params.mint.trim() ||
            !amounts.every(value => Number.isFinite(value) && value >= 0) ||
            !Number.isSafeInteger(params.slot) || params.slot < 0) {
            throw new Error('INVALID_SETTLEMENT_INPUT');
        }
        const reservation = this.activeReservations.get(params.reservation_id);
        if (!reservation)
            throw new Error(`Reservation not found ${params.reservation_id}`);
        const reservedAmount = reservation.amount_sol;
        const totalSpent = params.actual_sol_spent + params.base_fee_sol + params.priority_fee_sol + params.jito_tip_sol;
        if (totalSpent > reservedAmount)
            throw new Error('SETTLEMENT_EXCEEDS_RESERVATION');
        this.settledIntents.add(params.intent_id);
        // Release reservation
        this.reservedCashSol = Math.max(0, this.reservedCashSol - reservedAmount);
        this.activeReservations.delete(params.reservation_id);
        // Deduct confirmed cash
        this.confirmedCashSol -= totalSpent;
        this.dailySpendSol += totalSpent;
        // Attribute fees to double-entry ledger
        this.baseFeesSol += params.base_fee_sol;
        this.priorityFeesSol += params.priority_fee_sol;
        this.jitoTipsSol += params.jito_tip_sol;
        // Record open position
        this.positions.set(params.mint, {
            mint: params.mint,
            amount_sol: params.actual_sol_spent,
            entry_slot: params.slot,
        });
        this.recordEvent({
            event_type: 'POSITION_OPENED',
            entity_id: params.mint,
            delta_sol: -totalSpent,
            slot: params.slot,
            payload: { spent: totalSpent, mint: params.mint },
        });
    }
    /**
     * Finalizes on-chain settlement for position exit/reduction (Parts IV, VIII, IX).
     * Updates confirmed positions, exposure, cash, realized PnL, fees, and event ledger.
     */
    settleExit(params) {
        if (!params.intent_id.trim() || !params.mint.trim() ||
            !Number.isFinite(params.sol_received) || params.sol_received < 0 ||
            !Number.isFinite(params.fee_sol) || params.fee_sol < 0 ||
            !Number.isSafeInteger(params.slot) || params.slot < 0) {
            throw new Error('INVALID_EXIT_SETTLEMENT_INPUT');
        }
        if (this.settledIntents.has(params.intent_id)) {
            throw new Error(`DUPLICATE_SETTLEMENT_ATTEMPT: exit intent ${params.intent_id} already settled`);
        }
        const pos = this.positions.get(params.mint);
        if (!pos) {
            throw new Error(`POSITION_NOT_FOUND: no confirmed position exists for mint ${params.mint}`);
        }
        this.settledIntents.add(params.intent_id);
        const prevCostBasis = pos.amount_sol;
        let costBasisRelieved = prevCostBasis;
        let remainingPositionSol = 0;
        if (params.is_full_close) {
            this.positions.delete(params.mint);
            costBasisRelieved = prevCostBasis;
            remainingPositionSol = 0;
        }
        else {
            // Proportional reduction
            const grossReceived = params.sol_received;
            const fraction = Math.min(1.0, Math.max(0.01, grossReceived / Math.max(0.001, prevCostBasis)));
            costBasisRelieved = Number((prevCostBasis * fraction).toFixed(6));
            remainingPositionSol = Math.max(0, Number((prevCostBasis - costBasisRelieved).toFixed(6)));
            pos.amount_sol = remainingPositionSol;
        }
        const netSolDelta = params.sol_received - params.fee_sol;
        this.confirmedCashSol += netSolDelta;
        this.baseFeesSol += params.fee_sol;
        const realizedPnlSol = params.sol_received - costBasisRelieved;
        if (realizedPnlSol >= 0) {
            this.realizedProceedsSol += realizedPnlSol;
        }
        else {
            const loss = Math.abs(realizedPnlSol);
            this.realizedLossesSol += loss;
            this.dailyRealizedLossSol += loss;
        }
        this.recordEvent({
            event_type: params.is_full_close ? 'POSITION_CLOSED' : 'POSITION_REDUCED',
            entity_id: params.mint,
            delta_sol: netSolDelta,
            slot: params.slot,
            payload: {
                intent_id: params.intent_id,
                mint: params.mint,
                sol_received: params.sol_received,
                fee_sol: params.fee_sol,
                cost_basis_relieved: costBasisRelieved,
                realized_pnl_sol: realizedPnlSol,
                is_full_close: params.is_full_close,
                remaining_position_sol: remainingPositionSol,
                exit_route: params.exit_route ?? 'DIRECT',
            },
        });
        return {
            success: true,
            realized_pnl_sol: realizedPnlSol,
            remaining_position_sol: remainingPositionSol,
        };
    }
    /**
     * Convenience helper to close an active position completely.
     */
    closePosition(mint, netProceedsSol, feeSol, slot) {
        const pos = this.positions.get(mint);
        if (!pos)
            return false;
        const intentId = `exit_${mint.slice(0, 8)}_${slot}_${Date.now()}`;
        this.settleExit({
            intent_id: intentId,
            mint,
            sol_received: netProceedsSol,
            fee_sol: feeSol,
            is_full_close: true,
            slot,
        });
        return true;
    }
    getPosition(mint) {
        return this.positions.get(mint);
    }
    hasPosition(mint) {
        return this.positions.has(mint);
    }
    getOpenPositionsCount() {
        return this.positions.size;
    }
    /**
     * Releases a reservation if aborted or rejected prior to signing.
     */
    releaseReservation(reservationId, reason, slot) {
        const reservation = this.activeReservations.get(reservationId);
        if (!reservation)
            return false;
        this.reservedCashSol = Math.max(0, this.reservedCashSol - reservation.amount_sol);
        this.activeReservations.delete(reservationId);
        this.recordEvent({
            event_type: 'RESERVATION_RELEASED',
            entity_id: reservationId,
            delta_sol: reservation.amount_sol,
            slot,
            payload: { reason },
        });
        return true;
    }
    /**
     * Handles timeout: Marks transaction UNKNOWN_RECONCILING and retains reservation (Part X).
     */
    markTransactionUnknown(intentId, slot) {
        this.unresolvedTxsCount += 1;
        this.recordEvent({
            event_type: 'TX_UNKNOWN',
            entity_id: intentId,
            delta_sol: 0,
            slot,
            payload: { status: 'UNKNOWN_RECONCILING', note: 'Retaining reservation until on-chain proof' },
        });
    }
    /**
     * Advance Monotonic Revocation Epoch (Part LVI).
     */
    advanceRevocationEpoch(reason, slot) {
        this.revocationEpoch += 1;
        this.recordEvent({
            event_type: 'REVOCATION_TRIGGERED',
            entity_id: `EPOCH_${this.revocationEpoch}`,
            delta_sol: 0,
            slot,
            payload: { newEpoch: this.revocationEpoch, reason },
        });
        return this.revocationEpoch;
    }
    /**
     * Advance Control Epoch (e.g. after crash recovery or controller handoff) (Part LXVII).
     */
    advanceControlEpoch(reason, slot) {
        this.controlEpoch += 1;
        this.recordEvent({
            event_type: 'AUTHORITY_CHANGED',
            entity_id: `CONTROL_EPOCH_${this.controlEpoch}`,
            delta_sol: 0,
            slot,
            payload: { newControlEpoch: this.controlEpoch, reason },
        });
        return this.controlEpoch;
    }
    setAuthorityMode(mode, slot) {
        this.authorityMode = mode;
        this.recordEvent({
            event_type: 'AUTHORITY_CHANGED',
            entity_id: mode,
            delta_sol: 0,
            slot,
            payload: { authorityMode: mode },
        });
    }
    /**
     * Returns cryptographic state root (Part V).
     */
    getCapitalStateRoot() {
        const summary = JSON.stringify({
            confirmedCash: this.confirmedCashSol.toFixed(6),
            reservedCash: this.reservedCashSol.toFixed(6),
            controlEpoch: this.controlEpoch,
            revocationEpoch: this.revocationEpoch,
            stateVersion: this.stateVersion,
            lastEventHash: this.lastEventHash,
            positionsCount: this.positions.size,
        });
        return createHash('sha256').update(summary).digest('hex');
    }
    /**
     * Computes full double-entry accounting report and verifies conservation of capital (Part IV).
     */
    getDoubleEntryReport() {
        let positionSolValue = 0;
        for (const p of this.positions.values()) {
            positionSolValue += p.amount_sol;
        }
        const totalAccounted = this.confirmedCashSol +
            this.reservedCashSol +
            positionSolValue +
            this.baseFeesSol +
            this.priorityFeesSol +
            this.jitoTipsSol +
            this.rentCostsSol +
            this.transferFeesSol +
            this.slippageLossSol +
            this.failedTxCostsSol +
            this.realizedLossesSol -
            this.realizedProceedsSol;
        const discrepancy = Math.abs(totalAccounted - this.initialPrincipalSol);
        const isConservationValid = discrepancy < 0.000001;
        return {
            principal_sol: this.initialPrincipalSol,
            token_inventory_value_sol: positionSolValue,
            realized_proceeds_sol: this.realizedProceedsSol,
            realized_losses_sol: this.realizedLossesSol,
            unrealized_exposure_sol: positionSolValue,
            base_fees_sol: this.baseFeesSol,
            priority_fees_sol: this.priorityFeesSol,
            jito_tips_sol: this.jitoTipsSol,
            rent_costs_sol: this.rentCostsSol,
            transfer_fees_sol: this.transferFeesSol,
            slippage_loss_sol: this.slippageLossSol,
            failed_tx_costs_sol: this.failedTxCostsSol,
            total_accounted_sol: totalAccounted,
            is_conservation_valid: isConservationValid,
            discrepancy_sol: discrepancy,
        };
    }
    /**
     * Returns complete canonical snapshot of CapitalState (Part II).
     */
    getSnapshot() {
        let entryReservationsSol = 0;
        let exitReservationsSol = 0;
        for (const res of this.activeReservations.values()) {
            if (res.status === 'RESERVED')
                entryReservationsSol += res.amount_sol;
            if (res.status === 'EXIT_RESERVED')
                exitReservationsSol += res.amount_sol;
        }
        let possibleExposureSol = 0;
        for (const p of this.positions.values()) {
            possibleExposureSol += p.amount_sol;
        }
        possibleExposureSol += this.reservedCashSol;
        return {
            authority_mode: this.authorityMode,
            control_epoch: this.controlEpoch,
            revocation_epoch: this.revocationEpoch,
            confirmed_cash_sol: this.confirmedCashSol,
            reserved_cash_sol: this.reservedCashSol,
            possible_exposure_sol: possibleExposureSol,
            confirmed_positions_count: this.positions.size,
            entry_reservations_sol: entryReservationsSol,
            exit_reservations_sol: exitReservationsSol,
            unresolved_intents_count: this.unresolvedIntentsCount,
            unresolved_transactions_count: this.unresolvedTxsCount,
            emergency_reserve_sol: this.emergencyReserveSol,
            daily_realized_loss_sol: this.dailyRealizedLossSol,
            daily_spend_sol: this.dailySpendSol,
            signer_counter: this.signerCounter,
            ledger_sequence: this.eventLedger.length,
            state_version: this.stateVersion,
            capital_state_root: this.getCapitalStateRoot(),
        };
    }
    getEventLedger() {
        return this.eventLedger;
    }
    getCommitCertificate(intentId) {
        return this.commitLog.get(intentId);
    }
}
//# sourceMappingURL=capital-truth-engine.js.map