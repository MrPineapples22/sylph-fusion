import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EconomicFlightRecorder,
  SQLiteExecutionAttemptStore,
} from '../../dist/intelligence/execution-adaptation/index.js';

test('ECONOMIC FLIGHT RECORDER: records candidate at discovery before knowing outcome', () => {
  const store = new SQLiteExecutionAttemptStore(':memory:');
  const recorder = new EconomicFlightRecorder(store);

  const discovery = recorder.recordDiscovery({
    economicFactId: 'fact_flt_001',
    mint: '7XomEJBtb1EiF4Z8ZVzspCKFW2UuaRkaiq3AJJCFpump',
    creator: 'CreatorWalletAddress123',
    protocol: 'PUMP_FUN',
    regime: 'HIGH_VOLATILITY',
  });

  assert.equal(discovery.economicFactId, 'fact_flt_001');
  assert.equal(discovery.stage, 'DISCOVERED');
  assert.equal(discovery.revision, 0);
  assert.equal(discovery.terminalOutcome, 'NONE');
  assert.equal(typeof discovery.recordHash, 'string');
  assert.equal(discovery.recordHash.length, 64);
  assert.equal(store.count(), 1);
});

test('ECONOMIC FLIGHT RECORDER: advances lifecycle sequentially with immutable revision increments', () => {
  const store = new SQLiteExecutionAttemptStore(':memory:');
  const recorder = new EconomicFlightRecorder(store);

  // 1. Discovery
  const r0 = recorder.recordDiscovery({
    economicFactId: 'fact_flt_002',
    mint: 'MintTokenABC',
    creator: 'CreatorABC',
  });
  assert.equal(r0.stage, 'DISCOVERED');

  // 2. Filter Evaluated
  const r1 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'FILTER_EVALUATED', {
    strategyId: 'MOMENTUM_FILTER_V1',
  });
  assert.equal(r1.stage, 'FILTER_EVALUATED');
  assert.equal(r1.revision, 1);

  // 3. Decision Created
  const r2 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'DECISION_CREATED', {
    decisionPrice: 0.00015,
    decisionAt: new Date().toISOString(),
  });
  assert.equal(r2.stage, 'DECISION_CREATED');
  assert.equal(r2.revision, 2);
  assert.equal(r2.decisionPrice, 0.00015);

  // 4. Quote Captured
  const r3 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'QUOTE_CAPTURED', {
    quotePrice: 0.000152,
    quotedOutputRaw: 10_000_000n,
    requestedInputLamports: 1_520_000_000n,
    quotedAt: new Date().toISOString(),
  });
  assert.equal(r3.stage, 'QUOTE_CAPTURED');
  assert.equal(r3.revision, 3);
  assert.equal(r3.quotedOutputRaw, 10_000_000n);

  // 5. Build Started
  const r4 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'BUILD_STARTED', {});
  assert.equal(r4.stage, 'BUILD_STARTED');

  // 6. Build Completed
  const r5 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'BUILD_COMPLETED', {
    builtAt: new Date().toISOString(),
    baseFeeLamports: 5_000n,
    priorityFeeLamports: 50_000n,
    jitoTipLamports: 100_000n,
  });
  assert.equal(r5.stage, 'BUILD_COMPLETED');
  assert.equal(r5.revision, 5);

  // 7. Simulated
  const r6 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'SIMULATED', {});
  assert.equal(r6.stage, 'SIMULATED');

  // 8. Authorized
  const r7 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'AUTHORIZED', {
    releaseRoot: 'RELEASE_ROOT_CERTIFIED_001',
  });
  assert.equal(r7.stage, 'AUTHORIZED');
  assert.equal(r7.revision, 7);

  // 9. Signed
  const r8 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'SIGNED', { signedAt: new Date().toISOString() });
  assert.equal(r8.stage, 'SIGNED');

  // 10. Submitted
  const r9 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'SUBMITTED', {
    transport: 'JITO_BUNDLE',
    submittedAt: new Date().toISOString(),
  });
  assert.equal(r9.stage, 'SUBMITTED');
  assert.equal(r9.revision, 9);
  assert.equal(r9.transport, 'JITO_BUNDLE');

  // 11. Acknowledged
  const r10 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'ACKNOWLEDGED', {});
  assert.equal(r10.stage, 'ACKNOWLEDGED');

  // 12. Landed Success
  const r11 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'LANDED_SUCCESS', {
    landingPrice: 0.000154,
    actualOutputRaw: 9_980_000n,
    realizedSlippageBps: 20,
    terminalOutcome: 'LANDED_SUCCESS',
    landedAt: new Date().toISOString(),
  });
  assert.equal(r11.stage, 'LANDED_SUCCESS');
  assert.equal(r11.terminalOutcome, 'LANDED_SUCCESS');
  assert.equal(r11.realizedSlippageBps, 20);

  // 13. Finalized
  const r12 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'FINALIZED', { finalizedAt: new Date().toISOString() });
  assert.equal(r12.stage, 'FINALIZED');

  // 14. Settled
  const r13 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'SETTLED', {
    exitPrice: 0.000185,
    grossPnLLamports: 310_000_000n,
    netPnLLamports: 155_000_000n,
    settledAt: new Date().toISOString(),
  });
  assert.equal(r13.stage, 'SETTLED');
  assert.equal(r13.grossPnLLamports, 310_000_000n);
  assert.equal(r13.netPnLLamports, 155_000_000n);

  // 15. Outcome Mature
  const r14 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'OUTCOME_MATURE', {
    mfePct: 22.5,
    maePct: -1.2,
    outcomeMaturedAt: new Date().toISOString(),
  });
  assert.equal(r14.stage, 'OUTCOME_MATURE');
  assert.equal(r14.mfePct, 22.5);
  assert.equal(r14.maePct, -1.2);

  // Verify all 10 revisions are stored
  const allRevisions = store.getRevisions('fact_flt_002', r0.executionGenerationId);
  assert.equal(allRevisions.length, 15);
  assert.equal(allRevisions[0].stage, 'DISCOVERED');
  assert.equal(allRevisions[14].stage, 'OUTCOME_MATURE');

  // Verify latest query
  const latest = store.getLatest('fact_flt_002', r0.executionGenerationId);
  assert.equal(latest.stage, 'OUTCOME_MATURE');
  assert.equal(latest.revision, 14);
});

