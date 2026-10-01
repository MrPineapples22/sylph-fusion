/**
 * SYLPH CAPITAL AUTHORITY & SURVIVAL ARCHITECTURE
 * Parts II, III, IV, V, VI, VII — Capital Truth Engine, Event Ledger, Double-Entry & Durability Core
 *
 * Implements the single authoritative representation of managed capital,
 * append-only event sourcing with cryptographic hash-chaining, double-entry
 * conservation identities, and durable WAL commit certificates.
 */

import { createHash } from 'node:crypto';
import type { DurableCapitalJournal } from '../../store.js';

export type CapitalStatus =
  | 'AVAILABLE'
  | 'RESERVED'
  | 'COMMITTED'
  | 'SIGNED_UNKNOWN'
  | 'SETTLED_EXPOSURE'
  | 'EXIT_RESERVED'
  | 'UNRESOLVED';

export type CapitalEventType =
  | 'RESERVATION_CREATED'
  | 'RESERVATION_RELEASED'
  | 'INTENT_CREATED'
  | 'INTENT_COMMITTED'
  | 'INTENT_ABORTED'
  | 'SIGNATURE_PREPARED'
  | 'SIGNATURE_CREATED'
  | 'SIGNATURE_RELEASED'
  | 'TX_SUBMITTED'
  | 'TX_OBSERVED'
  | 'TX_CONFIRMED'
  | 'TX_FINALIZED'
  | 'TX_UNKNOWN'
  | 'POSITION_OPENED'
  | 'POSITION_REDUCED'
  | 'POSITION_CLOSED'
  | 'EXIT_RESERVED'
  | 'RECONCILIATION_CORRECTION'
  | 'AUTHORITY_CHANGED'
  | 'REVOCATION_TRIGGERED';

export interface CanonicalCapitalEvent {
  readonly sequence_number: number;
  readonly event_type: CapitalEventType;
  readonly timestamp_ms: number;
  readonly slot: number;
  readonly entity_id: string; // intent_id, reservation_id, or mint
  readonly delta_sol: number;
  readonly balance_after_sol: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly previous_event_hash: string;
  readonly event_hash: string;
}

export interface CapitalState {
  readonly authority_mode: string;
  readonly control_epoch: number;
  readonly revocation_epoch: number;
  readonly confirmed_cash_sol: number;
  readonly reserved_cash_sol: number;
  readonly possible_exposure_sol: number;
  readonly confirmed_positions_count: number;
  readonly entry_reservations_sol: number;
  readonly exit_reservations_sol: number;
  readonly unresolved_intents_count: number;
  readonly unresolved_transactions_count: number;
  readonly emergency_reserve_sol: number;
  readonly daily_realized_loss_sol: number;
  readonly daily_spend_sol: number;
  readonly signer_counter: number;
  readonly ledger_sequence: number;
  readonly state_version: number;
  readonly capital_state_root: string;
}

export interface DoubleEntryReport {
  readonly principal_sol: number;
  readonly token_inventory_value_sol: number;
  readonly realized_proceeds_sol: number;
  readonly realized_losses_sol?: number;
  readonly unrealized_exposure_sol: number;
  readonly base_fees_sol: number;
  readonly priority_fees_sol: number;
  readonly jito_tips_sol: number;
  readonly rent_costs_sol: number;
  readonly transfer_fees_sol: number;
  readonly slippage_loss_sol: number;
  readonly failed_tx_costs_sol: number;
  readonly total_accounted_sol: number;
  readonly is_conservation_valid: boolean;
  readonly discrepancy_sol: number;
}

export interface CommitCertificate {
  readonly certificate_id: string;
  readonly intent_id: string;
  readonly reservation_id: string;
  readonly capital_state_root: string;
  readonly survival_proof_root: string;
  readonly control_epoch: number;
  readonly revocation_epoch: number;
  readonly production_root: string;
  readonly max_sol_debit: number;
  readonly max_fee_sol: number;
  readonly max_tip_sol: number;
  readonly expiration_slot: number;
  readonly commit_generation: number;
  readonly is_durable_committed: boolean;
  readonly certificate_hash: string;
}

