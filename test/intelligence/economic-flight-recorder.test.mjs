import test from 'node:test';
import assert from 'node:assert/strict';
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

  // 5. Build Completed
  const r4 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'BUILD_COMPLETED', {
    builtAt: new Date().toISOString(),
    baseFeeLamports: 5_000n,
    priorityFeeLamports: 50_000n,
    jitoTipLamports: 100_000n,
  });
  assert.equal(r4.stage, 'BUILD_COMPLETED');
  assert.equal(r4.revision, 4);

  // 6. Authorized
  const r5 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'AUTHORIZED', {
    releaseRoot: 'RELEASE_ROOT_CERTIFIED_001',
  });
  assert.equal(r5.stage, 'AUTHORIZED');
  assert.equal(r5.revision, 5);

  // 7. Submitted
  const r6 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'SUBMITTED', {
    transport: 'JITO_BUNDLE',
    submittedAt: new Date().toISOString(),
  });
  assert.equal(r6.stage, 'SUBMITTED');
  assert.equal(r6.revision, 6);
  assert.equal(r6.transport, 'JITO_BUNDLE');

  // 8. Landed Success
  const r7 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'LANDED_SUCCESS', {
    landingPrice: 0.000154,
    actualOutputRaw: 9_980_000n,
    realizedSlippageBps: 20,
    terminalOutcome: 'LANDED_SUCCESS',
    landedAt: new Date().toISOString(),
  });
  assert.equal(r7.stage, 'LANDED_SUCCESS');
  assert.equal(r7.terminalOutcome, 'LANDED_SUCCESS');
  assert.equal(r7.realizedSlippageBps, 20);

  // 9. Settled
  const r8 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'SETTLED', {
    exitPrice: 0.000185,
    grossPnLLamports: 310_000_000n,
    netPnLLamports: 155_000_000n,
    settledAt: new Date().toISOString(),
  });
  assert.equal(r8.stage, 'SETTLED');
  assert.equal(r8.grossPnLLamports, 310_000_000n);
  assert.equal(r8.netPnLLamports, 155_000_000n);

  // 10. Outcome Mature
  const r9 = recorder.advanceLifecycle('fact_flt_002', r0.executionGenerationId, 'OUTCOME_MATURE', {
    mfePct: 22.5,
    maePct: -1.2,
    outcomeMaturedAt: new Date().toISOString(),
  });
  assert.equal(r9.stage, 'OUTCOME_MATURE');
  assert.equal(r9.mfePct, 22.5);
  assert.equal(r9.maePct, -1.2);

  // Verify all 10 revisions are stored
  const allRevisions = store.getRevisions('fact_flt_002', r0.executionGenerationId);
  assert.equal(allRevisions.length, 10);
  assert.equal(allRevisions[0].stage, 'DISCOVERED');
  assert.equal(allRevisions[9].stage, 'OUTCOME_MATURE');

  // Verify latest query
  const latest = store.getLatest('fact_flt_002', r0.executionGenerationId);
  assert.equal(latest.stage, 'OUTCOME_MATURE');
  assert.equal(latest.revision, 9);
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
