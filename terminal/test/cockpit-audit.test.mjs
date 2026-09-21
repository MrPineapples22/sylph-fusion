import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { evaluateRiskWaterfall } from '../src/risk-waterfall-eval.js';
import { generateArtifactManifest, sha256Hex } from '../src/artifact-manifest-eval.js';
import { evaluatePaperVsBaselineComparison, aggregateSessionStats } from '../src/paper-baseline-eval.js';
import { reducer, initialState } from '../src/engine.js';
import { evaluateModelDisagreement } from '../src/model-disagreement-eval.js';
import { evaluateDecisionProvenance } from '../src/decision-provenance-eval.js';

test('shadow telemetry never invents a score or latency from buyer counts', () => {
  const result = evaluateModelDisagreement({candidates:[{evaluationDisposition:'cleared', buyers:20}]});
  assert.equal(result.comparisons[0].mlScore, null);
  assert.equal(result.comparisons[0].latencyMs, null);
  assert.equal(result.comparisons[0].mlStatus, 'UNAVAILABLE');
});

test('provenance recomputes seal and detects changed features', () => {
  const payload = {microstructure:{buyerCount5m:5},curveState:{},transport:{}};
  const snapshot = {...payload, featureSealHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
  assert.equal(evaluateDecisionProvenance({snapshot}).seal.verified, true);
  snapshot.microstructure.buyerCount5m++;
  assert.equal(evaluateDecisionProvenance({snapshot}).seal.verified, false);
});

test('pending sell blocks entry capacity as well as pending buy', () => {
  for (const side of ['sell', 'buy']) {
    const result = evaluateRiskWaterfall({ cash:'1000000000', pending:{side, requested:'1000'} });
    assert.equal(result.canEnter, false);
    assert.equal(result.status, 'PENDING_LANE_BUSY');
    assert.equal(result.metrics.availableEntryBudgetSol, 0);
  }
});

test('missing baseline cannot invent trades, deltas or filter alpha', () => {
  const result = evaluatePaperVsBaselineComparison();
  assert.equal(result.baseline.tradeCount, 0);
  assert.equal(result.baselineAvailable, false);
  assert.equal(result.deltas, null);
  assert.equal(result.filterAlpha.netFilterAlphaSol, null);
});

test('censored marks never enter resolved realized return', () => {
  const result = aggregateSessionStats([{censored:true, netReturnLamports:'900000000', costBasisLamports:'1000'}]);
  assert.equal(result.censoredCount, 1);
  assert.equal(result.netReturnSol, 0);
  assert.equal(result.resolvedTrades, 0);
});

test('manifest hashes unicode and settlement values; missing bounds stay absent', () => {
  const value = 'SOL → π 🪙';
  assert.equal(sha256Hex(value), createHash('sha256').update(value).digest('hex'));
  const a = generateArtifactManifest({fills:[{id:'same', netLamports:'10'}]});
  const b = generateArtifactManifest({fills:[{id:'same', netLamports:'11'}]});
  assert.notEqual(a.cryptographicHashes.fillsChecksum, b.cryptographicHashes.fillsChecksum);
  assert.equal(a.sessionBoundaries.startSlot, null);
  assert.equal(a.sessionBoundaries.durationSeconds, null);
  assert.equal(a.integrityVerification.status, 'COMPUTED_UNVERIFIED');
});

test('paper pause preserves positions, cash and pending orders', () => {
  const state = initialState();
  state.running = true;
  state.positions = [{asset:'test', qty:1, cost:10, tiers:[]}];
  state.pending = [{id:'pending', side:'buy'}];
  const next = reducer(state, {type:'PAUSE', now:state.now});
  assert.equal(next.running, false);
  assert.equal(next.cash, state.cash);
  assert.deepEqual(next.positions, state.positions);
  assert.deepEqual(next.pending, state.pending);
});