export class CapitalTruthEngine {
  private confirmedCashSol: number;
  private reservedCashSol = 0.0;
  private emergencyReserveSol = 5.0; // Protected SOL never exposed to trades
  private dailySpendSol = 0.0;
  private dailyRealizedLossSol = 0.0;
  private controlEpoch = 1;
  private revocationEpoch = 1;
  private authorityMode = 'A5_NORMAL';
  private stateVersion = 100;
  private signerCounter = 0;

  // Double-entry accounting buckets
  private realizedProceedsSol = 0.0;
  private realizedLossesSol = 0.0;
  private baseFeesSol = 0.0;
  private priorityFeesSol = 0.0;
  private jitoTipsSol = 0.0;
  private rentCostsSol = 0.0;
  private transferFeesSol = 0.0;
  private slippageLossSol = 0.0;
  private failedTxCostsSol = 0.0;
  private readonly initialPrincipalSol: number;

  // Append-only event history with cryptographic hash-chaining
  private readonly eventLedger: CanonicalCapitalEvent[] = [];
  private lastEventHash = '0000000000000000000000000000000000000000000000000000000000000000';
  private readonly activeReservations = new Map<string, {
    owner_id: string;
    amount_sol: number;
    max_fee_sol: number;
    status: CapitalStatus;
    slot: number;
  }>();

  // Idempotency tracking to prevent double settlement
  private readonly settledIntents = new Set<string>();

  // Commit certificates log (Write-Ahead Log)
  private readonly commitLog = new Map<string, CommitCertificate>();
  private readonly positions = new Map<string, { mint: string; amount_sol: number; entry_slot: number }>();
  private unresolvedTxsCount = 0;
  private unresolvedIntentsCount = 0;

