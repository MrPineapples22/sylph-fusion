import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EinsteinRelativityEngine } from '../../dist/intelligence/einstein/regime-relativity.js';

const base = {
  mint: 'So11111111111111111111111111111111111111112',
  token_age_sec: 60,
  tx_count: 12,
  liquidity_sol: 20,
  market_cap_sol: 100,
  decision_at_ms: 8_000_000,
};

test('unavailable history and execution quotes remain unknown instead of liquidity-based estimates', () => {
  const result = new EinsteinRelativityEngine().normalizeContext(base);
  for (const signal of [result.velocity_by_age, result.liquidity_by_mcap, result.volume_by_liquidity, result.price_by_sol, result.slippage_by_depth]) {
    assert.equal(signal.availability, 'UNAVAILABLE');
    assert.equal(signal.absolute_value, null);
    assert.equal(signal.normalized_value, null);
    assert.equal(signal.uncertainty, null);
  }
});

test('decision-time token age rejects string coercion and non-finite values', () => {
  const engine = new EinsteinRelativityEngine();
  for (const token_age_sec of ['60', NaN, Infinity, -1]) {
    assert.throws(() => engine.normalizeContext({ ...base, token_age_sec }), /token_age_sec must be/);
  }
});

test('velocity and liquidity ratios require timestamped observations with source identity', () => {
  const engine = new EinsteinRelativityEngine();
  const velocity = {
    transactionCount: 12, windowStartMs: 7_900_000, windowEndMs: 7_950_000,
    observedAtMs: 7_960_000, observationId: 'velocity-1',
  };
  const liquidityMarketCap = {
    liquiditySol: 20, marketCapSol: 100, observedAtMs: 7_960_000, observationId: 'liquidity-1',
  };
  const result = engine.normalizeContext({ ...base, velocity_observation: velocity, liquidity_market_cap_observation: liquidityMarketCap });
  assert.equal(result.velocity_by_age.availability, 'OBSERVED');
  assert.equal(result.velocity_by_age.evidenceId, 'velocity-1');
  assert.equal(result.liquidity_by_mcap.availability, 'OBSERVED');
  assert.equal(result.liquidity_by_mcap.evidenceId, 'liquidity-1');

  assert.throws(() => engine.normalizeContext({
    ...base, velocity_observation: { ...velocity, observedAtMs: base.decision_at_ms + 1 },
  }), /velocity_observation is invalid/);
  assert.throws(() => engine.normalizeContext({
    ...base, liquidity_market_cap_observation: { ...liquidityMarketCap, liquiditySol: 0 },
  }), /liquidity_market_cap_observation is invalid/);
});

test('paired token and SOL returns require the same completed one-hour window known at decision time', () => {
  const engine = new EinsteinRelativityEngine();
  const observation = {
    returnCurrency: 'USD',
    tokenReturnPct: 12,
    solReturnPct: 2,
    windowStartMs: 3_000_000,
    windowEndMs: 6_600_000,
    observedAtMs: 6_610_000,
    observationId: 'paired-return-1',
  };
  const result = engine.normalizeContext({ ...base, relative_return_1h: observation });
  assert.equal(result.price_by_sol.availability, 'OBSERVED');
  assert.equal(result.price_by_sol.absolute_value, 9.8);
  assert.equal(result.price_by_sol.evidenceId, 'paired-return-1');
  assert.equal(result.price_by_sol.windowEndMs, 6_600_000);

  assert.throws(() => engine.normalizeContext({
    ...base, relative_return_1h: { ...observation, windowEndMs: 6_500_000 },
  }), /paired one-hour observation/);
  assert.throws(() => engine.normalizeContext({
    ...base, relative_return_1h: { ...observation, observedAtMs: base.decision_at_ms + 1 },
  }), /paired one-hour observation/);
  assert.throws(() => engine.normalizeContext({
    ...base, relative_return_1h: { ...observation, returnCurrency: 'SOL' },
  }), /paired one-hour observation/);
});

test('volume requires an observed window and slippage requires a live size-specific routed quote', () => {
  const engine = new EinsteinRelativityEngine();
  const volume = {
    volumeSol: 30, windowStartMs: 7_000_000, windowEndMs: 7_500_000,
    observedAtMs: 7_600_000, observationId: 'volume-1',
  };
  const quote = {
    slippageBps: 90, tradeSizeLamports: '500000000', routeId: 'route-1',
    quotedAtMs: 7_900_000, validUntilMs: 8_000_000, observationId: 'quote-1',
  };
  const result = engine.normalizeContext({ ...base, liquidity_market_cap_observation: {
    liquiditySol: 20, marketCapSol: 100, observedAtMs: 7_900_000, observationId: 'liquidity-1',
  }, volume_observation: volume, slippage_quote: quote });
  assert.equal(result.volume_by_liquidity.availability, 'OBSERVED');
  assert.equal(result.volume_by_liquidity.evidenceId, 'volume-1');
  assert.equal(result.slippage_by_depth.absolute_value, 90);
  assert.equal(result.slippage_by_depth.evidenceId, 'quote-1');

  assert.throws(() => engine.normalizeContext({
    ...base, volume_observation: { ...volume, observedAtMs: base.decision_at_ms + 1 },
  }), /volume_observation is invalid/);
  assert.throws(() => engine.normalizeContext({
    ...base, slippage_quote: { ...quote, validUntilMs: base.decision_at_ms - 1 },
  }), /size-specific quote/);
});

test('master orchestrator forwards evidence and no longer synthesizes Einstein observations', async () => {
  const source = await readFile(new URL('../../src/intelligence/master-orchestrator.ts', import.meta.url), 'utf8');
  const uiSource = await readFile(new URL('../../terminal/src/components/TokenIntelligenceInspector.jsx', import.meta.url), 'utf8');
  const callStart = source.indexOf('const einsteinBundle = this.einstein.normalizeContext({');
  const callEnd = source.indexOf('\n    });', callStart);
  const einsteinCall = source.slice(callStart, callEnd);
  assert.match(einsteinCall, /volume_observation: context\.volumeObservation/);
  assert.match(einsteinCall, /velocity_observation: context\.velocityObservation/);
  assert.match(einsteinCall, /liquidity_market_cap_observation: context\.liquidityMarketCapObservation/);
  assert.match(einsteinCall, /relative_return_1h: context\.relativeReturn1h/);
  assert.match(einsteinCall, /slippage_quote: context\.slippageQuote/);
  assert.doesNotMatch(einsteinCall, /token_return_1h_pct:\s*5\.2/);
  assert.doesNotMatch(einsteinCall, /sol_return_1h_pct:\s*1\.2/);
  assert.doesNotMatch(einsteinCall, /volume_sol:\s*context\.liquiditySol\s*\*\s*1\.5/);
  assert.doesNotMatch(einsteinCall, /slippage_bps:\s*80/);
  assert.doesNotMatch(einsteinCall, /tx_count:\s*context\.txCount/);
  assert.doesNotMatch(einsteinCall, /liquidity_sol:\s*context\.liquiditySol/);
  assert.match(uiSource, /TOKEN RETURN VS SOL \(1H\)/);
  assert.match(uiSource, /formatScientificPercent\(einstein\.excessReturnOverSol\)/);
  assert.match(uiSource, /OBSERVED VOLUME \/ LIQUIDITY/);
  assert.doesNotMatch(uiSource, /excessReturnOverSol\s*\?\?\s*0\.45/);
  assert.doesNotMatch(uiSource, /velocityByAgeNormalized\s*\?\?\s*0\.72/);
  assert.doesNotMatch(uiSource, /liquidityToMcapRatio\s*\?\?\s*0\.38/);
});
