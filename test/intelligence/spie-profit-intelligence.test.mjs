import test from 'node:test';
import assert from 'node:assert/strict';

import { SpieEngine } from '../../dist/intelligence/spie/spie-engine.js';
import { KellyAllocator } from '../../dist/intelligence/spie/kelly-allocator.js';
import { EntryTimingEngine } from '../../dist/intelligence/spie/entry-timing.js';
import { DynamicExitEngine } from '../../dist/intelligence/spie/dynamic-exits.js';
import { TradeCertificateFactory } from '../../dist/intelligence/spie/trade-certificate.js';

test('SPIE Engine: evaluates candidates and calculates calibrated Net EV', () => {
  const engine = new SpieEngine();

  const candidate = {
    mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'PEPE',
    realSolReserve: 6.5,
    factors: {
      tokenQuality: 0.90,
      momentum: 0.85,
      liquidityDepth: 0.80,
      participation: 0.82,
      walletQuality: 0.78,
      safety: 0.95,
      executionFeasibility: 0.85,
      regimeCompatibility: 0.80,
      timing: 0.80,
    },
    targetUpsidePct: 0.45,
    structuralStopPct: 0.12,
    modeledSlippageBps: 100,
    priceImpactBps: 60,
    priorityFeeBps: 20,
    jitoTipBps: 20,
    adverseSelectionBps: 30,
  };

  const evalResult = engine.evaluate(candidate);

  assert.equal(evalResult.mint, candidate.mint);
  assert.equal(evalResult.symbol, 'PEPE');
  assert.ok(evalResult.pTarget > 0.65, `Expected pTarget > 0.65, got ${evalResult.pTarget}`);
  assert.ok(evalResult.grossAlphaBps > 0, `Expected positive gross alpha, got ${evalResult.grossAlphaBps}`);
  assert.ok(evalResult.netExpectedEvBps > 0, `Expected positive net EV, got ${evalResult.netExpectedEvBps}`);
  assert.ok(evalResult.opportunityScore > 60, `Expected high opportunity score, got ${evalResult.opportunityScore}`);
  assert.equal(evalResult.opportunityStage, 'READY');
  assert.equal(evalResult.actionRecommendation, 'FAST_BUY');
  assert.equal(evalResult.dominantNegativeConstraint, 'walletQuality');
});

test('SPIE Engine: strictly enforces 45% friction ceiling rule (ABSTAIN)', () => {
  const engine = new SpieEngine();

  // High friction scenario: friction = 1200 BPS while gross alpha is small
  const highFrictionCandidate = {
    mint: 'HighFrictionMint111111111111111111111111111',
    realSolReserve: 2.0,
    factors: {
      tokenQuality: 0.60,
      momentum: 0.55,
      liquidityDepth: 0.30,
      safety: 0.70,
    },
    targetUpsidePct: 0.20,
    structuralStopPct: 0.15,
    modeledSlippageBps: 300,
    priceImpactBps: 250,
    priorityFeeBps: 50,
    jitoTipBps: 50,
    adverseSelectionBps: 150, // Total friction: 800 BPS
  };

  const evalResult = engine.evaluate(highFrictionCandidate);
  assert.equal(evalResult.actionRecommendation, 'ABSTAIN');
  assert.ok(evalResult.abstainReason?.includes('EXCESSIVE_FRICTION') || evalResult.abstainReason?.includes('NEGATIVE_NET_EV'));
  assert.ok(evalResult.opportunityStage === 'DEVELOPING' || evalResult.opportunityStage === 'WATCH');
});

test('SPIE Engine: creator dump (isDevSold) or completed curve immediately invalidates', () => {
  const engine = new SpieEngine();

  const devSoldCandidate = {
    mint: 'DevSoldMint11111111111111111111111111111111',
    realSolReserve: 10.0,
    factors: { momentum: 0.99, safety: 0.99 },
    isDevSold: true,
  };
  const evalDev = engine.evaluate(devSoldCandidate);
  assert.equal(evalDev.actionRecommendation, 'ABSTAIN');
  assert.equal(evalDev.opportunityStage, 'INVALIDATED');
  assert.ok(evalDev.abstainReason?.includes('CREATOR_SELL_DETECTED'));

  const migratedCandidate = {
    mint: 'MigratedMint11111111111111111111111111111111',
    realSolReserve: 85.0,
    factors: { momentum: 0.99, safety: 0.99 },
    isCurveComplete: true,
  };
  const evalMigrated = engine.evaluate(migratedCandidate);
  assert.equal(evalMigrated.actionRecommendation, 'ABSTAIN');
  assert.equal(evalMigrated.opportunityStage, 'CLOSED');
  assert.ok(evalMigrated.abstainReason?.includes('CURVE_COMPLETED'));
});

