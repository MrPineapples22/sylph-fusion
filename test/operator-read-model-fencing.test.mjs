import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OperatorReadModel, PROJECTION_STALE_FENCE_MS} from '../dist/operator-read-model.js';
import {createProjectionGuard, workspaceReducer, initialWorkspace} from '../terminal/src/operator-runtime.js';

const input = (overrides = {}) => ({
  now: 10000,
  discovery: {feedStale: false, rows: [], positions: []},
  gateway: {mode: 'paper', cashUsd: 10000, reservedCashUsd: 0, inFlightOrdersCount: 0},
  health: {providers: {}},
  lifecycle: 'CONNECTING',
  ...overrides,
});

// --- Phase 0: Operator Read Model Enhancements ---

test('projection includes staleFenceMs, reconciliationDigest, and capabilityBlockers', () => {
  const p = new OperatorReadModel().project(input());
  assert.equal(p.staleFenceMs, PROJECTION_STALE_FENCE_MS);
  assert.equal(typeof p.reconciliationDigest, 'string');
  assert.ok(p.reconciliationDigest.length > 0, 'reconciliationDigest should be non-empty');
  assert.ok(p.capabilityBlockers, 'capabilityBlockers should exist');
  assert.ok(Array.isArray(p.capabilityBlockers.open), 'open blocker chain should be array');
  assert.ok(Array.isArray(p.capabilityBlockers.close), 'close blocker chain should be array');
});

test('reconciliationDigest is stable for identical state and changes when state changes', () => {
  const model = new OperatorReadModel();
  const a = model.project(input({now: 10000}));
  const b = model.project(input({now: 11000}));
  assert.equal(a.reconciliationDigest, b.reconciliationDigest, 'digest should be stable for same positions+capital');
  const c = model.project(input({now: 12000, gateway: {mode: 'paper', cashUsd: 5000, reservedCashUsd: 0, inFlightOrdersCount: 0}}));
  assert.notEqual(a.reconciliationDigest, c.reconciliationDigest, 'digest should change when capital changes');
});

test('validUntil uses staleFenceMs from PROJECTION_STALE_FENCE_MS', () => {
  const p = new OperatorReadModel().project(input({now: 50000}));
  assert.equal(p.validUntil, 50000 + PROJECTION_STALE_FENCE_MS);
});

test('envelopes include blockerChain for each action', () => {
  const p = new OperatorReadModel().project(input());
  for (const action of ['open', 'increase', 'reduce', 'close', 'reconcile']) {
    const env = p.envelopes[action];
    assert.ok(Array.isArray(env.blockerChain), `${action} envelope should have blockerChain`);
    assert.ok(env.blockerChain.length > 0, `${action} envelope should have at least one blocker`);
  }
});

test('capabilityBlockers includes halted state in chain when system is halted', () => {
  const p = new OperatorReadModel().project(input({lifecycle: 'SAFETY_LOCKED'}));
  assert.ok(p.capabilityBlockers.open.includes('SYSTEM_HALTED'), 'should include SYSTEM_HALTED when halted');
  assert.ok(p.capabilityBlockers.close.includes('SYSTEM_HALTED'), 'should include SYSTEM_HALTED when halted');
});

test('capabilityBlockers includes market state when feed is stale', () => {
  const p = new OperatorReadModel().project(input({discovery: {feedStale: true, rows: [], positions: [{mint: 'paper-position'}]}}));
  assert.ok(p.capabilityBlockers.observe.some(x => x.startsWith('MARKET_DATA_')), 'should flag market state');
  assert.equal(p.system.state, 'DEGRADED', 'exit availability cannot make stale market evidence operational');
  assert.equal(p.capabilities.close.state, 'READY');
});

// --- Phase 1: Projection Guard Stale Fence ---

test('projection guard isStale returns true after validUntil expires', () => {
  const guard = createProjectionGuard();
  const data = {
    schemaVersion: 1, authorityGeneration: 'gen-1', projectionVersion: 1,
    generatedAt: 1000, validUntil: 5000,
    tokens: [], positions: [],
    capabilities: Object.fromEntries(['observe','score','open','increase','reduce','close','reconcile','persist'].map(k => [k, {state: 'UNKNOWN', reasonCodes: []}])),
    system: {}, environment: {mode: 'SIMULATION'}, marketData: {}, risk: {}, capital: {},
    executions: {}, envelopes: {}, providers: [], incidents: [],
  };
  assert.ok(guard(data));
  assert.equal(guard.isStale(4999), false, 'should not be stale before validUntil');
  assert.equal(guard.isStale(5001), true, 'should be stale after validUntil');
  assert.equal(guard.version(), 1);
  assert.equal(guard.validUntil(), 5000);
});

