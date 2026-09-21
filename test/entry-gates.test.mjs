import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCandidateReserveDrift } from '../dist/fusion.js';

const snapshot = (realQuote = 1_000_000_000n, virtualQuote, virtualToken, complete = false) => {
  const r = BigInt(realQuote);
  return {
    curve: {
      realQuoteReserves: r,
      virtualQuoteReserves: virtualQuote !== undefined ? BigInt(virtualQuote) : 30_000_000_000n + r,
      virtualTokenReserves: virtualToken !== undefined ? BigInt(virtualToken) : 1_073_000_000_000_000n,
      complete,
      isMayhemMode: false,
    },
  };
};

test('reserve drift passes for identical reserves', () => {
  const res = checkCandidateReserveDrift(snapshot(1_000_000_000n), snapshot(1_000_000_000n));
  assert.equal(res.passed, true);
  assert.equal(res.priceDriftBps, 0n);
  assert.equal(res.liquidityDropBps, 0n);
  assert.equal(res.direction, 'none');
});

test('reserve drift permits legitimate candidate accumulation (0.05 SOL buy on 1.0 SOL curve)', () => {
  // s1: 1.0 SOL real, 31.0 SOL virtual, 1,073,000,000 tokens
  const s1 = snapshot(1_000_000_000n, 31_000_000_000n, 1_073_000_000_000_000n);
  // s2 after 0.05 SOL buy: 1.05 SOL real (+500 bps on real reserves!), 31.05 SOL virtual, ~1,071,272,141 tokens
  // Constant product k = 31 * 10^9 * 1.073 * 10^15 = 33,263,000,000,000,000,000,000,000
  // Post tokens = k / 31.05 * 10^9 = 1,071,272,141,706,924
  const s2 = snapshot(1_050_000_000n, 31_050_000_000n, 1_071_272_141_706_924n);
  const res = checkCandidateReserveDrift(s1, s2, 200n, 200n);
  // In the old real-reserve check, this 500 bps real jump was falsely rejected.
  // In the dual-metric check, spot price drift is ~32 bps, which passes cleanly under the 200 bps threshold.
  assert.equal(res.passed, true);
  assert.equal(res.priceDriftBps < 50n, true);
  assert.equal(res.direction, 'up');
});

test('reserve drift accepts movement within configured boundaries', () => {
  // 100 bps upward price movement
  const s1 = snapshot(1_000_000_000n, 30_000_000_000n, 1_000_000_000_000n);
  const s2Up = snapshot(1_000_000_000n, 30_300_000_000n, 1_000_000_000_000n); // 100 bps price up
  assert.equal(checkCandidateReserveDrift(s1, s2Up, 200n, 200n).passed, true);

  // 150 bps real liquidity drop (within 200 bps limit)
  const s2Down = snapshot(985_000_000n, 29_985_000_000n, 1_000_000_000_000n);
  assert.equal(checkCandidateReserveDrift(s1, s2Down, 200n, 200n).passed, true);
});

test('reserve drift rejects excessive upward spot price movement (front-run / sandwich)', () => {
  // 300 bps price spike exceeds 200 bps limit
  const s1 = snapshot(1_000_000_000n, 30_000_000_000n, 1_000_000_000_000n);
  const s2Spike = snapshot(1_100_000_000n, 31_000_000_000n, 1_000_000_000_000n); // ~333 bps price jump
  const res = checkCandidateReserveDrift(s1, s2Spike, 200n, 200n);
  assert.equal(res.passed, false);
  assert.equal(res.reason, 'EXCESSIVE_PRICE_DRIFT');
  assert.equal(res.direction, 'up');
});

test('reserve drift rejects excessive downward liquidity drainage (sniper / creator dump)', () => {
  // Real reserves drop from 1.0 SOL to 0.97 SOL (300 bps drop exceeds 200 bps limit)
  const s1 = snapshot(1_000_000_000n, 31_000_000_000n, 1_073_000_000_000_000n);
  const s2Dump = snapshot(970_000_000n, 30_970_000_000n, 1_074_000_000_000_000n);
  const res = checkCandidateReserveDrift(s1, s2Dump, 200n, 200n);
  assert.equal(res.passed, false);
  assert.equal(res.reason, 'EXCESSIVE_LIQUIDITY_DROP');
  assert.equal(res.direction, 'down');
});

test('reserve drift fails closed for completed or degenerate curves', () => {
  assert.equal(checkCandidateReserveDrift(snapshot(1_000_000_000n), snapshot(1_000_000_000n, undefined, undefined, true)).reason, 'CURVE_COMPLETED');
  assert.equal(checkCandidateReserveDrift(snapshot(0n), snapshot(1_000_000_000n)).reason, 'ZERO_RESERVES');
  assert.equal(checkCandidateReserveDrift(snapshot(1_000_000_000n), snapshot(0n)).reason, 'ZERO_RESERVES');
  assert.equal(checkCandidateReserveDrift(snapshot(1_000_000_000n, 0n), snapshot(1_000_000_000n)).reason, 'ZERO_RESERVES');
  assert.equal(checkCandidateReserveDrift(snapshot(1_000_000_000n, 31_000_000_000n, 0n), snapshot(1_000_000_000n)).reason, 'ZERO_RESERVES');
});