test('SPIE Engine: Opportunity Board ranks candidates by Net EV descending', () => {
  const engine = new SpieEngine();

  const candidates = [
    {
      mint: 'MintMediocre11111111111111111111111111111111',
      realSolReserve: 3.0,
      factors: { momentum: 0.60, safety: 0.70, liquidityDepth: 0.50 },
    },
    {
      mint: 'MintSuperior11111111111111111111111111111111',
      realSolReserve: 8.0,
      factors: { momentum: 0.92, safety: 0.95, liquidityDepth: 0.88, participation: 0.90, timing: 0.85 },
    },
    {
      mint: 'MintFailing111111111111111111111111111111111',
      realSolReserve: 0.5, // Fails reserve floor
      factors: { momentum: 0.90 },
    },
  ];

  const ranked = engine.rankOpportunities(candidates);
  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].mint, 'MintSuperior11111111111111111111111111111111');
  assert.ok(ranked[0].netExpectedEvBps > ranked[1].netExpectedEvBps);
});

test('Kelly Allocator: respects liquidity depth invariant (Max 5% of curve reserve)', () => {
  const allocator = new KellyAllocator();

  const input = {
    pTarget: 0.75,
    targetUpsideBps: 5000,   // +50%
    structuralStopBps: 1200, // -12%
    poolReserveSol: 4.0,     // 5% capacity = 0.20 SOL
    totalPortfolioCapitalSol: 100.0,
    mandateLimitSol: 2.0,
    regime: 'SPECULATIVE_EXPANSION',
    epistemicUncertainty: 0.1,
  };

  const result = allocator.calculateAllocation(input);

  // Unconstrained Kelly would want > 20 SOL, but liquidity cap of 5% of 4.0 SOL is 0.20 SOL
  assert.equal(result.bindingConstraint, 'LIQUIDITY_CAP');
  assert.equal(result.recommendedAllocationSol, 0.20);
  assert.equal(result.liquidityCapSol, 0.20);
});

test('Kelly Allocator: throttles size during drawdown and freezes in DEGRADED', () => {
  const allocator = new KellyAllocator();

  // Baseline in normal state
  const baseInput = {
    pTarget: 0.65,
    targetUpsideBps: 4000,
    structuralStopBps: 1200,
    poolReserveSol: 50.0, // 5% = 2.5 SOL
    totalPortfolioCapitalSol: 10.0,
    mandateLimitSol: 2.0,
    regime: 'TRENDING',
    epistemicUncertainty: 0.1,
    currentDrawdownPct: 0.0,
  };
  const baseResult = allocator.calculateAllocation(baseInput);

  // Drawdown of 12%
  const ddInput = { ...baseInput, currentDrawdownPct: 0.12 };
  const ddResult = allocator.calculateAllocation(ddInput);

  assert.ok(ddResult.recommendedAllocationSol < baseResult.recommendedAllocationSol);
  assert.ok(ddResult.drawdownMultiplier < 0.60);

  // DEGRADED regime -> zero allocation
  const degradedInput = { ...baseInput, regime: 'DEGRADED' };
  const degradedResult = allocator.calculateAllocation(degradedInput);
  assert.equal(degradedResult.recommendedAllocationSol, 0);
  assert.equal(degradedResult.bindingConstraint, 'RISK_FREEZE');
});

test('Entry Timing Engine: confirms pullback and breakout modes correctly', () => {
  const timingEngine = new EntryTimingEngine();

  // Healthy pullback telemetry
  const pullbackTelemetry = {
    mint: 'PullbackMint1111111111111111111111111111111',
    realSolReserve: 5.2,
    priceVelocityBps: 5,
    volumeVelocitySolSec: 0.2,
    sellPressureRatio: 0.28,
    retraceFromPeakPct: 0.15, // 15% pullback
    smartWalletPresent: false,
    recentTxCount: 25,
    uniqueBuyerGrowthRate: 4,
    tokenAgeSeconds: 45,
  };

  const pullbackDecision = timingEngine.evaluateTiming(pullbackTelemetry);
  assert.equal(pullbackDecision.isReady, true);
  assert.equal(pullbackDecision.mode, 'PULLBACK_CONFIRMATION');
  assert.ok(pullbackDecision.timingScore >= 80);

  // Seller dominance -> invalidation
  const dumpTelemetry = {
    ...pullbackTelemetry,
    sellPressureRatio: 0.78, // > 70% dump
  };
  const dumpDecision = timingEngine.evaluateTiming(dumpTelemetry);
  assert.equal(dumpDecision.isReady, false);
  assert.equal(dumpDecision.mode, 'WAIT_FOR_SETUP');
  assert.ok(dumpDecision.invalidationReason?.includes('SELLER_DOMINANCE'));
});