test('projection guard tracks version and validUntil through successive projections', () => {
  const guard = createProjectionGuard();
  const mk = (v, at) => ({
    schemaVersion: 1, authorityGeneration: 'gen-1', projectionVersion: v,
    generatedAt: at, validUntil: at + 4000,
    tokens: [], positions: [],
    capabilities: Object.fromEntries(['observe','score','open','increase','reduce','close','reconcile','persist'].map(k => [k, {state: 'UNKNOWN', reasonCodes: []}])),
    system: {}, environment: {mode: 'SIMULATION'}, marketData: {}, risk: {}, capital: {},
    executions: {}, envelopes: {}, providers: [], incidents: [],
  });
  assert.ok(guard(mk(1, 1000)));
  assert.equal(guard.version(), 1);
  assert.ok(guard(mk(2, 2000)));
  assert.equal(guard.version(), 2);
  assert.equal(guard.validUntil(), 6000);
  assert.equal(guard.isStale(5999), false);
  assert.equal(guard.isStale(6001), true);
});

// --- Workspace Reducer: Stale Projection Behavior ---

test('STALE_PROJECTION blocks navigation and execution preparation', () => {
  let s = workspaceReducer(initialWorkspace(), {type: 'CONNECTED'});
  s = workspaceReducer(s, {type: 'STALE_PROJECTION'});
  assert.equal(s.mode, 'STALE_PROJECTION');
  assert.equal(s.staleProjection, true);
  // Navigation should be blocked
  const nav = workspaceReducer(s, {type: 'NAVIGATE', workspace: 'Token Intelligence'});
  assert.equal(nav.workspace, s.workspace, 'navigation blocked during stale projection');
  // Investigation should be blocked
  const inv = workspaceReducer(s, {type: 'INVESTIGATE', mint: 'XYZ'});
  assert.equal(inv.investigation, null, 'investigation blocked during stale projection');
  // Execution preparation should be blocked
  const prep = workspaceReducer(s, {type: 'PREPARE', review: {tokenId: 'ABC'}});
  assert.equal(prep.execution, null, 'execution blocked during stale projection');
});

test('CONNECTED clears stale projection state and restores navigation', () => {
  let s = workspaceReducer(initialWorkspace(), {type: 'CONNECTED'});
  s = workspaceReducer(s, {type: 'STALE_PROJECTION'});
  assert.equal(s.mode, 'STALE_PROJECTION');
  s = workspaceReducer(s, {type: 'CONNECTED'});
  assert.notEqual(s.mode, 'STALE_PROJECTION');
  assert.equal(s.staleProjection, false);
  // Navigation should work again
  const nav = workspaceReducer(s, {type: 'NAVIGATE', workspace: 'Token Intelligence'});
  assert.equal(nav.workspace, 'Token Intelligence');
});

test('ATTENTION_OVERRIDE forces navigation to incident response', () => {
  let s = workspaceReducer(initialWorkspace(), {type: 'CONNECTED'});
  s = workspaceReducer(s, {type: 'ATTENTION_OVERRIDE', target: 'Incidents'});
  assert.equal(s.workspace, 'Incidents');
  assert.equal(s.mode, 'INCIDENT_RESPONSE');
  assert.equal(s.attentionOverride, 'Incidents');
  s = workspaceReducer(s, {type: 'CLEAR_ATTENTION'});
  assert.equal(s.attentionOverride, null);
});

test('Capital Command workspace maps to POSITION_MANAGEMENT mode', () => {
  let s = workspaceReducer(initialWorkspace(), {type: 'CONNECTED'});
  s = workspaceReducer(s, {type: 'NAVIGATE', workspace: 'Capital Command'});
  assert.equal(s.workspace, 'Capital Command');
  assert.equal(s.mode, 'POSITION_MANAGEMENT');
});
