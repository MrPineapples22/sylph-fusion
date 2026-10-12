import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CapitalTruthEngine } from '../../dist/intelligence/capital/capital-truth-engine.js';
import { CapitalKernel } from '../../dist/intelligence/capital/capital-kernel.js';

describe('REQ-013: Capital Truth Active Reservation Derivation & Zero Fabrication', () => {
  it('correctly reports true for active reservations and false for unreserved or unknown IDs', () => {
    const truth = new CapitalTruthEngine(10.0);
    const kernel = new CapitalKernel({ initialAuthority: 'A5_NORMAL' });

    const snap = truth.getSnapshot();
    const reservationId = 'res_test_active_100';
    assert.equal(truth.hasActiveReservation(reservationId), false);

    // Create valid reservation
    const resResult = truth.reserveCapital({
      reservation_id: reservationId,
      owner_id: 'intent_100',
      amount_sol: 1.0,
      max_fee_sol: 0.005,
      max_tip_sol: 0.001,
      expected_state_version: snap.state_version,
      slot: 100,
    });
    assert.equal(resResult.success, true);
    assert.equal(truth.hasActiveReservation(reservationId), true);

    // Verify kernel authorizes when has_active_reservation matches truth engine
    const verification = kernel.verifyCapitalAction({
      action_type: 'INCREASE_EXPOSURE',
      proposed_delta_sol: 1.0,
      confirmed_cash_sol: truth.getSnapshot().confirmed_cash_sol,
      reserved_cash_sol: truth.getSnapshot().reserved_cash_sol,
      emergency_reserve_sol: truth.getSnapshot().emergency_reserve_sol,
      current_open_positions_count: 0,
      unresolved_intents_count: 0,
      unknown_capital_sol: 0.0,
      has_active_reservation: truth.hasActiveReservation(reservationId),
      has_commit_certificate: true,
      has_valid_survival_certificate: true,
      request_control_epoch: 1,
      active_control_epoch: 1,
      request_revocation_epoch: 1,
      active_revocation_epoch: 1,
      is_proof_revoked: false,
      is_lease_valid: true,
    });

    assert.equal(verification.is_authorized, true);

    // Release reservation
    truth.releaseReservation(reservationId, 'Test complete', 101);
    assert.equal(truth.hasActiveReservation(reservationId), false);

    // Kernel must reject when reservation is inactive
    const verificationPostRelease = kernel.verifyCapitalAction({
      action_type: 'INCREASE_EXPOSURE',
      proposed_delta_sol: 1.0,
      confirmed_cash_sol: truth.getSnapshot().confirmed_cash_sol,
      reserved_cash_sol: truth.getSnapshot().reserved_cash_sol,
      emergency_reserve_sol: truth.getSnapshot().emergency_reserve_sol,
      current_open_positions_count: 0,
      unresolved_intents_count: 0,
      unknown_capital_sol: 0.0,
      has_active_reservation: truth.hasActiveReservation(reservationId),
      has_commit_certificate: true,
      has_valid_survival_certificate: true,
      request_control_epoch: 1,
      active_control_epoch: 1,
      request_revocation_epoch: 1,
      active_revocation_epoch: 1,
      is_proof_revoked: false,
      is_lease_valid: true,
    });

    assert.equal(verificationPostRelease.is_authorized, false);
    assert.equal(verificationPostRelease.violated_invariants[0].invariant_id, 'INV_2_RESERVATION_EXISTS');
  });
});
