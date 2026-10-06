import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveSystemOverallStatus } from '../health-status.mjs';

test('system health cannot report nominal while lifecycle or providers are degraded', () => {
  assert.equal(deriveSystemOverallStatus('NOMINAL', 'DEGRADED'), 'DEGRADED');
  assert.equal(deriveSystemOverallStatus('NOMINAL', 'OPEN_LOCKED'), 'RESTRICTED');
  assert.equal(deriveSystemOverallStatus('NOMINAL', 'SAFETY_LOCKED'), 'CRITICAL');
  assert.equal(deriveSystemOverallStatus('CRITICAL', 'HEALTHY'), 'CRITICAL');
  assert.equal(deriveSystemOverallStatus('RESTRICTED', 'READY'), 'RESTRICTED');
});

test('severity composition is monotone for every lifecycle/provider status pair', () => {
  const rank = { NOMINAL: 0, DEGRADED: 1, RESTRICTED: 2, CRITICAL: 3 };
  const lifecycle = {
    BOOT: 'DEGRADED', INITIALIZING: 'DEGRADED', CONNECTING: 'DEGRADED', SYNCHRONIZING: 'DEGRADED',
    RECONCILING: 'DEGRADED', CERTIFYING: 'DEGRADED', READY: 'NOMINAL', HEALTHY: 'NOMINAL',
    DEGRADED: 'DEGRADED', OPEN_LOCKED: 'RESTRICTED', REDUCE_ONLY: 'RESTRICTED', RECOVERING: 'DEGRADED',
    SAFETY_LOCKED: 'CRITICAL', DISCONNECTED: 'CRITICAL', SHUTTING_DOWN: 'CRITICAL',
  };
  for (const providerStatus of Object.keys(rank)) {
    for (const [lifecycleState, lifecycleStatus] of Object.entries(lifecycle)) {
      const expected = rank[providerStatus] >= rank[lifecycleStatus] ? providerStatus : lifecycleStatus;
      assert.equal(deriveSystemOverallStatus(providerStatus, lifecycleState), expected,
        `${providerStatus} + ${lifecycleState} must preserve the more severe state`);
    }
  }
});

test('unknown health and lifecycle values fail closed to degraded', () => {
  assert.equal(deriveSystemOverallStatus('UNKNOWN', 'HEALTHY'), 'DEGRADED');
  assert.equal(deriveSystemOverallStatus('NOMINAL', 'UNKNOWN'), 'DEGRADED');
  assert.equal(deriveSystemOverallStatus('NOMINAL', 'toString'), 'DEGRADED');
  assert.equal(deriveSystemOverallStatus('NOMINAL', 'constructor'), 'DEGRADED');
  assert.equal(deriveSystemOverallStatus(null, null), 'DEGRADED');
  for (const key of Object.getOwnPropertyNames(Object.prototype)) {
    assert.equal(deriveSystemOverallStatus('NOMINAL', key), 'DEGRADED', `prototype key ${key} is not a lifecycle state`);
    assert.equal(deriveSystemOverallStatus(key, 'HEALTHY'), 'DEGRADED', `prototype key ${key} is not a provider state`);
  }
  for (const value of [undefined, null, 0, true, Symbol('unknown'), Object.create(null)]) {
    assert.equal(deriveSystemOverallStatus(value, 'HEALTHY'), 'DEGRADED');
    assert.equal(deriveSystemOverallStatus('NOMINAL', value), 'DEGRADED');
  }
});

test('system health response keeps provider status separate and wires combined status', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /providerHealthStatus:\s*health\.overallSystemState/);
  assert.match(source, /overallStatus:\s*deriveSystemOverallStatus\(health\.overallSystemState,\s*operationalState\)/);
});
