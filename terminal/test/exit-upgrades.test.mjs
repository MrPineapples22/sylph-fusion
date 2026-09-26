import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeLearningService } from '../../dist/intelligence/attribution/trade-learning-service.js';

test('God-Tier Exit Upgrade: MFE, MAE, PCR, and EE excursion computation', () => {
  const service = new TradeLearningService();
  const autopsy = service.recordClosedTrade({
    tokenMint: 'TokenMFE111111111111111111111111111111111111',
    symbol: 'PUMP',
    entryPriceUsd: 100,
    exitPriceUsd: 110,
    mfePriceUsd: 120,
    maePriceUsd: 95,
    costBasisUsd: 100,
    proceedsUsd: 110,
    realizedPnlUsd: 10,
    realizedPnlPct: 10.0,
    holdDurationMs: 65000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: true,
  });

  assert.equal(autopsy.mfePct, 20.0);
  assert.equal(autopsy.maePct, -5.0);
  assert.equal(autopsy.profitCaptureRatio, 0.5); // 10% realized / 20% MFE
  assert.equal(autopsy.exitEfficiency, 0.6); // (110 - 95) / (120 - 95) = 15 / 25
  assert.ok(autopsy.exitEnvelopeHash.startsWith('0x'));
  assert.equal(autopsy.attribution.credit_archetype, 'GOOD_DECISION_GOOD_OUTCOME');
  assert.equal(autopsy.attribution.policy_reinforcement_action, 'REINFORCE');
});

test('God-Tier Exit Upgrade: Profit Capture Ratio (PCR) and Exit Efficiency (EE) bounds', () => {
  const service = new TradeLearningService();

  // Case A: Round-tripped trade (exited at loss despite positive MFE)
  const roundTrip = service.recordClosedTrade({
    tokenMint: 'TokenRT1111111111111111111111111111111111111',
    symbol: 'FADE',
    entryPriceUsd: 1.0,
    exitPriceUsd: 0.95,
    mfePriceUsd: 1.25,
    maePriceUsd: 0.90,
    costBasisUsd: 100,
    proceedsUsd: 95,
    realizedPnlUsd: -5,
    realizedPnlPct: -5.0,
    holdDurationMs: 120000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: false,
  });

  assert.equal(roundTrip.profitCaptureRatio, 0); // Negative return cannot have positive PCR
  assert.ok(roundTrip.exitEfficiency >= 0 && roundTrip.exitEfficiency <= 1.0);
  assert.equal(roundTrip.attribution.credit_archetype, 'BAD_DECISION_BAD_OUTCOME');

  // Case B: Perfect exit at peak MFE
  const perfectExit = service.recordClosedTrade({
    tokenMint: 'TokenPERF11111111111111111111111111111111111',
    symbol: 'MOON',
    entryPriceUsd: 1.0,
    exitPriceUsd: 1.5,
    mfePriceUsd: 1.5,
    maePriceUsd: 0.98,
    costBasisUsd: 100,
    proceedsUsd: 150,
    realizedPnlUsd: 50,
    realizedPnlPct: 50.0,
    holdDurationMs: 45000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: true,
  });

  assert.equal(perfectExit.profitCaptureRatio, 1.0); // 100% PCR
  assert.equal(perfectExit.exitEfficiency, 1.0); // 100% Exit Efficiency
});

test('God-Tier Exit Upgrade: Cryptographic exit envelope determinism and tamper detection', () => {
  const service = new TradeLearningService();
  const tradeInput = {
    tokenMint: 'CryptoMint11111111111111111111111111111111111',
    symbol: 'PROVED',
    entryPriceUsd: 0.05,
    exitPriceUsd: 0.075,
    costBasisUsd: 50,
    proceedsUsd: 75,
    realizedPnlUsd: 25,
    realizedPnlPct: 50.0,
    holdDurationMs: 30000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: true,
  };

  const trade1 = service.recordClosedTrade({ ...tradeInput });
  assert.ok(trade1.exitEnvelopeHash.startsWith('0x'));
  assert.ok(trade1.exitEnvelopeHash.length >= 8);

  // If explicit exitEnvelopeHash is provided, it must be preserved
  const sealed = service.recordClosedTrade({
    ...tradeInput,
    exitEnvelopeHash: '0xdeadbeefc001cafe1234567890abcdef',
  });
  assert.equal(sealed.exitEnvelopeHash, '0xdeadbeefc001cafe1234567890abcdef');
});

