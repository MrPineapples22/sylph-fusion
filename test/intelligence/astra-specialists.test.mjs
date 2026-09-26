import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialAgents } from '../../dist/intelligence/astra/specialists.js';
import { AstraFeatureAdapter, FEATURE_DEFINITIONS } from '../../dist/intelligence/astra/features.js';

const now = 1_800_000_000_000;
const defaults = {
  price_velocity: 0.002, price_acceleration: 0.0001, buy_sell_ratio: 2,
  liquidity: 100_000, market_cap: 1_000_000, liquidity_velocity: 0,
  wallet_concentration: 0.2, unique_buyers: 50, first_buyer_quality: 0.8,
  bundle_rate: 0.1, wash_ratio: 0.1, rug_score: 0.1, dev_concentration: 0.1,
  volatility: 0.005, provider_error_rate: 0.01, provider_slot_lag: 1,
};
function observation(name, overrides = {}) {
  const spec = FEATURE_DEFINITIONS[name];
  return {name, value: defaults[name], source: 'measured-provider', evidenceId: 'event:' + name,
    correlationGroup: 'underlying-market-observation', observedAt: now - 100, availableAt: now - 50,
    unit: spec.unit, windowMs: spec.windowMs, confidence: 0.9, conflict: false, ...overrides};
}
function context(agent, change = (x) => x) {
  return new AstraFeatureAdapter().capture('mint-under-test', agent.requiredFeatures.map(name => observation(name)).map(change).filter(Boolean), now, 100);
}
const analyze = (agent, ctx, at = now, signal = new AbortController().signal) => agent.analyze(ctx, at, signal);
function unavailable(result) {
  assert.notEqual(result.status, 'VERIFIED');
  assert.equal(result.result.opportunity, null);
  assert.equal(result.result.risk, null);
  assert.equal(result.confidence, 0);
}
function bounded(result) {
  for (const score of [result.result.opportunity, result.result.risk]) {
    assert.ok(score === null || Number.isFinite(score) && score >= 0 && score <= 1);
  }
  assert.ok(result.confidence >= 0 && result.confidence <= 0.5);
}

test('exactly eight independent rule instances, explicit versions and immutable feature declarations', () => {
  const first = createInitialAgents(), second = createInitialAgents();
  assert.deepEqual(first.map(x => x.id), ['Momentum','Liquidity','Wallet','Bundler','Wash','RugRisk','MarketRegime','ProviderQuality']);
  for (let i = 0; i < first.length; i++) {
    assert.notEqual(first[i], second[i]);
    assert.equal(first[i].version, '1.0.0');
    assert.ok(Object.isFrozen(first[i].requiredFeatures));
  }
});

