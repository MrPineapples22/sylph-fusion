/**
 * SYLPH FUSION — RESEARCH & ANTI-PORTFOLIO SCIENCE TEST SUITE
 * Covers: Planner-X Multi-World Simulation, Capital-Time Economics,
 *         Anti-Portfolio Ledger, and Filter Marginal Value Attribution
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PlannerXResearchEngine } from '../../dist/intelligence/planning/planner-x-research.js';
import { CapitalTimeLedger } from '../../dist/intelligence/economics/capital-time-ledger.js';
import { AntiPortfolioLedger } from '../../dist/intelligence/forensics/anti-portfolio-ledger.js';
import { FilterMarginalValueEngine } from '../../dist/intelligence/forensics/filter-marginal-value.js';

test('Planner-X: Evaluates 14 counterfactual stress worlds without claiming probability-based CVaR', () => {
  const engine = new PlannerXResearchEngine();

  const report = engine.evaluateCandidate({
    candidateId: 'cand_sol_usdc_01',
    tokenMint: 'TokenMint11111111111111111111111111111111111',
    proposedNotionalLamports: 1_000_000_000n, // 1 SOL
    poolLiquidityLamports: 100_000_000_000n, // 100 SOL (healthy pool)
    expectedReturnBps: 250,
    targetRegime: 'TRENDING_BULL',
  });

  assert.equal(report.evaluatedWorldsCount, 14);
  assert.ok(report.safeContinuationPct >= 0.70);
  assert.equal(report.tailScenarioCount, 2);
  assert.ok(report.worstTailScenarioMeanReturnBps < 0);
  assert.ok(report.minimumLiquidationValueLamports >= 0n);
  assert.ok(report.advisoryReportId.startsWith('planner_'));

  // Test fragile candidate in illiquid pool
  const fragileReport = engine.evaluateCandidate({
    candidateId: 'cand_fragile_01',
    tokenMint: 'FragileMint11111111111111111111111111111111',
    proposedNotionalLamports: 5_000_000_000n, // 5 SOL
    poolLiquidityLamports: 6_000_000_000n, // 6 SOL (critically illiquid)
    expectedReturnBps: 100,
    targetRegime: 'HIGH_VOLATILITY',
  });

  assert.equal(fragileReport.isSafeToPropose, false);
  assert.ok(fragileReport.advisoryVetoReasons.some((r) => r.includes('LOW_SAFE_CONTINUATION')));
});

test('Planner-X: Preserves exact lamport comparisons beyond JavaScript safe integers', () => {
  const engine = new PlannerXResearchEngine();
  const report = engine.evaluateCandidate({
    candidateId: 'large-lamport-boundary',
    tokenMint: 'TokenMint11111111111111111111111111111111111',
    proposedNotionalLamports: 10_000_000_000_000_001n,
    // After a 10% shock this is exactly 5x notional, so strict `>` is false.
    poolLiquidityLamports: 55_555_555_555_555_562n,
    expectedReturnBps: 100,
    targetRegime: 'TEST',
  });

  assert.equal(report.worldOutcomes[0].worldType, 'LIQUIDITY_DROP_10');
  assert.equal(report.worldOutcomes[0].survivable, false);
});

test('Planner-X: Rejects malformed candidate context instead of generating a report', () => {
  const engine = new PlannerXResearchEngine();
  assert.throws(() => engine.evaluateCandidate({
    candidateId: 'invalid-notional',
    tokenMint: 'TokenMint11111111111111111111111111111111111',
    proposedNotionalLamports: 0n,
    poolLiquidityLamports: 1_000_000_000n,
    expectedReturnBps: 100,
    targetRegime: 'TEST',
  }), /PLANNER_X_INVALID_CANDIDATE_CONTEXT/);
  assert.throws(() => engine.evaluateCandidate({
    candidateId: 'invalid-return',
    tokenMint: 'TokenMint11111111111111111111111111111111111',
    proposedNotionalLamports: 1_000_000_000n,
    poolLiquidityLamports: 1_000_000_000n,
    expectedReturnBps: Number.NaN,
    targetRegime: 'TEST',
  }), /PLANNER_X_INVALID_CANDIDATE_CONTEXT/);
});

test('Capital-Time Economics: Computes lamport-seconds and capital velocity metrics', () => {
  const ledger = new CapitalTimeLedger();

  const metrics = ledger.recordTradeLifecycle({
    tradeId: 'trade_001',
    economicFactId: 'fact_001',
    reservedAtMs: 10_000,
    signedAtMs: 11_000,
    landedAtMs: 12_000,
    settledAtMs: 15_000,
    unencumberedAtMs: 15_000,
    reservedLamports: 1_000_000_000n,
    investedLamports: 1_000_000_000n,
    unknownLamports: 500_000_000n,
    realizedNetProceedsLamports: 1_050_000_000n, // +5% net
    totalFrictionLamports: 10_000_000n,
  });

  assert.equal(metrics.status, 'RESEARCH_ONLY');
  assert.ok(metrics.totalLamportSeconds > 0n);
  assert.equal(metrics.timeToCashMs, 5000);
  assert.equal(metrics.timeToFinalSettlementMs, 5000);
  assert.ok(metrics.capitalTimeEfficiencyPerSecondBps > 0);
  assert.equal(ledger.getMetrics('trade_001')?.tradeId, 'trade_001');
});

test('Anti-Portfolio: Tracks rejected trades, computes loss avoided vs regret', () => {
  const ledger = new AntiPortfolioLedger();

  // 1. High-value catch: Avoided a rug pull
  ledger.recordRejection({
    candidateId: 'cand_rug_01',
    tokenMint: 'RugMint111111111111111111111111111111111111',
    filterName: 'TOKEN_SEMANTICS_FREEZE_GUARD',
    rejectionReason: 'Freeze authority active',
    rejectedAt: Date.now() - 3600_000,
    knowledgeCutRoot: 'cut_01',
    shadowEntryPriceLamports: 1_000_000_000n,
    shadowEntryFeasible: true,
    shadowSafetyOutcome: 'RUGGED',
    shadowExecutableExitFeasible: false,
    shadowMaturedPnLBps: -10_000, // 100% loss avoided
    shadowHoldingDurationMs: 60_000,
  });

  // 2. High-value catch: Avoided liquidity trap
  ledger.recordRejection({
    candidateId: 'cand_trap_01',
    tokenMint: 'TrapMint111111111111111111111111111111111111',
    filterName: 'TOKEN_SEMANTICS_FREEZE_GUARD',
    rejectionReason: 'Mint authority unrevoked',
    rejectedAt: Date.now() - 3000_000,
    knowledgeCutRoot: 'cut_02',
    shadowEntryPriceLamports: 1_000_000_000n,
    shadowEntryFeasible: true,
    shadowSafetyOutcome: 'LIQUIDITY_TRAP',
    shadowExecutableExitFeasible: false,
    shadowMaturedPnLBps: -8000,
    shadowHoldingDurationMs: 120_000,
  });

  // 3. Destructive filter: rejected legitimate winner
  ledger.recordRejection({
    candidateId: 'cand_winner_01',
    tokenMint: 'WinnerMint11111111111111111111111111111111',
    filterName: 'OVERLY_RESTRICTIVE_FILTER',
    rejectionReason: 'Arbitrary volume threshold not met',
    rejectedAt: Date.now() - 2000_000,
    knowledgeCutRoot: 'cut_03',
    shadowEntryPriceLamports: 1_000_000_000n,
    shadowEntryFeasible: true,
    shadowSafetyOutcome: 'SAFE',
    shadowExecutableExitFeasible: true,
    shadowMaturedPnLBps: 1500, // 15% gain missed
    shadowHoldingDurationMs: 180_000,
  });

  const summaries = ledger.evaluateFilterPerformance();
  assert.equal(summaries.length, 2);

  const freezeGuard = summaries.find((s) => s.filterName === 'TOKEN_SEMANTICS_FREEZE_GUARD');
  assert.ok(freezeGuard);
  assert.equal(freezeGuard.catastrophicLossesAvoidedCount, 2);
  assert.equal(freezeGuard.status, 'HIGH_VALUE');
  assert.equal(freezeGuard.filterPrecisionScore, 1.0);

  const badFilter = summaries.find((s) => s.filterName === 'OVERLY_RESTRICTIVE_FILTER');
  assert.ok(badFilter);
  assert.equal(badFilter.profitableTradesMissedCount, 1);
  assert.equal(badFilter.status, 'DESTRUCTIVE');
});

test('Filter Marginal Value: Leave-one-out attribution and redundancy detection', () => {
  const engine = new FilterMarginalValueEngine();

  // Populate 25 evaluations where HSI and TOKEN_SEMANTICS catch unique disasters,
  // while an arbitrary redundant filter never catches anything uniquely
  for (let i = 0; i < 25; i++) {
    const isCatastrophic = i % 5 === 0;
    engine.recordEvaluation({
      candidateId: `cand_eval_${i}`,
      filterOutcomes: {
        HSI: !(i === 0 || i === 5), // Catches disasters at i=0, 5
        WALLET_INDEPENDENCE: true,
        AUTHENTICITY: true,
        LIQUIDITY: true,
        REGIME: true,
        TOKEN_SEMANTICS: !(i === 10 || i === 15), // Catches disasters at i=10, 15
        EXECUTION_CONFIDENCE: true, // Always passes or redundant
      },
      actualOutcomePnLBps: isCatastrophic ? -5000 : 200,
      actualIsCatastrophicFailure: isCatastrophic,
      evaluationLatencyMs: 15,
    });
  }

  const attributions = engine.attributeMarginalValue();
  assert.equal(attributions.length, 7);

  const hsi = attributions.find((a) => a.filter === 'HSI');
  assert.ok(hsi);
  assert.ok(hsi.incrementalCatastrophicCatches >= 1);
  assert.notEqual(hsi.recommendation, 'PRUNE_REDUNDANT');

  const execConfidence = attributions.find((a) => a.filter === 'EXECUTION_CONFIDENCE');
  assert.ok(execConfidence);
  assert.equal(execConfidence.incrementalCatastrophicCatches, 0);
  assert.equal(execConfidence.recommendation, 'PRUNE_REDUNDANT');
});
