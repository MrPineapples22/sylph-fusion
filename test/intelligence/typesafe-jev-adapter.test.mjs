import test from 'node:test';
import assert from 'node:assert/strict';
import { AstraFeatureAdapter, FEATURE_DEFINITIONS } from '../../dist/intelligence/astra/features.js';
import { TypeSafeHostedJevAdapter, hostedJevFromEnvironment } from '../../dist/intelligence/astra/typesafe-jev-adapter.js';
const now = 1_800_000_000_000;
const context = () => new AstraFeatureAdapter().capture('token', [{ name: 'liquidity', value: 200000, source: 'test', evidenceId: 'e', correlationGroup: 'test', observedAt: now - 1, availableAt: now, unit: FEATURE_DEFINITIONS.liquidity.unit, windowMs: 0, confidence: 1, conflict: false }], now, 100);
const response = body => ({ ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify(body) });

test('hosted Jev stays disabled without an explicit secret and never fabricates an answer', async () => {
  const result = await new TypeSafeHostedJevAdapter({ apiKey: null }, async () => { throw Error('must not call'); }).assess(context());
  assert.equal(result.status, 'DISABLED'); assert.equal(result.answers, null); assert.equal(result.executionAuthorized, false);
});
test('environment construction does not invent credentials or enable a network call', async () => {
  const result = await hostedJevFromEnvironment({}).assess(context());
  assert.equal(result.status, 'DISABLED'); assert.equal(result.errorCode, 'TYPESAFE_API_KEY_UNCONFIGURED');
  assert.equal(result.requestedModel, 'typesafe/jev-1.13');
});
test('hosted Jev defaults to TypeSafe documented endpoint and requested 1.13 model', async () => {
  const answers = Object.fromEntries(['organic_continuation', 'reflexive_chase', 'distribution', 'exhaustion', 'liquidity_failure', 'synthetic_flow', 'evidence_sufficiency'].map(name => [name, { type: 'noul', noul: .2 }]));
  let target;
  const adapter = hostedJevFromEnvironment({TYPESAFE_API_KEY:'test-key'}, async (url, init) => { target = [url, JSON.parse(init.body)]; return response({model:'typesafe/jev-1.13', answers}); });
  const result = await adapter.assess(context());
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(target[0], 'https://api.typesafe.ai/v1/systemone');
  assert.equal(target[1].model, 'typesafe/jev-1.13');
});
test('hosted Jev pins the resolved model and exact certified snapshot in an advisory result', async () => {
  const answers = Object.fromEntries(['organic_continuation', 'reflexive_chase', 'distribution', 'exhaustion', 'liquidity_failure', 'synthetic_flow', 'evidence_sufficiency'].map(name => [name, { type: 'noul', noul: .2 }]));
  const adapter = new TypeSafeHostedJevAdapter({ apiKey: 'test-key', apiUrl: 'https://gateway.example/v1/systemone' }, async (_url, init) => { assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error'); return response({ model: 'jev-1.13.0', answers }); });
  const source = context(); const result = await adapter.assess(source);
  assert.equal(result.status, 'AVAILABLE'); assert.equal(result.resolvedModel, 'jev-1.13.0'); assert.equal(result.featureSnapshotHash, source.snapshot.snapshotHash); assert.equal(result.authority, 'ADVISORY_ONLY');
});
test('hosted Jev rejects malformed remote output instead of accepting a plausible-looking result', async () => {
  const result = await new TypeSafeHostedJevAdapter({ apiKey: 'test-key', apiUrl: 'https://gateway.example/v1/systemone' }, async () => response({ model: 'not-jev', answers: {} })).assess(context());
  assert.equal(result.status, 'INVALID_RESPONSE'); assert.equal(result.answers, null);
});

test('hosted Jev rejects oversized bodies even when the provider omits Content-Length', async () => {
  const result = await new TypeSafeHostedJevAdapter({ apiKey: 'test-key', apiUrl: 'https://gateway.example/v1/systemone' }, async () => ({
    ok: true, status: 200, headers: new Headers(), text: async () => ' '.repeat(262_145),
  })).assess(context());
  assert.equal(result.status, 'INVALID_RESPONSE'); assert.equal(result.errorCode, 'TYPESAFE_RESPONSE_TOO_LARGE');
});

test('hosted Jev rejects invalid Content-Length and malformed JSON as typed response failures', async () => {
  const badLength = await new TypeSafeHostedJevAdapter({ apiKey: 'test-key', apiUrl: 'https://gateway.example/v1/systemone' }, async () => ({
    ok: true, status: 200, headers: new Headers({'content-length':'not-a-length'}), text: async () => '{}',
  })).assess(context());
  const badJson = await new TypeSafeHostedJevAdapter({ apiKey: 'test-key', apiUrl: 'https://gateway.example/v1/systemone' }, async () => ({
    ok: true, status: 200, headers: new Headers(), text: async () => '{invalid',
  })).assess(context());
  assert.equal(badLength.status, 'INVALID_RESPONSE'); assert.equal(badLength.errorCode, 'TYPESAFE_RESPONSE_TOO_LARGE');
  assert.equal(badJson.status, 'INVALID_RESPONSE'); assert.equal(badJson.errorCode, 'TYPESAFE_RESPONSE_JSON_INVALID');
});
