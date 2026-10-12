import test from 'node:test';
import assert from 'node:assert/strict';
import { decideExit, protectiveStop } from '../dist/exit-policy.js';

test('GOD-TIER EXIT EXCELLENCE 50: Moonshot Profit Maximization & Capital Preservation Controls', async (t) => {
  const base = {
    entry: 100,
    mark: 100,
    peak: 100,
    stage: 0,
    openedAt: 1_000_000,
    now: 1_030_000,
    stopBps: 1200, // -12%
    markAt: 1_030_000,
    maxMarkAgeMs: 5000,
  };

  await t.test('1. BREAKEVEN_PROTECT: Profitable trade reaching +8% cannot decay into negative loss', () => {
    // Reached +8% peak (108), now drops to 100.5 (below breakeven threshold of 100.8)
    const pullback = decideExit({
      ...base,
      peak: 108,
      mark: 100.5,
    });

    assert.ok(pullback, 'Must trigger exit decision on pullback');
    assert.equal(pullback.reason, 'BREAKEVEN_PROTECT');
    assert.equal(pullback.fractionBps, 10_000);
    assert.ok(pullback.protectiveStop >= 100, 'Protective stop must protect capital at or above entry');
  });

  await t.test('2. Dynamic Staged Moonshot Ratchets scale to +1,000%, +2,000%, and +10,000% PnL', () => {
    // 10x Runner (+1,000% / peakRatio = 11.0)
    const stop10x = protectiveStop({ entry: 1.0, peak: 11.0, stopBps: 1200 });
    assert.ok(stop10x >= 7.15, '10x runner must lock in at least 7.15x trailing/staged floor');

    // 20x Runner (+2,000% / peakRatio = 21.0)
    const stop20x = protectiveStop({ entry: 1.0, peak: 21.0, stopBps: 1200 });
    assert.ok(stop20x >= 14.7, '20x runner must lock in at least 14.7x trailing/staged floor');

    // 100x Runner (+10,000% / peakRatio = 101.0)
    const stop100x = protectiveStop({ entry: 1.0, peak: 101.0, stopBps: 1200 });
    assert.ok(stop100x >= 70.0, '100x runner must lock in at least 70x floor (+6,900% locked PnL)');
  });

  await t.test('3. DEV_DUMP_BAILOUT (Control 36): Creator dump triggers instant 0-second bailout', () => {
    const devDump = decideExit({
      ...base,
      devDumped: true,
      mark: 105,
      peak: 110,
    });

    assert.ok(devDump);
    assert.equal(devDump.reason, 'DEV_DUMP_BAILOUT');
    assert.equal(devDump.emergency, true);
    assert.equal(devDump.fractionBps, 10_000);
  });

  await t.test('4. LIQUIDITY_SHOCK (Control 37): >=15% reserve drop triggers immediate exit', () => {
    const shock = decideExit({
      ...base,
      reserveDropPct: 0.18,
      mark: 99,
      peak: 102,
    });

    assert.ok(shock);
    assert.equal(shock.reason, 'LIQUIDITY_SHOCK');
    assert.equal(shock.emergency, true);
    assert.equal(shock.fractionBps, 10_000);
  });

  await t.test('5. ADVERSE_FLOW_TOXICITY (Control 38): Consecutive sell blocks & pressure trigger exit', () => {
    const toxicity = decideExit({
      ...base,
      consecutiveSellBlocks: 5,
      sellPressureRatio: 0.85,
      mark: 98,
      peak: 104,
    });

    assert.ok(toxicity);
    assert.equal(toxicity.reason, 'ADVERSE_FLOW_TOXICITY');
    assert.equal(toxicity.emergency, true);
  });

  await t.test('6. FALSE_BREAKOUT (Control 44): Quick cut within 45s if peak < 1.2% and loss >= 2.5%', () => {
    const falseBreak = decideExit({
      ...base,
      now: 1_020_000, // 20s old
      markAt: 1_020_000,
      peak: 101, // Peak barely +1%
      mark: 97.4, // Drop -2.6%
    });

    assert.ok(falseBreak);
    assert.equal(falseBreak.reason, 'FALSE_BREAKOUT');
    assert.equal(falseBreak.emergency, true);
    assert.equal(falseBreak.fractionBps, 10_000);
  });

  await t.test('7. MOMENTUM_EXHAUSTION (Control 39): 90s without new high & velocity drop exits before decay', () => {
    const exhaustion = decideExit({
      ...base,
      stage: 4, // Staged scale-outs already completed
      openedAt: 1_000_000,
      lastPeakAt: 1_000_000,
      now: 1_100_000, // 100s since peak (> 90s)
      markAt: 1_100_000,
      peak: 140, // Reached +40%
      mark: 130, // Now 130 (<= 140 * 0.95 = 133)
      buyVelocity: 0.8, // Low buy velocity (< 2.0)
    });

    assert.ok(exhaustion);
    assert.equal(exhaustion.reason, 'MOMENTUM_EXHAUSTION');
    assert.equal(exhaustion.fractionBps, 10_000);
  });
});