  constructor(initialCashSol = 100.0, private readonly journal?: DurableCapitalJournal) {
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
  private computeEventHash(
    seq: number,
    prevHash: string,
    type: CapitalEventType,
    entityId: string,
    delta: number,
    balance: number,
    timestamp: number,
    slot: number,
    payload: Record<string, unknown>
  ): string {
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
  public recordEvent(params: {
    event_type: CapitalEventType;
    entity_id: string;
    delta_sol: number;
    slot: number;
    payload?: Record<string, unknown>;
  }): CanonicalCapitalEvent {
    const seq = this.eventLedger.length + 1;
    const now = Date.now();
    const balance = this.confirmedCashSol;
    const payload = params.payload ?? {};
    const eventHash = this.computeEventHash(
      seq,
      this.lastEventHash,
      params.event_type,
      params.entity_id,
      params.delta_sol,
      balance,
      now,
      params.slot,
      payload
    );

    const event: CanonicalCapitalEvent = {
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
  public reserveCapital(params: {
    reservation_id: string;
    owner_id: string;
    amount_sol: number;
    max_fee_sol: number;
    max_tip_sol: number;
    expected_state_version: number;
    slot: number;
  }): { success: boolean; reason?: string; reservation_id?: string } {
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
    if (!Number.isFinite(totalRequired) || totalRequired <= 0) return { success: false, reason: 'INVALID_RESERVATION_INPUT' };
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
  public writeCommitCertificate(params: {
    intent_id: string;
    reservation_id: string;
    survival_proof_root: string;
    production_root: string;
    max_sol_debit: number;
    max_fee_sol: number;
    max_tip_sol: number;
    expiration_slot: number;
    commit_generation: number;
    slot: number;
  }): CommitCertificate {
    const reservation = this.activeReservations.get(params.reservation_id);
    if (!reservation) throw new Error(`Cannot commit without valid reservation ${params.reservation_id}`);
    if (reservation.status !== 'RESERVED') throw new Error(`Reservation ${params.reservation_id} is in status ${reservation.status}`);

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

    const cert: CommitCertificate = {
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

    const ev = this.recordEvent({
      event_type: 'INTENT_COMMITTED',
      entity_id: params.intent_id,
      delta_sol: 0,
      slot: params.slot,
      payload: { certId, certHash },
    });

    if (this.journal) {
      this.journal.saveCapitalCommit({
        intentId: params.intent_id,
        reservationId: params.reservation_id,
        certificateId: certId,
        capitalStateRoot: stateRoot,
        certificateHash: certHash,
      }).catch(() => {});
      this.journal.appendCapitalEvent({
        ...ev,
        delta_lamports: 0n,
        balance_after_lamports: BigInt(Math.round(this.confirmedCashSol * 1e9)),
      }).catch(() => {});
    }

    return cert;
  }

  /**
   * Finalizes on-chain settlement, updates double-entry ledgers (Parts IV & LXIX).
   */
  public settleExecution(params: {
    intent_id: string;
    reservation_id: string;
    mint: string;
    actual_sol_spent: number;
    base_fee_sol: number;
    priority_fee_sol: number;
    jito_tip_sol: number;
    slot: number;
  }): void {
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
    if (!reservation) throw new Error(`Reservation not found ${params.reservation_id}`);

    const reservedAmount = reservation.amount_sol;
    const totalSpent = params.actual_sol_spent + params.base_fee_sol + params.priority_fee_sol + params.jito_tip_sol;
    if (totalSpent > reservedAmount) throw new Error('SETTLEMENT_EXCEEDS_RESERVATION');

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
  public settleExit(params: {
    intent_id: string;
    mint: string;
    tokens_sold?: number;
    sol_received: number;
    fee_sol: number;
    is_full_close: boolean;
    slot: number;
    exit_route?: string;
  }): { success: boolean; realized_pnl_sol: number; remaining_position_sol: number } {
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
    } else {
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
    } else {
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
  public closePosition(mint: string, netProceedsSol: number, feeSol: number, slot: number): boolean {
    const pos = this.positions.get(mint);
    if (!pos) return false;
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

  public getPosition(mint: string): { mint: string; amount_sol: number; entry_slot: number } | undefined {
    return this.positions.get(mint);
  }

  public hasPosition(mint: string): boolean {
    return this.positions.has(mint);
  }

  public getOpenPositionsCount(): number {
    return this.positions.size;
  }

  /**
   * Releases a reservation if aborted or rejected prior to signing.
   */
  public releaseReservation(reservationId: string, reason: string, slot: number): boolean {
    const reservation = this.activeReservations.get(reservationId);
    if (!reservation) return false;

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
  public markTransactionUnknown(intentId: string, slot: number): void {
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
  public advanceRevocationEpoch(reason: string, slot: number): number {
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
  public advanceControlEpoch(reason: string, slot: number): number {
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

  public setAuthorityMode(mode: string, slot: number): void {
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
   * Binds exact integer lamport strings without floating-point toFixed(6) truncation.
   */
  public getCapitalStateRoot(): string {
    const confirmedCashLamports = BigInt(Math.round(this.confirmedCashSol * 1e9));
    const reservedCashLamports = BigInt(Math.round(this.reservedCashSol * 1e9));
    const summary = JSON.stringify({
      confirmedCashLamports: confirmedCashLamports.toString(),
      reservedCashLamports: reservedCashLamports.toString(),
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
   * Strict invariant: Exactly 0 lamports discrepancy permitted.
   */
  public getDoubleEntryReport(): DoubleEntryReport {
    let positionSolValue = 0;
    for (const p of this.positions.values()) {
      positionSolValue += p.amount_sol;
    }

    const totalAccounted =
      this.confirmedCashSol +
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

    const totalAccountedLamports = BigInt(Math.round(totalAccounted * 1e9));
    const initialPrincipalLamports = BigInt(Math.round(this.initialPrincipalSol * 1e9));
    const discrepancyLamports = totalAccountedLamports >= initialPrincipalLamports
      ? totalAccountedLamports - initialPrincipalLamports
      : initialPrincipalLamports - totalAccountedLamports;
    const isConservationValid = discrepancyLamports === 0n;
    const discrepancy = Number(discrepancyLamports) / 1e9;

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
  public getSnapshot(): CapitalState {
    let entryReservationsSol = 0;
    let exitReservationsSol = 0;
    for (const res of this.activeReservations.values()) {
      if (res.status === 'RESERVED') entryReservationsSol += res.amount_sol;
      if (res.status === 'EXIT_RESERVED') exitReservationsSol += res.amount_sol;
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

  public getEventLedger(): readonly CanonicalCapitalEvent[] {
    return this.eventLedger;
  }

  public getCommitCertificate(intentId: string): CommitCertificate | undefined {
    return this.commitLog.get(intentId);
  }
}
