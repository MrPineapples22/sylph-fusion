import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  HelixStrategyCanaryAuthority
} from '../../dist/intelligence/control/helix-strategy-canary.js';

describe('HELIX: Economic Canary & Controlled Strategy Experiment Authority (Upgrade 8)', () => {
  it('enforces zero real capital for pre-canary stages and promotes on positive LCB', () => {
    const helix = new HelixStrategyCanaryAuthority();
    const strat = helix.registerStrategy('STRAT_MOMENTUM_PUMP', 'SHADOW');

    assert.equal(strat.stage, 'SHADOW');
    assert.equal(strat.maxCapitalAllocationLamports, 0n);
    assert.equal(strat.isRealCapitalAllowed, false);

    // Provide evidence of 15 successful shadow trades
    const res = helix.evaluateStrategyRollout('STRAT_MOMENTUM_PUMP', {
      strategyId: 'STRAT_MOMENTUM_PUMP',
      tradeCount: 15,
      winRatePct: 66,
      realizedNetPnlLamports: 150_000_000n,
      meanNetPnlLamports: 10_000_000n,
      lowerConfidenceBoundLamports: 5_000_000n,
      maxDrawdownBps: 450, // 4.5% DD
      executionShortfallBps: 20,
      regimeDiversityScore: 0.8
    });

    assert.equal(res.action, 'PROMOTED');
    assert.equal(res.nextStage, 'OBSERVE_ONLY');
    const updated = helix.getStrategyStatus('STRAT_MOMENTUM_PUMP');
    assert.equal(updated?.stage, 'OBSERVE_ONLY');
    assert.equal(updated?.promotionCount, 1);
  });

  it('triggers emergency demotion to SHADOW on drawdown breach or negative LCB', () => {
    const helix = new HelixStrategyCanaryAuthority();
    // Start at TINY_CANARY
    helix.registerStrategy('STRAT_RISKY', 'TINY_CANARY');
    const strat = helix.getStrategyStatus('STRAT_RISKY');
    assert.equal(strat?.maxCapitalAllocationLamports, 50_000_000n); // 0.05 SOL

    // Sudden drawdown breach: 15% drawdown (> 12% threshold)
    const demoteRes = helix.evaluateStrategyRollout('STRAT_RISKY', {
      strategyId: 'STRAT_RISKY',
      tradeCount: 25,
      winRatePct: 40,
      realizedNetPnlLamports: -20_000_000n,
      meanNetPnlLamports: -800_000n,
      lowerConfidenceBoundLamports: -5_000_000n,
      maxDrawdownBps: 1500, // 15% breach!
      executionShortfallBps: 120,
      regimeDiversityScore: 0.5
    });

    assert.equal(demoteRes.action, 'DEMOTED');
    assert.equal(demoteRes.nextStage, 'SHADOW');
    const updated = helix.getStrategyStatus('STRAT_RISKY');
    assert.equal(updated?.stage, 'SHADOW');
    assert.equal(updated?.maxCapitalAllocationLamports, 0n);
    assert.equal(updated?.isRealCapitalAllowed, false);
    assert.equal(updated?.demotionCount, 1);
  });
});