test('Dynamic Exit Engine: executes multi-stage profit taking and toxic flow defense', () => {
  const exitEngine = new DynamicExitEngine();

  // Scenario 1: Reached Stage 1 Profit (+40% >= +35%)
  const posStage1 = {
    mint: 'Stage1Mint11111111111111111111111111111111',
    entryPriceUsd: 1.0,
    currentPriceUsd: 1.40,
    highestPriceUsd: 1.42,
    lowestPriceUsd: 0.95,
    unrealizedPnlPct: 0.40,
    realSolReserve: 10.0,
    priorBlockSolReserve: 10.0,
    consecutiveSellBlocks: 0,
    currentSellPressureRatio: 0.20,
    isDevSold: false,
    stagesCompleted: 0,
    holdingTimeSeconds: 60,
  };

  const exit1 = exitEngine.evaluateExit(posStage1);
  assert.equal(exit1.action, 'REDUCE_33');
  assert.equal(exit1.reduceFraction, 0.33);
  assert.ok(exit1.triggerReason.includes('TAKE_PROFIT_STAGE_1'));

  // Scenario 2: Liquidity shock defense (>15% reserve drop in one block)
  const posShock = {
    ...posStage1,
    realSolReserve: 8.0,
    priorBlockSolReserve: 10.0, // 20% drop!
  };
  const exitShock = exitEngine.evaluateExit(posShock);
  assert.equal(exitShock.action, 'EXIT_100_LIQUIDITY_SHOCK');
  assert.equal(exitShock.reduceFraction, 1.0);
  assert.equal(exitShock.isUrgent, true);

  // Scenario 3: Toxic flow defense (4 consecutive sell blocks with 80% selling)
  const posToxic = {
    ...posStage1,
    consecutiveSellBlocks: 4,
    currentSellPressureRatio: 0.85,
  };
  const exitToxic = exitEngine.evaluateExit(posToxic);
  assert.equal(exitToxic.action, 'EXIT_100_TOXICITY');
  assert.equal(exitToxic.reduceFraction, 1.0);
  assert.equal(exitToxic.isUrgent, true);
});

test('Trade Certificate: creates immutable post-trade certificate with counterfactual attribution', () => {
  const now = Date.now();
  const cert = TradeCertificateFactory.generateCertificate({
    tradeId: 'trade-test-001',
    mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    symbol: 'PEPE',
    strategy: 'SPIE_PULLBACK_V1',
    entryTimestamp: now - 300000, // 5 min ago
    exitTimestamp: now,
    entryPriceUsd: 0.000020,
    exitPriceUsd: 0.000028,
    positionSizeSol: 0.5,
    realizedPnlSol: 0.18,
    maxPriceObservedUsd: 0.000032,
    minPriceObservedUsd: 0.000019,
    feesPaidSol: 0.002,
    estimatedSlippageBps: 80,
    spieVectorAtEntry: { momentum: 0.85, safety: 0.95 },
    regimeAtEntry: 'SPECULATIVE_EXPANSION',
    exitReason: 'TAKE_PROFIT_STAGE_1',
    priceAtInitialSignalUsd: 0.000022, // Saved 9% by waiting for pullback!
    price5mPostExitUsd: 0.000021,       // Dumped after we exited!
  });

  assert.ok(cert.certificateId.startsWith('cert-7xKXtg2C-'));
  assert.equal(cert.symbol, 'PEPE');
  assert.equal(cert.realizedPnlBps, 4000); // +40%
  assert.ok(cert.maxFavorableExcursionPct >= 0.50); // MFE +60%
  assert.equal(cert.attribution, 'EXIT_ALPHA'); // Exited before the post-exit dump
  assert.equal(cert.integrityHash.length, 64);  // Valid SHA-256 hash
});
