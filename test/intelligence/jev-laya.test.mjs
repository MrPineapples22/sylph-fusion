import test from 'node:test';
import assert from 'node:assert/strict';
import { AstraFeatureAdapter, FEATURE_DEFINITIONS } from '../../dist/intelligence/astra/features.js';
import { JevEngine, LayaEngine, assessDisagreement, certificateFor } from '../../dist/intelligence/astra/jev-laya.js';

const now = 1_800_000_000_000;
const values = { price_velocity: .01, price_acceleration: .001, buy_sell_ratio: 4, liquidity: 250000, market_cap: 1000000, liquidity_velocity: .001, wallet_concentration: .1, unique_buyers: 80, first_buyer_quality: .9, bundle_rate: .02, wash_ratio: .02, rug_score: .05, dev_concentration: .05, volatility: .01, provider_error_rate: .01, provider_slot_lag: 1 };
const observation = name => ({name, value: values[name], source: 'certified-adapter', evidenceId: `e:${name}`, correlationGroup: 'independent', observedAt: now - 100, availableAt: now - 50, unit: FEATURE_DEFINITIONS[name].unit, windowMs: FEATURE_DEFINITIONS[name].windowMs, confidence: .9, conflict: false});
const context = changes => new AstraFeatureAdapter().capture('token', Object.keys(values).map(observation).map(x => ({...x, ...(changes?.[x.name] ?? {})})), now, 100);

test('JEV consumes an immutable certified feature context and emits advisory escalation', () => {
  const ctx = context(); const result = new JevEngine().decide('token', ctx, now);
  assert.equal(result.classification, 'HIGH_INTEREST'); assert.equal(result.escalation.required, true);
  assert.equal(result.escalation.preferredAgent, 'LAYA'); assert.ok(result.warnings.includes('ADVISORY_ONLY'));
  assert.equal(result.featureSnapshotHash, ctx.snapshot.snapshotHash);
});
test('JEV fails closed to need-more-evidence rather than zero-filling stale features', () => {
  const ctx = context({price_velocity:{observedAt: now - 6000}}); const result = new JevEngine().decide('token', ctx, now);
  assert.equal(result.classification, 'NEED_MORE_EVIDENCE'); assert.ok(result.warnings.some(x => x.includes('STALE')));
});
test('JEV does not treat a selectively supplied feature subset as complete evidence', () => {
  const full = context(); const subset = new AstraFeatureAdapter().capture('token', [full.observations.price_velocity], now, 100);
  const result = new JevEngine().decide('token', subset, now);
  assert.equal(result.classification, 'NEED_MORE_EVIDENCE'); assert.ok(result.evidenceCoverage < .7);
});
test('JEV and its certificate reject identities that are not bound to the snapshot', () => {
  const ctx = context(); const engine = new JevEngine();
  assert.throws(() => engine.decide('other-token', ctx, now));
  const decision = engine.decide('token', ctx, now);
  assert.throws(() => certificateFor('JEV', 'wrong-id', ctx, decision, now, now + 1));
});
test('Laya is pinned to JEV exact state and disagreement stays explicit', () => {
  const ctx = context(); const jev = new JevEngine().decide('token', ctx, now); const laya = new LayaEngine().assess('token', ctx, jev, now);
  assert.equal(laya.marketStateHash, ctx.snapshot.snapshotHash); const disagreement = assessDisagreement(jev, laya);
  assert.ok(['LOW','MEANINGFUL','STRUCTURAL','OOD'].includes(disagreement.classification));
  assert.throws(() => new LayaEngine().assess('other', ctx, jev, now));
});
test('inference certificates pin model and exact snapshot hashes', () => {
  const ctx = context(); const decision = new JevEngine().decide('token', ctx, now); const cert = certificateFor('JEV', decision.decisionId, ctx, decision, now, now + 1);
  assert.equal(cert.featureSnapshotHash, ctx.snapshot.snapshotHash); assert.match(cert.modelHash, /^[a-f0-9]{64}$/); assert.match(cert.outputHash, /^[a-f0-9]{64}$/);
});
