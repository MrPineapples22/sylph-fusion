import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ExecutionPermitEngine } from '../../dist/intelligence/execution/execution-permit.js';

const issue = (engine, mint = 'MintHardening111') => {
  const reservation = engine.createRiskReservation(mint, 1, 10_000);
  return engine.issuePermit({ mint, decisionId: 'decision', policyHash: 'policy-record', evidenceHash: 'evidence-record', snapshotSlot: 1, stateEpoch: 1, maxNotionalSol: 1, riskReservationId: reservation.reservationId });
};

test('permit engine fails closed on invalid sequencing, malformed revalidation, and mutation', () => {
  const engine = new ExecutionPermitEngine();
  const permit = issue(engine);
  assert.deepEqual(permit.allowedExecutionModes, ['SIMULATION', 'SHADOW']);
  assert.throws(() => engine.commitExecution(permit.permitId), /TOCTOU_REVALIDATION_REQUIRED/);
  assert.throws(() => { permit.isConsumed = true; }, /read only|Cannot assign/);
  engine.prepareExecution(permit.permitId);
  assert.equal(engine.revalidateExecution(permit.permitId, NaN, 0).stage, 'ABORTED');
  assert.throws(() => engine.commitExecution(permit.permitId), /TOCTOU_REVALIDATION_REQUIRED/);
});

test('permit issuance binds reservation mint and notional', () => {
  const engine = new ExecutionPermitEngine();
  const reservation = engine.createRiskReservation('MintA', 1);
  const base = { decisionId: 'd', policyHash: 'p', evidenceHash: 'e', snapshotSlot: 1, stateEpoch: 1, riskReservationId: reservation.reservationId };
  assert.throws(() => engine.issuePermit({ ...base, mint: 'MintB', maxNotionalSol: 1 }), /mint mismatch/);
  assert.throws(() => engine.issuePermit({ ...base, mint: 'MintA', maxNotionalSol: 2 }), /exceeds reservation/);
  assert.throws(() => engine.createRiskReservation('MintA', Number.NaN), /finite and positive/);
});