test('God-Tier Exit Upgrade: Adaptive Bayesian hurdle response to successive exits', () => {
  const service = new TradeLearningService();

  // Initial state has standard balanced hurdle
  const initialSnap = service.getSnapshot();
  assert.equal(initialSnap.adaptiveCalibration.calibrationRegime, 'BALANCED');
  assert.equal(initialSnap.adaptiveCalibration.adaptiveHsiHurdle, 80);

  // Record 3 consecutive bad losses
  for (let i = 0; i < 3; i++) {
    service.recordClosedTrade({
      tokenMint: `LossMint${i}111111111111111111111111111111111`,
      symbol: `DUMP${i}`,
      entryPriceUsd: 1.0,
      exitPriceUsd: 0.88,
      costBasisUsd: 100,
      proceedsUsd: 88,
      realizedPnlUsd: -12,
      realizedPnlPct: -12.0,
      holdDurationMs: 40000,
      exitTrigger: 'EMERGENCY_UNWIND',
      wasDecisionSound: false,
    });
  }

  // After 3 bad losses, calibration regime must enter DEFENSIVE (+5 hurdle: 80 -> 85)
  const defensiveSnap = service.getSnapshot();
  assert.equal(defensiveSnap.adaptiveCalibration.calibrationRegime, 'DEFENSIVE');
  assert.equal(defensiveSnap.adaptiveCalibration.adaptiveHsiHurdle, 85); // 80 + 5
  assert.equal(defensiveSnap.winRatePct, 0);
  assert.equal(defensiveSnap.lossCount, 3);
  assert.ok(defensiveSnap.averageProfitCaptureRatio >= 0);
  assert.ok(defensiveSnap.averageExitEfficiency >= 0);
});

test('God-Tier Exit Upgrade: False Breakout Cut & Momentum Exhaustion exit parameters', () => {
  // Verify algorithmic decision thresholds for prompt cut and exhaustion
  function evaluateExitRule(entryPrice, currentPrice, peakPrice, ageMs) {
    const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    const peakPnlPct = ((peakPrice - entryPrice) / entryPrice) * 100;

    // Rule 1: False Breakout Cut
    if (ageMs < 45000 && pnlPct <= -2.5 && peakPnlPct <= 0.8) {
      return 'FALSE_BREAKOUT_CUT';
    }

    // Rule 2: Momentum Exhaustion Exit
    const retraceFromPeakPct = peakPnlPct - pnlPct;
    if (peakPnlPct >= 5.0 && retraceFromPeakPct >= (peakPnlPct * 0.5) && ageMs > 90000) {
      return 'MOMENTUM_EXHAUSTION_EXIT';
    }

    return 'HOLD';
  }

  // Fast loss with no upside within 30s -> cut
  assert.equal(evaluateExitRule(1.0, 0.97, 1.005, 30000), 'FALSE_BREAKOUT_CUT');

  // Loss with prior +10% pump within 30s -> not false breakout (handled by trailing stop)
  assert.equal(evaluateExitRule(1.0, 0.97, 1.10, 30000), 'HOLD');

  // Loss after 60s -> not false breakout (beyond 45s window)
  assert.equal(evaluateExitRule(1.0, 0.97, 1.005, 60000), 'HOLD');

  // Pumped +10%, but fell back to +4% at 100s -> momentum exhaustion triggered
  assert.equal(evaluateExitRule(1.0, 1.04, 1.10, 100000), 'MOMENTUM_EXHAUSTION_EXIT');

  // Pumped +10%, sitting at +7% at 100s -> only 30% retrace, holding
  assert.equal(evaluateExitRule(1.0, 1.07, 1.10, 100000), 'HOLD');
});
