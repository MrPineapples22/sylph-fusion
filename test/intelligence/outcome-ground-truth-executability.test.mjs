import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OutcomeGroundTruthLedger } from '../../src/intelligence/research/outcome-ground-truth.ts';

function checkpoint(chartReturnPct, executableDepthSol) {
  const ledger = new OutcomeGroundTruthLedger();
  ledger.registerCandidate({ mint: 'candidate', decision: 'WATCH', priceSol: 1, mcapSol: 100, liquiditySol: 10 });
  ledger.recordCheckpoint('candidate', {
    horizon: '+15s', priceSol: 1, chartReturnPct, executableDepthSol, independentActorsCount: 1,
  });
  return ledger.getRecord('candidate');
}

test('a large chart gain cannot make any non-executable simulation a success', () => {
  const record = checkpoint(10_000, 0.01);
  assert.equal(record.simulations.length, 5);
  assert.ok(record.simulations.every(s => !s.isExecutable && s.netExecutableReturnPct > 8));
  assert.equal(record.labels.priceSuccess, true);
  assert.equal(record.labels.executionSuccess, false);
  assert.equal(record.labels.strategySuccess, false);
});

test('a modeled executable winner still qualifies among non-executable alternatives', () => {
  const record = checkpoint(100, 0.5);
  assert.ok(record.simulations.some(s => s.isExecutable && s.netExecutableReturnPct > 8));
  assert.ok(record.simulations.some(s => !s.isExecutable));
  assert.equal(record.labels.executionSuccess, true);
});

test('executable simulations with losses do not qualify', () => {
  const record = checkpoint(-10, 100);
  assert.ok(record.simulations.every(s => s.isExecutable && s.netExecutableReturnPct < 0));
  assert.equal(record.labels.executionSuccess, false);
  assert.equal(record.labels.strategySuccess, false);
});

test('success retains the strict greater-than-eight-percent threshold', () => {
  // The smallest size at 100 SOL depth has modeled impact of 3 bps per leg.
  const boundary = checkpoint(9.06, 100);
  assert.equal(boundary.simulations[0].netExecutableReturnPct, 8);
  assert.equal(boundary.labels.executionSuccess, false);
  assert.equal(checkpoint(9.07, 100).labels.executionSuccess, true);
});

test('invalid numeric checkpoint values throw without changing an existing successful record', () => {
  const ledger = new OutcomeGroundTruthLedger();
  ledger.registerCandidate({ mint: 'candidate', decision: 'WATCH', priceSol: 1, mcapSol: 100, liquiditySol: 10 });
  const valid = { horizon: '+15s', priceSol: 1, chartReturnPct: 100, executableDepthSol: 100, independentActorsCount: 1 };
  ledger.recordCheckpoint('candidate', valid);
  const snapshot = structuredClone(ledger.getRecord('candidate'));
  for (const field of ['priceSol', 'chartReturnPct', 'executableDepthSol', 'independentActorsCount']) {
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '100']) {
      assert.throws(() => ledger.recordCheckpoint('candidate', { ...valid, [field]: value }), /INVALID_CHECKPOINT_VALUES/);
      assert.deepEqual(ledger.getRecord('candidate'), snapshot);
    }
  }
  for (const invalid of [{ priceSol: 0 }, { priceSol: -1 }, { executableDepthSol: -1 },
    { independentActorsCount: -1 }, { independentActorsCount: 0.5 }, { independentActorsCount: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => ledger.recordCheckpoint('candidate', { ...valid, ...invalid }), /INVALID_CHECKPOINT_VALUES/);
    assert.deepEqual(ledger.getRecord('candidate'), snapshot);
  }
});

test('finite SOL depth that overflows USD conversion is rejected', () => {
  assert.throws(() => checkpoint(100, Number.MAX_VALUE), /INVALID_SIMULATION_VALUES: USD depth overflow/);
});

test('zero depth remains a valid but non-executable heuristic observation', () => {
  const record = checkpoint(100, 0);
  assert.ok(record.simulations.every(s => !s.isExecutable));
  assert.equal(record.labels.executionSuccess, false);
});

test('invalid candidate values cannot replace a valid candidate', () => {
  const ledger = new OutcomeGroundTruthLedger();
  const valid = { mint: 'candidate', decision: 'WATCH', priceSol: 1, mcapSol: 100, liquiditySol: 10 };
  const record = ledger.registerCandidate(valid);
  for (const field of ['priceSol', 'mcapSol', 'liquiditySol']) {
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '100', -1]) {
      assert.throws(() => ledger.registerCandidate({ ...valid, [field]: value }), /INVALID_CANDIDATE_VALUES/);
      assert.equal(ledger.getRecord('candidate'), record);
    }
  }
  assert.throws(() => ledger.registerCandidate({ ...valid, priceSol: 0 }), /INVALID_CANDIDATE_VALUES/);
  assert.equal(ledger.registerCandidate({ ...valid, mcapSol: 0, liquiditySol: 0 }).initialLiquiditySol, 0);
});
