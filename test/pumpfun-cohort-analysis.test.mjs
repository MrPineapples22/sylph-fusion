import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePumpfunCohorts } from '../scripts/analyze-pumpfun-cohorts.mjs';

const dataset = {
  schemaVersion: 1,
  range: { start: '2026-01-01T00:00:00Z', endExclusive: '2026-02-01T00:00:00Z' },
  coverage: { completeForRange: false, notes: ['Fixture intentionally partial'] },
  launches: [
    { mint: 'A', createdAt: '2026-01-01T00:00:00Z', source: 'fixture' },
    { mint: 'B', createdAt: '2026-01-31T12:00:00Z', source: 'fixture' },
  ],
  events: [
    { eventId: 'a-trade', mint: 'A', observedAt: '2026-01-01T01:00:00Z', kind: 'TRADE', marketCapUsd: 100, source: 'fixture' },
    { eventId: 'a-peak', mint: 'A', observedAt: '2026-01-01T02:00:00Z', kind: 'TRADE', marketCapUsd: 900, source: 'fixture' },
    { eventId: 'a-grad', mint: 'A', observedAt: '2026-01-01T23:59:59Z', kind: 'GRADUATION', source: 'fixture' },
    { eventId: 'a-settled', mint: 'A', observedAt: '2026-01-02T00:00:00Z', kind: 'SETTLED_EXECUTION', realizedNetPnlUsd: -12.5, source: 'fixture' },
    { eventId: 'b-grad', mint: 'B', observedAt: '2026-01-31T20:00:00Z', kind: 'GRADUATION', source: 'fixture' },
  ],
};

test('keeps all-launch denominator, 24h maturity, observed peak, and settled P&L separate', () => {
  const result = analyzePumpfunCohorts(dataset);
  const january = result.cohorts[0];
  assert.equal(january.launched, 2);
  assert.equal(january.mature24h, 1);
  assert.equal(january.tradedObserved, 1);
  assert.equal(january.graduatedWithin24h, 1);
  assert.equal(january.graduationWithin24hRateOfMatureLaunches, 1);
  assert.equal(january.observedTradeRateOfAllLaunches, 0.5);
  assert.equal(january.observedPeakMarketCapUsd, 900);
  assert.equal(january.settledRealizedNetPnlUsd, -12.5);
  assert.equal(january.completeness, 'PARTIAL_UNVERIFIED');
  assert.equal(result.authority, 'RESEARCH_ONLY_NO_TRADING_AUTHORITY');
});

test('does not infer zero activity from missing observations or accept duplicate event IDs', () => {
  const noActivity = { ...dataset, launches: [dataset.launches[0]], events: [] };
  assert.equal(analyzePumpfunCohorts(noActivity).cohorts[0].tradedObserved, 0);
  assert.equal(analyzePumpfunCohorts(noActivity).cohorts[0].completeness, 'PARTIAL_UNVERIFIED');
  const duplicate = { ...dataset, events: [...dataset.events, { ...dataset.events[0], mint: 'B' }] };
  assert.throws(() => analyzePumpfunCohorts(duplicate), { message: 'INVALID_LIFECYCLE_EVENT' });
});

test('rejects unprovenanced events and invalid settled outcomes', () => {
  const missingSource = { ...dataset, events: [{ ...dataset.events[0], source: '' }] };
  assert.throws(() => analyzePumpfunCohorts(missingSource), { message: 'INVALID_LIFECYCLE_EVENT' });
  const badPnl = { ...dataset, events: [{ ...dataset.events[3], realizedNetPnlUsd: 'unknown' }] };
  assert.throws(() => analyzePumpfunCohorts(badPnl), { message: 'INVALID_SETTLED_PNL' });
});
