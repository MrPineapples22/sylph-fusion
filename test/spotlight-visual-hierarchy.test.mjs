import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverySnapshot, DISCOVERY_FRESH_MS } from '../dist/discovery.js';

// Shared helpers
const baseToken = (mint, overrides = {}) => ({
  mint,
  symbol: mint.slice(0, 4).toUpperCase(),
  name: `Token ${mint}`,
  price: 0.001,
  liquidity: 50000,
  volume: 12000,
  cap: 100000,
  at: Date.now(),
  ...overrides,
});

const baseRisk = (mint, overrides = {}) => ({
  mint,
  at: Date.now(),
  safe: true,
  rugged: false,
  authorities: { status: 'revoked', freeze: false },
  holders: { top10Status: 'within-limit', top10Bps: 500 },
  bundling: { state: 'clear', insiders: 0 },
  liquidity: { state: 'locked', lockedPct: 95 },
  ...overrides,
});

const baseSignal = (mint, overrides = {}) => ({
  mint,
  at: Date.now(),
  version: '1.0',
  source: 'metron',
  highSignalIndex: 90,
  pod: 'UP',
  confidence: 0.9,
  devDump: false,
  bundler: false,
  ...overrides,
});

test('PRIME tier remains observational: strong signals do not assert token safety', () => {
  const now = Date.now();
  const mint = 'PRIMEtestMint111111111111111111111111111111';
  const result = discoverySnapshot({
    tokens: [baseToken(mint, { at: now })],
    risks: new Map([[mint, baseRisk(mint, { at: now })]]),
    signals: new Map([[mint, baseSignal(mint, { at: now, highSignalIndex: 90, pod: 'UP', confidence: 0.9 })]]),
    feedStale: false,
    mode: 'paper',
    positions: [],
    now,
  });

  const row = result.rows.find(r => r.mint === mint);
  assert.equal(row.tier, 'PRIME', 'Token should be PRIME tier');
  assert.equal(row.highSignalIndex, 90);
  assert.equal(row.pod, 'UP');
  assert.equal(row.vetoes.length, 0, 'PRIME must have zero vetoes');
  assert.equal(row.safety, 'UNKNOWN');
  assert.equal(row.outcome.tokenSafety, 'UNKNOWN');
  assert.equal(row.liquidityLocked, true);
  assert.equal(row.mintRevoked, true);
});

test('provider safety finding quarantines without asserting a protected veto', () => {
  const now = Date.now();
  const mint = 'VETOtestMint2222222222222222222222222222222';
  const result = discoverySnapshot({
    tokens: [baseToken(mint, { at: now })],
    risks: new Map([[mint, baseRisk(mint, { at: now, safe: false })]]),
    signals: new Map([[mint, baseSignal(mint, { at: now })]]),
    feedStale: false,
    mode: 'paper',
    positions: [],
    now,
  });

  const row = result.rows.find(r => r.mint === mint);
  assert.equal(row.tier, 'QUARANTINED');
  assert.equal(row.outcome.tokenSafety, 'UNKNOWN');
  assert.ok(row.vetoes.some(v => v.includes('unsafe')), 'Observed finding should be retained for investigation');
});

test('Stale feed quarantines new entry without token guilt', () => {
  const now = Date.now();
  const mint = 'STALEtestMint33333333333333333333333333333333';
  const result = discoverySnapshot({
    tokens: [baseToken(mint, { at: now })],
    risks: new Map([[mint, baseRisk(mint, { at: now })]]),
    signals: new Map([[mint, baseSignal(mint, { at: now })]]),
    feedStale: true,
    mode: 'paper',
    positions: [],
    now,
  });

  const row = result.rows.find(r => r.mint === mint);
  assert.equal(row.tier, 'QUARANTINED');
  assert.equal(row.outcome.tokenSafety, 'UNKNOWN');
  assert.ok(row.vetoes.some(v => v.includes('STALE')), 'Observation should retain the stale-feed reason');
});