for (const agent of createInitialAgents()) {
  test(`${agent.id}: complete measured inputs produce bounded reproducible uncalibrated rule evidence`, async () => {
    const ctx = context(agent), result = await analyze(agent, ctx);
    assert.equal(result.status, 'VERIFIED');
    assert.equal(result.snapshotHash, ctx.snapshot.snapshotHash);
    assert.equal(result.agentVersion, agent.version);
    assert.equal(result.confidence, 0.5);
    assert.equal(result.evidence.length, agent.requiredFeatures.length);
    assert.ok(result.warnings.some(x => x.includes('RULE_UNCALIBRATED')));
    assert.ok(result.result.reasons.length);
    bounded(result);
    assert.deepEqual(result, await analyze(agent, ctx));
  });

  for (const name of agent.requiredFeatures) {
    test(`${agent.id}/${name}: missing and null inputs abstain, never zero-fill`, async () => {
      unavailable(await analyze(agent, context(agent, x => x.name === name ? null : x)));
      unavailable(await analyze(agent, context(agent, x => x.name === name ? {...x, value: null} : x)));
    });
    test(`${agent.id}/${name}: stale or conflicting observation degrades and abstains`, async () => {
      const stale = await analyze(agent, context(agent, x => x.name === name ? {...x, observedAt: now - FEATURE_DEFINITIONS[name].freshnessLimitMs - 1} : x));
      assert.equal(stale.status, 'DEGRADED');
      assert.equal(stale.diagnostics.staleInput, true);
      unavailable(stale);
      const conflict = await analyze(agent, context(agent, x => x.name === name ? {...x, conflict: true} : x));
      assert.equal(conflict.status, 'DEGRADED');
      unavailable(conflict);
    });
    test(`${agent.id}/${name}: malformed, impossible and out-of-schema observations abstain`, async () => {
      const spec = FEATURE_DEFINITIONS[name];
      const bad = [
        {value: NaN}, {value: Infinity}, {value: -Infinity}, {value: '0'},
        {value: spec.minimum - 1}, {value: spec.maximum + Math.max(1, Math.abs(spec.maximum) * Number.EPSILON * 2)},
        {unit: 'wrong'}, {windowMs: spec.windowMs + 1}, {source: ''}, {evidenceId: ''},
        {correlationGroup: ''}, {confidence: NaN}, {confidence: -1}, {confidence: 2}, {confidence: 0},
        {observedAt: now + 1, availableAt: now + 2}, {availableAt: now - 101}, {conflict: 'false'},
      ];
      if (spec.unit === 'wallets' || spec.unit === 'slots') bad.push({value: 0.5});
      for (const patch of bad) unavailable(await analyze(agent, context(agent, x => x.name === name ? {...x, ...patch} : x)));
    });
    test(`${agent.id}/${name}: measured zero differs from missing, defined extrema stay bounded`, async () => {
      const zero = await analyze(agent, context(agent, x => x.name === name ? {...x, value: 0} : x));
      if (name === 'market_cap') {
        unavailable(zero);
        assert.ok(zero.result.reasons.some(x => x.includes('UNDEFINED_LIQUIDITY_RATIO')));
      } else assert.equal(zero.status, 'VERIFIED');
      bounded(zero);
      for (const value of [FEATURE_DEFINITIONS[name].minimum, FEATURE_DEFINITIONS[name].maximum]) {
        const result = await analyze(agent, context(agent, x => x.name === name ? {...x, value} : x));
        bounded(result);
        if (!(name === 'market_cap' && value === 0)) assert.equal(result.status, 'VERIFIED');
      }
    });
  }

  test(`${agent.id}: abort, future snapshot, altered schema and snapshot-value substitution abstain`, async () => {
    const ctx = context(agent), controller = new AbortController(); controller.abort();
    unavailable(await analyze(agent, ctx, now, controller.signal));
    unavailable(await analyze(agent, {...ctx, snapshot: {...ctx.snapshot, timestampMs: now + 1}}));
    unavailable(await analyze(agent, {...ctx, snapshot: {...ctx.snapshot, featureSchemaVersion: 'foreign'}}));
    unavailable(await analyze(agent, {...ctx, snapshot: {...ctx.snapshot, snapshotHash: 'fake'}}));
    const name = agent.requiredFeatures[0];
    unavailable(await analyze(agent, {...ctx, snapshot: {...ctx.snapshot, features: {...ctx.snapshot.features, [name]: -999}}}));
    unavailable(await analyze(agent, {...ctx, observations: {...ctx.observations, [name]: {...ctx.observations[name], availableAt: now + 1}}}, now + 2));
  });
}

test('risk rules cannot improve when their adverse measurement increases', async () => {
  const dimensions = { Wallet: 'wallet_concentration', Bundler: 'bundle_rate', Wash: 'wash_ratio', RugRisk: 'rug_score', MarketRegime: 'volatility', ProviderQuality: 'provider_error_rate' };
  for (const agent of createInitialAgents().filter(x => dimensions[x.id])) {
    const name = dimensions[agent.id];
    const low = await analyze(agent, context(agent, x => x.name === name ? {...x, value: 0} : x));
    const high = await analyze(agent, context(agent, x => x.name === name ? {...x, value: 1} : x));
    assert.ok(high.result.risk >= low.result.risk, agent.id);
  }
  const liquidity = createInitialAgents().find(x => x.id === 'Liquidity');
  const deep = await analyze(liquidity, context(liquidity));
  const shallow = await analyze(liquidity, context(liquidity, x => x.name === 'liquidity' ? {...x, value: 0} : x));
  assert.ok(shallow.result.risk >= deep.result.risk);
  const momentum = createInitialAgents().find(x => x.id === 'Momentum');
  const down = await analyze(momentum, context(momentum, x => x.name === 'price_velocity' ? {...x, value: -0.01} : x));
  const up = await analyze(momentum, context(momentum, x => x.name === 'price_velocity' ? {...x, value: 0.01} : x));
  assert.ok(up.result.opportunity >= down.result.opportunity);
  assert.ok(down.result.risk >= up.result.risk);
});
