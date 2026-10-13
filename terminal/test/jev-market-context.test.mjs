import test from 'node:test';
import assert from 'node:assert/strict';
import {FEATURE_DEFINITIONS} from '../../dist/intelligence/astra/features.js';
import {createJevMarketFeatureContextBuilder} from '../jev-market-context.mjs';

const mint = 'So11111111111111111111111111111111111111112';
const now = 1_800_000_000_000;
const token = {mint, at: now - 100, price: 1, liquidity: 250_000, cap: 1_000_000, pair: 'pair-a'};
const baseRisk = {mint, at: now - 90, providers: {rugcheck: 'live'}, normalizedScore01: 0.24};

test('JEV market context includes only an explicit normalized RugCheck risk score', () => {
  const build = createJevMarketFeatureContextBuilder(FEATURE_DEFINITIONS);
  const observations = build(mint, token, baseRisk, null, null, null, now);
  const rug = observations.find(item => item.name === 'rug_score');
  assert.ok(rug);
  assert.equal(rug.value, 0.24);
  assert.equal(rug.source, 'RUGCHECK_API');
  assert.equal(rug.evidenceId, `rugcheck:${mint}:${baseRisk.at}:score_normalised`);
  assert.equal(rug.unit, 'fraction');
});

test('JEV market context leaves missing, stale, and out-of-range RugCheck scores unknown', () => {
  const build = createJevMarketFeatureContextBuilder(FEATURE_DEFINITIONS);
  for (const risk of [
    {...baseRisk, normalizedScore01: null},
    {...baseRisk, normalizedScore01: 1.01},
    {...baseRisk, at: now - 45_001},
  ]) {
    const observations = build(mint, token, risk, null, null, null, now);
    assert.equal(observations.some(item => item.name === 'rug_score'), false);
  }
});
