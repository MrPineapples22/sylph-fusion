import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchAndEvaluateSafety} from '../src/filters/preflight.js';

test('browser preflight requires an explicit configured RugCheck endpoint', async () => {
  let calls = 0;
  const result = await fetchAndEvaluateSafety('mint', {}, async () => { calls++; throw new Error('must not be called'); });
  assert.equal(calls, 0);
  assert.equal(result.pass, false);
  assert.match(result.reasons[0], /not explicitly configured/);
});

test('browser preflight uses only the configured HTTPS RugCheck endpoint', async () => {
  let requested;
  const result = await fetchAndEvaluateSafety('mint', {rugcheckUrl: 'https://provider.example/v1/'}, async url => {
    requested = String(url);
    return {ok: true, json: async () => ({mintAuthority: null, freezeAuthority: null, score: 0, markets: [{lp: {lpBurnedPct: 100}}], topHolders: []})};
  });
  assert.equal(requested, 'https://provider.example/v1/tokens/mint/report');
  assert.equal(result.pass, true);
});