test('Token with HSI < 80 remains DEVELOPING even with clean safety', () => {
  const now = Date.now();
  const mint = 'DEVELtestMint44444444444444444444444444444444';
  const result = discoverySnapshot({
    tokens: [baseToken(mint, { at: now })],
    risks: new Map([[mint, baseRisk(mint, { at: now })]]),
    signals: new Map([[mint, baseSignal(mint, { at: now, highSignalIndex: 60 })]]),
    feedStale: false,
    mode: 'paper',
    positions: [],
    now,
  });

  const row = result.rows.find(r => r.mint === mint);
  assert.equal(row.tier, 'DEVELOPING', 'HSI < 80 should be DEVELOPING');
  assert.equal(row.highSignalIndex, 60);
});

test('Discovery snapshot includes reconciliationStatus field', () => {
  const now = Date.now();
  const result = discoverySnapshot({
    tokens: [],
    risks: new Map(),
    signals: new Map(),
    feedStale: false,
    mode: 'paper',
    positions: [],
    now,
  });

  assert.ok('reconciliationStatus' in result, 'Snapshot must include reconciliationStatus');
  assert.equal(result.reconciliationStatus, 'UNKNOWN', 'An empty discovery feed cannot prove financial reconciliation');
  assert.equal(result.freshnessGateMs, DISCOVERY_FRESH_MS, 'Must expose freshness gate threshold');
});

test('Market staleness does not substitute for ledger reconciliation evidence', () => {
  const now = Date.now();
  const result = discoverySnapshot({
    tokens: [],
    risks: new Map(),
    signals: new Map(),
    feedStale: true,
    mode: 'paper',
    positions: [],
    now,
  });

  assert.equal(result.reconciliationStatus, 'UNKNOWN');
});

test('DISCOVERY_FRESH_MS enforces strict <= 5s temporal firewall', () => {
  assert.equal(DISCOVERY_FRESH_MS, 5000, 'Freshness gate must be exactly 5000ms');
});

test('Token observation older than 5s quarantines rather than vetoes', () => {
  const now = Date.now();
  const mint = 'OLDOBtestMint55555555555555555555555555555555';
  const result = discoverySnapshot({
    tokens: [baseToken(mint, { at: now - 6000 })],
    risks: new Map([[mint, baseRisk(mint, { at: now })]]),
    signals: new Map([[mint, baseSignal(mint, { at: now })]]),
    feedStale: false,
    mode: 'paper',
    positions: [],
    now,
  });

  const row = result.rows.find(r => r.mint === mint);
  assert.equal(row.tier, 'QUARANTINED');
  assert.equal(row.outcome.tokenSafety, 'UNKNOWN');
  assert.ok(row.vetoes.some(v => v.includes('stale')));
});

test('Sorting: PRIME tokens appear before DEVELOPING before QUARANTINED', () => {
  const now = Date.now();
  const primeMint = 'SORTPrime1111111111111111111111111111111111';
  const devMint = 'SORTDevel2222222222222222222222222222222222';
  const vetoMint = 'SORTVeto33333333333333333333333333333333333';
  const result = discoverySnapshot({
    tokens: [
      baseToken(vetoMint, { at: now }),
      baseToken(devMint, { at: now }),
      baseToken(primeMint, { at: now }),
    ],
    risks: new Map([
      [primeMint, baseRisk(primeMint, { at: now })],
      [devMint, baseRisk(devMint, { at: now })],
      [vetoMint, baseRisk(vetoMint, { at: now, safe: false })],
    ]),
    signals: new Map([
      [primeMint, baseSignal(primeMint, { at: now, highSignalIndex: 90 })],
      [devMint, baseSignal(devMint, { at: now, highSignalIndex: 50 })],
      [vetoMint, baseSignal(vetoMint, { at: now })],
    ]),
    feedStale: false,
    mode: 'paper',
    positions: [],
    now,
  });

  assert.equal(result.rows[0].tier, 'PRIME');
  assert.equal(result.rows[1].tier, 'DEVELOPING');
  assert.equal(result.rows[2].tier, 'QUARANTINED');
});
