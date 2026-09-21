import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePaperVsBaselineComparison,
  aggregateSessionStats,
  evaluateFilterAlpha,
} from '../src/paper-baseline-eval.js';

test('aggregateSessionStats correctly calculates net P&L after friction, win rate, and drawdown', () => {
  const outcomes = [
    {
      candidateId: 'c1',
      costBasisLamports: '100000000',     // 0.1 SOL
      grossProceedsLamports: '125000000', // 0.125 SOL (+25%)
      dexImpactLamports: '1000000',
      priorityFeeLamports: '200000',
      jitoTipLamports: '10000',
      ataRentLamports: '0',
      frictionTotalLamports: '1210000',
      netReturnLamports: '23790000',     // +0.02379 SOL
      observationDurationMs: 40000,
      censored: false,
      terminalState: 'take_profit',
      exitStage: 1,
    },
    {
      candidateId: 'c2',
      costBasisLamports: '100000000',
      grossProceedsLamports: '90000000',  // 0.09 SOL (-10%)
      dexImpactLamports: '800000',
      priorityFeeLamports: '200000',
      jitoTipLamports: '10000',
      ataRentLamports: '0',
      frictionTotalLamports: '1010000',
      netReturnLamports: '-11010000',    // -0.01101 SOL
      observationDurationMs: 20000,
      censored: false,
      terminalState: 'stop_loss',
      exitStage: 0,
    },
    {
      candidateId: 'c3',
      costBasisLamports: '100000000',
      grossProceedsLamports: '102000000',
      frictionTotalLamports: '0',
      netReturnLamports: '2000000',
      observationDurationMs: 15000,
      censored: true, // Right-censored!
      terminalState: 'censored_at_cutoff',
      exitStage: 0,
    },
  ];

  const stats = aggregateSessionStats(outcomes, [], 150);

  assert.equal(stats.tradeCount, 3);
  assert.equal(stats.resolvedTrades, 2);
  assert.equal(stats.winsCount, 1);
  assert.equal(stats.lossesCount, 1);
  assert.equal(stats.censoredCount, 1);
  assert.equal(stats.winRatePct, 50.0);
  assert.equal(stats.costBasisSol, 0.2);
  assert.equal(stats.grossProceedsSol, 0.215);
  assert.equal(stats.frictionTotalSol, 0.00222);

  // Net return = 23790000 - 11010000 + 2000000 = 14780000 lamports = 0.01478 SOL
  assert.equal(Number(stats.netReturnSol.toFixed(5)), 0.01278);
  assert.equal(stats.profitFactor > 1.5, true);
  assert.equal(stats.exitStages.tp1, 1);
  assert.equal(stats.exitStages.stop_loss, 1);
  assert.equal(stats.exitStages.censored, 1);
});

test('evaluateFilterAlpha attributes avoided losses vs missed upside for rejected candidates', () => {
  const candidates = [
    // 1. Rejected rug/dump token: drift > 2%
    {
      mint: 'Rug1',
      evaluationDisposition: 'rejected',
      curveState: { reserveDriftPct: 3.5, curveCompletionPct: 15 },
      microstructure: { buyerCount5m: 4 },
    },
    // 2. Rejected runner: high buyers and low drift
    {
      mint: 'Runner1',
      evaluationDisposition: 'rejected',
      curveState: { reserveDriftPct: 0.1, curveCompletionPct: 20 },
      microstructure: { buyerCount5m: 18 },
    },
    // 3. Cleared candidate (must not enter filter alpha calculation)
    {
      mint: 'Cleared1',
      evaluationDisposition: 'cleared',
      curveState: { reserveDriftPct: 0.2, curveCompletionPct: 10 },
      microstructure: { buyerCount5m: 12 },
    },
  ];

  const alpha = evaluateFilterAlpha({ candidates, solPriceUsd: 150 });

  assert.equal(alpha.rejectedCount, 2);
  assert.equal(alpha.available, false);
  assert.equal(alpha.avoidedLossSol, null);
  assert.equal(alpha.missedUpsideSol, null);
  assert.equal(alpha.netFilterAlphaSol, null);
  assert.equal(alpha.filterAlphaPositive, null);
});

test('evaluatePaperVsBaselineComparison calculates relative delta between paper and baseline', () => {
  const outcomes = [
    {
      candidateId: 'c1',
      costBasisLamports: '100000000',
      grossProceedsLamports: '130000000',
      frictionTotalLamports: '1000000',
      netReturnLamports: '29000000',
      observationDurationMs: 30000,
      censored: false,
      exitStage: 1,
    },
  ];

  const res = evaluatePaperVsBaselineComparison({
    outcomes,
    baselineSession: { outcomes },
    solPriceUsd: 150,
    rollingDrawdownCapPct: 8.0,
  });

  assert.ok(res.paper);
  assert.ok(res.baseline);
  assert.ok(res.deltas);
  assert.equal(res.drawdownStatus.breached, false);
  assert.equal(res.drawdownStatus.capPct, 8.0);
  assert.equal(typeof res.deltas.paperOutperformed, 'boolean');
});

test('evaluatePaperVsBaselineComparison flags small sample, censored tokens, and model unavailable candidates prominently', () => {
  const outcomes = [
    {
      candidateId: 'c1',
      costBasisLamports: '10000000',
      grossProceedsLamports: '12000000',
      frictionTotalLamports: '100000',
      netReturnLamports: '1900000',
      censored: false,
      exitStage: 1,
    },
    {
      candidateId: 'c2',
      costBasisLamports: '10000000',
      grossProceedsLamports: '10000000',
      frictionTotalLamports: '0',
      netReturnLamports: '0',
      censored: true, // Right-censored
      terminalState: 'censored_at_cutoff',
    },
  ];

  const candidates = [
    { mint: 'c1', evaluationDisposition: 'cleared' },
    { mint: 'c2', evaluationDisposition: 'cleared' },
    { mint: 'c3', evaluationDisposition: 'modelUnavailable' },
    { mint: 'c4', evaluationDisposition: 'rejected' },
  ];

  const res = evaluatePaperVsBaselineComparison({
    outcomes,
    candidates,
    solPriceUsd: 150,
  });

  assert.ok(res.sampleValidity);
  assert.equal(res.sampleValidity.isSmallSample, true);
  assert.equal(res.sampleValidity.isPreliminary, true);
  assert.equal(res.sampleValidity.totalTrades, 2);
  assert.equal(res.sampleValidity.resolvedTrades, 1);
  assert.equal(res.sampleValidity.censoredCount, 1);
  assert.equal(res.sampleValidity.modelUnavailableCount, 1);
  assert.equal(res.sampleValidity.rejectedCount, 1);
  assert.match(res.sampleValidity.warningTitle, /PRELIMINARY DATASET/);
  assert.match(res.sampleValidity.warningMessage, /NOT represent statistical proof of trading profitability/);
  assert.match(res.sampleValidity.censoredNotice, /right-censored and excluded/);
  assert.match(res.sampleValidity.unavailableNotice, /fail-closed as model-unavailable/);
});
