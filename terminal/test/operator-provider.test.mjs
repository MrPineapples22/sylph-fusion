import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialWorkspace,
  workspaceReducer,
  createProjectionGuard,
  stableTokenOrder,
} from '../src/operator-runtime.js';

test('createProjectionGuard initializes with version 0 and validUntil 0', () => {
  const guard = createProjectionGuard();
  assert.equal(guard.version(), 0);
  assert.equal(guard.validUntil(), 0);
  assert.equal(guard.isStale(), false);
});

test('createProjectionGuard accepts valid projection and tracks validUntil', () => {
  const guard = createProjectionGuard();
  const now = Date.now();
  const projection = {
    schemaVersion: 1,
    authorityGeneration: 'gen-1',
    projectionVersion: 1,
    generatedAt: now,
    validUntil: now + 5000,
    tokens: [],
    positions: [],
    capabilities: Object.fromEntries(
      ['observe','score','open','increase','reduce','close','reconcile','persist'].map(k => [
        k, { state: 'READY', reasonCodes: ['SYSTEM_NOMINAL'] }
      ])
    ),
    system: { state: 'READY' },
    environment: { mode: 'SIMULATION' },
    marketData: { state: 'CURRENT' },
    risk: { state: 'NORMAL' },
    capital: { available: 1000 },
    executions: { state: 'IDLE' },
    envelopes: {},
    providers: [],
    incidents: [],
  };

  const accepted = guard(projection);
  assert.equal(accepted, true);
  assert.equal(guard.version(), 1);
  assert.equal(guard.validUntil(), now + 5000);
  assert.equal(guard.isStale(now + 1000), false);
  assert.equal(guard.isStale(now + 6000), true);
});

test('createProjectionGuard rejects stale or rollback versions', () => {
  const guard = createProjectionGuard();
  const now = Date.now();
  const mk = (v) => ({
    schemaVersion: 1,
    authorityGeneration: 'gen-1',
    projectionVersion: v,
    generatedAt: now,
    validUntil: now + 5000,
    tokens: [],
    positions: [],
    capabilities: Object.fromEntries(
      ['observe','score','open','increase','reduce','close','reconcile','persist'].map(k => [
        k, { state: 'READY', reasonCodes: ['SYSTEM_NOMINAL'] }
      ])
    ),
    system: { state: 'READY' },
    environment: { mode: 'SIMULATION' },
    marketData: { state: 'CURRENT' },
    risk: { state: 'NORMAL' },
    capital: { available: 1000 },
    executions: { state: 'IDLE' },
    envelopes: {},
    providers: [],
    incidents: [],
  });

  assert.equal(guard(mk(5)), true);
  assert.equal(guard.version(), 5);

  // Older version rejected
  assert.equal(guard(mk(4)), false);
  assert.equal(guard.version(), 5);
});

test('workspaceReducer handles CONNECTED, REVALIDATE, and STALE_PROJECTION modes', () => {
  let ws = initialWorkspace();
  assert.equal(ws.mode, 'BOOT');
  assert.equal(ws.workspace, 'Aether Flux');
  assert.equal(ws.staleProjection, false);

  ws = workspaceReducer(ws, { type: 'CONNECTED' });
  assert.equal(ws.mode, 'DISCOVERY');
  assert.equal(ws.staleProjection, false);

  ws = workspaceReducer(ws, { type: 'STALE_PROJECTION' });
  assert.equal(ws.mode, 'STALE_PROJECTION');
  assert.equal(ws.staleProjection, true);

  ws = workspaceReducer(ws, { type: 'REVALIDATE' });
  assert.equal(ws.mode, 'REVALIDATING');
});

test('workspaceReducer enforces context isolation between investigation and execution', () => {
  let ws = initialWorkspace();
  ws = workspaceReducer(ws, { type: 'CONNECTED' });

  // Start investigation on token A
  ws = workspaceReducer(ws, { type: 'INVESTIGATE', mint: 'mint-AAA' });
  assert.equal(ws.investigation, 'mint-AAA');
  assert.equal(ws.mode, 'INVESTIGATION');

  // Prepare locked execution context
  const reviewContract = { contractId: 'erc-1', mint: 'mint-AAA', side: 'buy' };
  ws = workspaceReducer(ws, { type: 'PREPARE', review: reviewContract });
  assert.equal(ws.mode, 'EXECUTION_LOCKED');
  assert.deepEqual(ws.execution, reviewContract);

  // Investigating a different token must NOT mutate locked execution context
  ws = workspaceReducer(ws, { type: 'INVESTIGATE', mint: 'mint-BBB' });
  assert.equal(ws.investigation, 'mint-BBB');
  assert.deepEqual(ws.execution, reviewContract);
  assert.equal(ws.mode, 'EXECUTION_LOCKED');
});

test('workspaceReducer handles ATTENTION_OVERRIDE for emergency arbitration', () => {
  let ws = initialWorkspace();
  ws = workspaceReducer(ws, { type: 'CONNECTED' });
  ws = workspaceReducer(ws, { type: 'NAVIGATE', workspace: 'Aether Flux' });

  // Critical incident trigger
  ws = workspaceReducer(ws, { type: 'ATTENTION_OVERRIDE', target: 'Incidents' });
  assert.equal(ws.workspace, 'Incidents');
  assert.equal(ws.attentionOverride, 'Incidents');
  assert.equal(ws.mode, 'INCIDENT_RESPONSE');

  // Operator dismisses alert
  ws = workspaceReducer(ws, { type: 'CLEAR_ATTENTION' });
  assert.equal(ws.attentionOverride, null);
});

test('stableTokenOrder preserves spatial layout across updates', () => {
  const initial = [
    { mint: 'token-1', symbol: 'T1' },
    { mint: 'token-2', symbol: 'T2' },
    { mint: 'token-3', symbol: 'T3' },
  ];

  let order = stableTokenOrder([], initial);
  assert.deepEqual(order, ['token-1', 'token-2', 'token-3']);

  // Updates with reordered numerical values should preserve row placement
  const reordered = [
    { mint: 'token-3', symbol: 'T3' },
    { mint: 'token-1', symbol: 'T1' },
    { mint: 'token-4', symbol: 'T4' }, // new token appended
  ];

  order = stableTokenOrder(order, reordered);
  assert.deepEqual(order, ['token-1', 'token-3', 'token-4']);
});
