import test from 'node:test';
import assert from 'node:assert/strict';
import { AstraFeatureAdapter, FEATURE_DEFINITIONS } from '../../dist/intelligence/astra/features.js';
import { JevShadowLane } from '../../dist/intelligence/astra/jev-shadow-lane.js';

const now = 1_800_000_000_000;
const values = { price_velocity: .01, price_acceleration: .001, buy_sell_ratio: 4, liquidity: 250000, market_cap: 1000000, liquidity_velocity: .001, wallet_concentration: .1, unique_buyers: 80, first_buyer_quality: .9, bundle_rate: .02, wash_ratio: .02, rug_score: .05, dev_concentration: .05, volatility: .01, provider_error_rate: .01, provider_slot_lag: 1 };
const context = tokenId => new AstraFeatureAdapter().capture(tokenId, Object.keys(values).map(name => ({ name, value: values[name], source: 'certified-adapter', evidenceId: `e:${name}`, correlationGroup: 'independent', observedAt: now - 100, availableAt: now - 50, unit: FEATURE_DEFINITIONS[name].unit, windowMs: FEATURE_DEFINITIONS[name].windowMs, confidence: .9, conflict: false })), now, 100);

test('JEV shadow lane emits hash-chained, read-only advisory evidence', () => {
  const lane = new JevShadowLane(2); const first = lane.evaluate('token-a', context('token-a'), now); const second = lane.evaluate('token-b', context('token-b'), now + 1);
  assert.equal(first.authority, 'ADVISORY_ONLY'); assert.equal(first.executionAuthorized, false);
  assert.equal(first.certificates.length, 2); assert.equal(second.previousHash, first.recordHash);
  assert.equal(lane.verifyRetainedChain(), true); assert.equal(lane.project().latestByToken['token-a'].decision.tokenId, 'token-a');
});

test('JEV shadow lane bounds its projection without manufacturing authority', () => {
  const lane = new JevShadowLane(1); lane.evaluate('token-a', context('token-a'), now); lane.evaluate('token-b', context('token-b'), now + 1);
  const projection = lane.project();
  assert.equal(projection.totalRecords, 1); assert.equal(projection.authority, 'ADVISORY_ONLY');
  assert.equal(projection.executionAuthorized, false); assert.equal(projection.latestByToken['token-a'], undefined);
});
