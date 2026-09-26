import test from 'node:test';
import assert from 'node:assert/strict';
import { AstraFeatureAdapter, FEATURE_DEFINITIONS } from '../../dist/intelligence/astra/features.js';
import { TypeSafeHostedJevAdapter, hostedJevFromEnvironment } from '../../dist/intelligence/astra/typesafe-jev-adapter.js';
const now = 1_800_000_000_000;
const context = () => new AstraFeatureAdapter().capture('token', [{ name: 'liquidity', value: 200000, source: 'test', evidenceId: 'e', correlationGroup: 'test', observedAt: now - 1, availableAt: now, unit: FEATURE_DEFINITIONS.liquidity.unit, windowMs: 0, confidence: 1, conflict: false }], now, 100);
const response = body => ({ ok: true, status: 200, headers: new Headers(), json: async () => body });

test('hosted Jev stays disabled without an explicit secret and never fabricates an answer', async () => {
  const result = await new TypeSafeHostedJevAdapter({ apiKey: null }, async () => { throw Error('must not call'); }).assess(context());
  assert.equal(result.status, 'DISABLED'); assert.equal(result.answers, null); assert.equal(result.executionAuthorized, false);
});
test('environment construction does not invent credentials or enable a network call', async () => {
  const result = await hostedJevFromEnvironment({}).assess(context());
  assert.equal(result.status, 'DISABLED'); assert.equal(result.errorCode, 'TYPESAFE_API_KEY_UNCONFIGURED');
});
test('hosted Jev pins the resolved model and exact certified snapshot in an advisory result', async () => {
  const answers = Object.fromEntries(['organic_continuation', 'reflexive_chase', 'distribution', 'exhaustion', 'liquidity_failure', 'synthetic_flow', 'evidence_sufficiency'].map(name => [name, { type: 'noul', noul: .2 }]));
  const adapter = new TypeSafeHostedJevAdapter({ apiKey: 'test-key' }, async (_url, init) => { assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); return response({ model: 'jev-1.13.0', answers }); });
  const source = context(); const result = await adapter.assess(source);
  assert.equal(result.status, 'AVAILABLE'); assert.equal(result.resolvedModel, 'jev-1.13.0'); assert.equal(result.featureSnapshotHash, source.snapshot.snapshotHash); assert.equal(result.authority, 'ADVISORY_ONLY');
});
test('hosted Jev rejects malformed remote output instead of accepting a plausible-looking result', async () => {
  const result = await new TypeSafeHostedJevAdapter({ apiKey: 'test-key' }, async () => response({ model: 'not-jev', answers: {} })).assess(context());
  assert.equal(result.status, 'INVALID_RESPONSE'); assert.equal(result.answers, null);
});