test('ECONOMIC FLIGHT RECORDER: rejects forged hashes, skipped stages, and SQL mutation', () => {
  const store = new SQLiteExecutionAttemptStore(':memory:');
  const recorder = new EconomicFlightRecorder(store);
  const initial = recorder.recordDiscovery({ economicFactId: 'fact_flt_integrity', mint: 'mint', creator: 'creator' });
  assert.throws(() => store.append({ ...initial, regime: 'forged' }), /RECORD_HASH_MISMATCH/);
  assert.throws(() => recorder.advanceLifecycle('fact_flt_integrity', initial.executionGenerationId, 'DECISION_CREATED', {}), /ILLEGAL_STAGE_TRANSITION/);
  assert.throws(() => store.db.exec("UPDATE flight_records SET stage = 'SETTLED'"), /FLIGHT_RECORDER_UPDATE_FORBIDDEN/);
  assert.throws(() => store.db.exec('DELETE FROM flight_records'), /FLIGHT_RECORDER_DELETE_FORBIDDEN/);
  assert.equal(store.getLatest('fact_flt_integrity', initial.executionGenerationId).stage, 'DISCOVERED');
  store.close();
});

test('ECONOMIC FLIGHT RECORDER: prevents overwrite of existing revision (append-only invariant)', () => {
  const store = new SQLiteExecutionAttemptStore(':memory:');
  const recorder = new EconomicFlightRecorder(store);

  const initial = recorder.recordDiscovery({
    economicFactId: 'fact_flt_003',
    mint: 'MintTokenXYZ',
    creator: 'CreatorXYZ',
  });

  // Attempting to append the identical revision directly must throw
  assert.throws(() => {
    store.append(initial);
  }, /FLIGHT_RECORDER_IMMUTABLE_OVERWRITE_BLOCKED/);
});

test('ECONOMIC FLIGHT RECORDER: file-backed revisions survive a close and reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sylph-flight-recorder-'));
  const path = join(directory, 'attempts.sqlite');
  try {
    const firstStore = new SQLiteExecutionAttemptStore(path);
    const recorder = new EconomicFlightRecorder(firstStore);
    const initial = recorder.recordDiscovery({ economicFactId: 'fact_flt_restart', mint: 'mint', creator: 'creator' });
    recorder.advanceLifecycle('fact_flt_restart', initial.executionGenerationId, 'FILTER_EVALUATED', {});
    firstStore.close();

    const reopened = new SQLiteExecutionAttemptStore(path);
    assert.equal(reopened.count(), 2);
    assert.equal(reopened.getLatest('fact_flt_restart', initial.executionGenerationId).stage, 'FILTER_EVALUATED');
    assert.throws(() => reopened.db.exec('DELETE FROM flight_records'), /FLIGHT_RECORDER_DELETE_FORBIDDEN/);
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
