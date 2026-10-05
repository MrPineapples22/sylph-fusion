import test from 'node:test';
import assert from 'node:assert/strict';
import { CrashOracleHarness } from '../../dist/platform/testing/crash-oracle.js';

test('CRASH ORACLE: Arms and disarms fault injection points', () => {
  const harness = new CrashOracleHarness();
  assert.equal(harness.getActiveFault(), undefined);

  harness.armFaultInjection('BEFORE_JOURNAL_COMMIT');
  assert.equal(harness.getActiveFault(), 'BEFORE_JOURNAL_COMMIT');

  harness.clearFaultInjection();
  assert.equal(harness.getActiveFault(), undefined);
});

test('CRASH ORACLE: Simulates crash and recovery across all 11 durable boundaries', () => {
  const harness = new CrashOracleHarness();

  const baseState = {
    economicFactId: 'fact_oracle_tx_998877',
    executionGenerationId: 'gen_oracle_active_01',
    reservedCashLamports: 10_000_000n,
    unknownCashLamports: 0n,
    isSigned: false,
    isSubmitted: false,
    terminalityConclusion: 'NONE',
    stateRoot: 'state_root_oracle_hash_001',
    journalCommitted: true,
    reservationCommitted: true,
    settlementCommitted: false,
  };

  const boundaries = [
    'BEFORE_JOURNAL_COMMIT',
    'AFTER_JOURNAL_COMMIT',
    'BEFORE_RESERVATION_COMMIT',
    'AFTER_RESERVATION_COMMIT',
    'DURING_SIGNER_REQUEST',
    'AFTER_SIGNER_SUCCESS_BEFORE_RESPONSE',
    'DURING_SUBMIT',
    'AFTER_NETWORK_ACCEPTS_BEFORE_ACK',
    'AFTER_LANDING_OBSERVATION',
    'AFTER_FINALITY',
    'DURING_SETTLEMENT_COMMIT',
  ];

  for (const boundary of boundaries) {
    const res = harness.simulateCrashAndRecover(boundary, baseState);
    assert.equal(res.passed, true, `Boundary ${boundary} should pass assertions`);
    assert.equal(res.violations.length, 0);
    assert.equal(res.faultPoint, boundary);
    assert.match(res.recoveryEvidenceRoot, /^ev_crash_/);
    assert.equal(res.recoveredState.economicFactId, baseState.economicFactId);
    assert.equal(res.recoveredState.executionGenerationId, baseState.executionGenerationId);
  }
});

test('CRASH ORACLE: In-flight crash during submit enforces capital encumbrance', () => {
  const harness = new CrashOracleHarness();

  // Valid state with encumbered capital
  const validState = {
    economicFactId: 'fact_oracle_tx_leak_test',
    executionGenerationId: 'gen_oracle_leak_01',
    reservedCashLamports: 5_000_000n,
    unknownCashLamports: 0n,
    isSigned: true,
    isSubmitted: true,
    terminalityConclusion: 'NONE',
    stateRoot: 'root_valid_01',
    journalCommitted: true,
    reservationCommitted: true,
    settlementCommitted: false,
  };

  const validRes = harness.simulateCrashAndRecover('DURING_SUBMIT', validState);
  assert.equal(validRes.passed, true);
  assert.equal(validRes.recoveredState.terminalityConclusion, 'UNKNOWN');

  // Invalid state: zero encumbered capital during submit crash -> CAPITAL_LEAK violation
  const leakyState = {
    ...validState,
    reservedCashLamports: 0n,
    unknownCashLamports: 0n,
  };

  const leakyRes = harness.simulateCrashAndRecover('DURING_SUBMIT', leakyState);
  assert.equal(leakyRes.passed, false);
  assert.ok(leakyRes.violations.some((v) => v.includes('CAPITAL_LEAK')));
});

test('CRASH ORACLE: Recovery after signer success preserves signed state', () => {
  const harness = new CrashOracleHarness();

  const state = {
    economicFactId: 'fact_oracle_tx_sign_test',
    executionGenerationId: 'gen_oracle_sign_01',
    reservedCashLamports: 5_000_000n,
    unknownCashLamports: 0n,
    isSigned: false, // Pre-crash signer in progress
    isSubmitted: false,
    terminalityConclusion: 'NONE',
    stateRoot: 'root_sign_01',
    journalCommitted: true,
    reservationCommitted: true,
    settlementCommitted: false,
  };

  const res = harness.simulateCrashAndRecover('AFTER_SIGNER_SUCCESS_BEFORE_RESPONSE', state);
  assert.equal(res.passed, true);
  assert.equal(res.recoveredState.isSigned, true);
});

test('CRASH ORACLE: Incomplete settlement crash resets settlement committed flag', () => {
  const harness = new CrashOracleHarness();

  const state = {
    economicFactId: 'fact_oracle_tx_settle_test',
    executionGenerationId: 'gen_oracle_settle_01',
    reservedCashLamports: 5_000_000n,
    unknownCashLamports: 0n,
    isSigned: true,
    isSubmitted: true,
    terminalityConclusion: 'LANDED_SUCCESS',
    stateRoot: 'root_settle_01',
    journalCommitted: true,
    reservationCommitted: true,
    settlementCommitted: true, // Pre-crash in mid-settlement
  };

  const res = harness.simulateCrashAndRecover('DURING_SETTLEMENT_COMMIT', state);
  assert.equal(res.passed, true);
  assert.equal(res.recoveredState.settlementCommitted, false);
});
