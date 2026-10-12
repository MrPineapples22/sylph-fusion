import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decideExit, protectiveStop } from '../dist/exit-policy.js';

describe('ELITE UPDATE 3: Volatility-Adaptive Take-Profit Ladder & Guaranteed Profit Ratchets', () => {
  const baseInput = {
    entry: 100,
    mark: 100,
    peak: 100,
    stage: 0,
    openedAt: 1_000_000,
    now: 1_010_000,
    stopBps: 1200, // 12%
    markAt: 1_010_000,
    maxMarkAgeMs: 5000,
  };

  it('1. High volatility token widens targets to allow moonshots room to expand', () => {
    // High ATR volatility (0.15 = 15%)
    const highVolInput = {
      ...baseInput,
      atrVolatility: 0.15,
      mark: 115, // +15% gain
      peak: 115,
    };

    // Under standard targets (1.12), +15% would exit. Under high vol targets ([1.20, 1.50, ...]), +15% does NOT trigger TAKE_PROFIT
    const dec15 = decideExit(highVolInput);
    assert.equal(dec15, null, 'High volatility token must not be prematurely cut off at +15%');

    // Price expands to +22% (122) -> Reaches widened Target 1 (1.20)
    const dec22 = decideExit({
      ...highVolInput,
      mark: 122,
      peak: 122,
    });
    assert.ok(dec22, 'Must trigger TAKE_PROFIT_1 at +22%');
    assert.equal(dec22.reason, 'TAKE_PROFIT_1');
    assert.equal(dec22.fractionBps, 5000, '50% scale-out to make runner risk-free');
    assert.equal(dec22.nextStage, 1);
    assert.ok(dec22.protectiveStop >= 100, 'Protective stop moves to breakeven or above');
  });

  it('2. Low volatility token compresses targets to harvest early profit before volume decays', () => {
    // Low ATR volatility (0.03 = 3%)
    const lowVolInput = {
      ...baseInput,
      atrVolatility: 0.03,
      mark: 109, // +9% gain
      peak: 109,
    };

    // Under standard targets (1.12), +9% would do nothing. Under compressed targets ([1.08, 1.16, ...]), +9% secures profit!
    const dec = decideExit(lowVolInput);
    assert.ok(dec, 'Must trigger TAKE_PROFIT_1 on compressed targets at +9%');
    assert.equal(dec.reason, 'TAKE_PROFIT_1');
    assert.equal(dec.nextStage, 1);
  });

  it('3. Staged monotonic profit ratchets guarantee locked profits across subsequent stages', () => {
    // Stage 1 -> Stage 2: Entry = 100, Mark = 126 (+26% gain)
    const stage1Input = {
      ...baseInput,
      stage: 1,
      mark: 126,
      peak: 126,
    };
    const decStage2 = decideExit(stage1Input);
    assert.ok(decStage2);
    assert.equal(decStage2.reason, 'TAKE_PROFIT_2');
    assert.equal(decStage2.nextStage, 2);
    assert.ok(decStage2.protectiveStop >= 102, 'Stage 2 entry must lock in at least breakeven + 2% fees (>= 102)');

    // Stage 2 -> Stage 3: Entry = 100, Mark = 152 (+52% gain)
    const stage2Input = {
      ...baseInput,
      stage: 2,
      mark: 152,
      peak: 152,
    };
    const decStage3 = decideExit(stage2Input);
    assert.ok(decStage3);
    assert.equal(decStage3.reason, 'TAKE_PROFIT_3');
    assert.equal(decStage3.nextStage, 3);
    assert.ok(decStage3.protectiveStop >= 110, 'Stage 3 entry must lock in at least +10% profit (>= 110)');

    // Stage 3 -> Stage 4: Entry = 100, Mark = 205 (+105% gain)
    const stage3Input = {
      ...baseInput,
      stage: 3,
      mark: 205,
      peak: 205,
    };
    const decStage4 = decideExit(stage3Input);
    assert.ok(decStage4);
    assert.equal(decStage4.reason, 'TAKE_PROFIT_4');
    assert.equal(decStage4.nextStage, 4);
    assert.ok(decStage4.protectiveStop >= 125, 'Stage 4 entry must lock in at least +25% profit (>= 125)');
  });

  it('4. Default volatility preserves baseline canonical ladder', () => {
    // No atrVolatility provided -> standard targets [1.12, 1.25, 1.5, 2.0]
    const defInput11 = { ...baseInput, mark: 111, peak: 111 };
    assert.equal(decideExit(defInput11), null, 'At 1.11, default ladder does not trigger');

    const defInput13 = { ...baseInput, mark: 113, peak: 113 };
    const dec = decideExit(defInput13);
    assert.ok(dec);
    assert.equal(dec.reason, 'TAKE_PROFIT_1');
  });
});
