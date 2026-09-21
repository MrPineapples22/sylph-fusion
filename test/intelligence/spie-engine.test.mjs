import test from 'node:test';
import assert from 'node:assert/strict';

import { SpieEngine, FACTOR_WEIGHTS } from '../../dist/intelligence/spie/spie-engine.js';
import { KellyAllocator } from '../../dist/intelligence/spie/kelly-allocator.js';
import { EntryTimingEngine } from '../../dist/intelligence/spie/entry-timing.js';
import { DynamicExitEngine } from '../../dist/intelligence/spie/dynamic-exits.js';
import { TradeCertificateFactory } from '../../dist/intelligence/spie/trade-certificate.js';

test('SPIE - SpieEngine: Mathematical Net EV & Factor Confluence', () => {
  const engine = new SpieEngine();

  // Test 1: High Quality Candidate with positive expected value
  const primeCandidate = {
    mint: 'PrimeTokenMint111111111111111111111111111111',
    symbol: 'PRIME',
    realSolReserve: 25.5,
    bondingProgressPct: 0.35,
    isDevSold: false,
    isCurveComplete: false,
    factors: {
      tokenQuality: 0.85,
      momentum: 0.90,
      liquidityDepth: 0.80,
      participation: 0.85,
      walletQuality: 0.88,
      safety: 0.92,
      executionFeasibility: 0.85,
      regimeCompatibility: 0.80,
      timing: 0.85,
    },
    modeledSlippageBps: 80,
    priceImpactBps: 40,
    priorityFeeBps: 15,
    jitoTipBps: 20,
    adverseSelectionBps: 25,
    rugProbability: 0.02,
  };

  const evaluation = engine.evaluate(primeCandidate);

  assert.equal(evaluation.symbol, 'PRIME');
  assert.ok(evaluation.grossAlphaBps > 0, 'Gross alpha should be positive');
  assert.ok(evaluation.executionFrictionBps < evaluation.grossAlphaBps, 'Friction should be less than gross alpha');
  assert.ok(evaluation.netExpectedEvBps > 0, 'Net EV should be substantially positive');
  assert.ok(evaluation.opportunityScore >= 70, 'Opportunity score should be high for prime candidate');
  assert.ok(['FAST_BUY', 'SLOW_BUY'].includes(evaluation.actionRecommendation), 'Should recommend buy action');
  assert.ok(evaluation.frictionToGrossRatio <= 0.45, 'Friction ratio must be <= 0.45');
  assert.ok(evaluation.dominantPositiveFactor.length > 0, 'Dominant positive factor identified');
});

test('SPIE - SpieEngine: Hard Invariant Enforcement (Friction, Rug, Dev Dump, Low Liq)', () => {
  const engine = new SpieEngine();

  // Invariant 1: Excessive Friction Rule (friction > 45% of gross alpha)
  const highFrictionCandidate = {
    mint: 'FrictionMint1111111111111111111111111111111',
    symbol: 'HIGHFRIC',
    realSolReserve: 5.0,
    bondingProgressPct: 0.20,
    isDevSold: false,
    isCurveComplete: false,
    factors: {
      tokenQuality: 0.60,
      momentum: 0.60,
      liquidityDepth: 0.40,
      participation: 0.50,
      walletQuality: 0.50,
      safety: 0.60,
      executionFeasibility: 0.40,
      regimeCompatibility: 0.50,
      timing: 0.50,
    },
    modeledSlippageBps: 400, // Excessive slippage
    priceImpactBps: 250,
    priorityFeeBps: 50,
    jitoTipBps: 50,
    adverseSelectionBps: 100,
  };

  const evalFriction = engine.evaluate(highFrictionCandidate);
  assert.equal(evalFriction.actionRecommendation, 'ABSTAIN');
  assert.ok(evalFriction.abstainReason?.includes('EXCESSIVE_FRICTION') || evalFriction.abstainReason?.includes('NEGATIVE_NET_EV'));

  // Invariant 2: Developer Dump Detection
  const devDumpCandidate = {
    mint: 'DumpMint11111111111111111111111111111111111',
    symbol: 'DUMP',
    realSolReserve: 15.0,
    bondingProgressPct: 0.40,
    isDevSold: true, // Dev dumped
    isCurveComplete: false,
    factors: {},
  };

  const evalDump = engine.evaluate(devDumpCandidate);
  assert.equal(evalDump.actionRecommendation, 'ABSTAIN');
  assert.equal(evalDump.opportunityStage, 'INVALIDATED');
  assert.ok(evalDump.abstainReason?.includes('CREATOR_SELL_DETECTED'));

  // Invariant 3: Minimum Real SOL Reserve Floor (< 1.0 SOL)
  const lowLiqCandidate = {
    mint: 'LowLiqMint111111111111111111111111111111111',
    symbol: 'LOWLIQ',
    realSolReserve: 0.65, // < 1.0 SOL floor
    bondingProgressPct: 0.05,
    isDevSold: false,
    isCurveComplete: false,
    factors: {},
  };

  const evalLowLiq = engine.evaluate(lowLiqCandidate);
  assert.equal(evalLowLiq.actionRecommendation, 'ABSTAIN');
  assert.ok(evalLowLiq.abstainReason?.includes('RESERVE_INSUFFICIENT'));
});

test('SPIE - SpieEngine: Candidate Opportunity Ranking', () => {
  const engine = new SpieEngine();

  const candidateA = {
    mint: 'TokenA111111111111111111111111111111111111',
    symbol: 'MED',
    realSolReserve: 10.0,
    bondingProgressPct: 0.20,
    isDevSold: false,
    isCurveComplete: false,
    factors: { momentum: 0.65, safety: 0.70 },
  };

  const candidateB = {
    mint: 'TokenB111111111111111111111111111111111111',
    symbol: 'SUPER',
    realSolReserve: 30.0,
    bondingProgressPct: 0.50,
    isDevSold: false,
    isCurveComplete: false,
    factors: { momentum: 0.95, safety: 0.95, tokenQuality: 0.90, walletQuality: 0.90, participation: 0.90 },
  };

  const ranked = engine.rankOpportunities([candidateA, candidateB]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].symbol, 'SUPER', 'Highest EV token must be ranked first');
  assert.ok(ranked[0].netExpectedEvBps >= ranked[1].netExpectedEvBps, 'Rankings must be monotonically descending by Net EV');
});

test('SPIE - KellyAllocator: Half-Kelly with 5% Pool Reserve & Mandate Ceilings', () => {
  const allocator = new KellyAllocator();

  // Test 1: Normal positive edge constrained by 5% curve reserve cap
  const allocation = allocator.calculateAllocation({
    pTarget: 0.65,
    targetUpsideBps: 4000,   // +40%
    structuralStopBps: 1200, // -12%
    poolReserveSol: 20.0,    // 5% cap = 1.0 SOL
    totalPortfolioCapitalSol: 100.0,
    mandateLimitSol: 3.0,
    regime: 'TRENDING',
    epistemicUncertainty: 0.15,
  });

  assert.ok(allocation.recommendedAllocationSol > 0, 'Should allocate positive capital');
  assert.ok(allocation.recommendedAllocationSol <= 1.0, 'Must not exceed 5% of pool reserve (1.0 SOL)');
  assert.equal(allocation.bindingConstraint, 'LIQUIDITY_CAP', 'Should be bound by 5% pool liquidity cap');
  assert.ok(allocation.rationale.includes('LIQUIDITY_CAP'));

  // Test 2: Drawdown throttling
  const drawdownAlloc = allocator.calculateAllocation({
    pTarget: 0.65,
    targetUpsideBps: 4000,
    structuralStopBps: 1200,
    poolReserveSol: 100.0,
    totalPortfolioCapitalSol: 100.0,
    mandateLimitSol: 5.0,
    regime: 'TRENDING',
    epistemicUncertainty: 0.1,
    currentDrawdownPct: 0.15, // 15% drawdown
  });

  assert.ok(drawdownAlloc.drawdownMultiplier < 0.5, 'Drawdown multiplier should throttle size');

  // Test 3: DEGRADED regime freeze
  const frozenAlloc = allocator.calculateAllocation({
    pTarget: 0.70,
    targetUpsideBps: 5000,
    structuralStopBps: 1000,
    poolReserveSol: 50.0,
    totalPortfolioCapitalSol: 100.0,
    mandateLimitSol: 2.0,
    regime: 'DEGRADED',
    epistemicUncertainty: 0.2,
  });

  assert.equal(frozenAlloc.recommendedAllocationSol, 0, 'Must allocate 0 in DEGRADED regime');
  assert.equal(frozenAlloc.bindingConstraint, 'RISK_FREEZE');
});

test('SPIE - EntryTimingEngine: Pullback, Breakout & Invalidation', () => {
  const timing = new EntryTimingEngine();

  // Test 1: Pullback Confirmation
  const pullbackDecision = timing.evaluateTiming({
    mint: 'MintPullback1111111111111111111111111111111',
    realSolReserve: 12.0,
    priceVelocityBps: 5,
    volumeVelocitySolSec: 0.2,
    sellPressureRatio: 0.28,        // Low selling
    retraceFromPeakPct: 0.15,       // Clean 15% pullback
    smartWalletPresent: false,
    recentTxCount: 25,
    uniqueBuyerGrowthRate: 4,
    tokenAgeSeconds: 45,
  });

  assert.equal(pullbackDecision.isReady, true);
  assert.equal(pullbackDecision.mode, 'PULLBACK_CONFIRMATION');
  assert.ok(pullbackDecision.timingScore >= 80);

  // Test 2: Invalidation on excessive sell pressure (>70%)
  const dumpDecision = timing.evaluateTiming({
    mint: 'MintDump11111111111111111111111111111111111',
    realSolReserve: 10.0,
    priceVelocityBps: -30,
    volumeVelocitySolSec: 0.8,
    sellPressureRatio: 0.82,        // 82% selling
    retraceFromPeakPct: 0.10,
    smartWalletPresent: false,
    recentTxCount: 40,
    uniqueBuyerGrowthRate: 1,
    tokenAgeSeconds: 30,
  });

  assert.equal(dumpDecision.isReady, false);
  assert.equal(dumpDecision.mode, 'WAIT_FOR_SETUP');
  assert.ok(dumpDecision.invalidationReason?.includes('SELLER_DOMINANCE'));
});

test('SPIE - DynamicExitEngine: Staged TP, Trailing Stop, Toxic Flow & Shock Defense', () => {
  const exitEngine = new DynamicExitEngine();

  // Test 1: Staged Profit Taking Stage 1 (+35%)
  const posStage1 = exitEngine.evaluateExit({
    mint: 'MintExit11111111111111111111111111111111111',
    entryPriceUsd: 0.0010,
    currentPriceUsd: 0.00138, // +38%
    highestPriceUsd: 0.00140,
    lowestPriceUsd: 0.00098,
    unrealizedPnlPct: 0.38,
    realSolReserve: 20.0,
    priorBlockSolReserve: 20.0,
    consecutiveSellBlocks: 0,
    currentSellPressureRatio: 0.30,
    isDevSold: false,
    stagesCompleted: 0,
    holdingTimeSeconds: 45,
  });

  assert.equal(posStage1.action, 'REDUCE_33');
  assert.equal(posStage1.reduceFraction, 0.33);
  assert.ok(posStage1.triggerReason.includes('TAKE_PROFIT_STAGE_1'));

  // Test 2: Liquidity Shock Defense (18% reserve drop in one block)
  const posShock = exitEngine.evaluateExit({
    mint: 'MintShock1111111111111111111111111111111111',
    entryPriceUsd: 0.0010,
    currentPriceUsd: 0.00105,
    highestPriceUsd: 0.0011,
    lowestPriceUsd: 0.0010,
    unrealizedPnlPct: 0.05,
    realSolReserve: 16.0,
    priorBlockSolReserve: 20.0, // 20% drop!
    consecutiveSellBlocks: 1,
    currentSellPressureRatio: 0.60,
    isDevSold: false,
    stagesCompleted: 0,
    holdingTimeSeconds: 60,
  });

  assert.equal(posShock.action, 'EXIT_100_LIQUIDITY_SHOCK');
  assert.equal(posShock.reduceFraction, 1.0);
  assert.equal(posShock.isUrgent, true);

  // Test 3: Dev Sold Invalidation
  const posDevDump = exitEngine.evaluateExit({
    mint: 'MintDev111111111111111111111111111111111111',
    entryPriceUsd: 0.0010,
    currentPriceUsd: 0.00095,
    highestPriceUsd: 0.00105,
    lowestPriceUsd: 0.00090,
    unrealizedPnlPct: -0.05,
    realSolReserve: 18.0,
    priorBlockSolReserve: 18.2,
    consecutiveSellBlocks: 1,
    currentSellPressureRatio: 0.40,
    isDevSold: true,
    stagesCompleted: 0,
    holdingTimeSeconds: 20,
  });

  assert.equal(posDevDump.action, 'EXIT_100_INVALIDATION');
  assert.equal(posDevDump.reduceFraction, 1.0);
  assert.equal(posDevDump.isUrgent, true);
});

test('SPIE - TradeCertificate: Cryptographic Sealing & Counterfactual Attribution', () => {
  const cert = TradeCertificateFactory.generateCertificate({
    tradeId: 'tr_test_998877',
    mint: 'MintCert11111111111111111111111111111111111',
    symbol: 'ALPHA',
    strategy: 'SPIE_PULLBACK_MOMENTUM_v1',
    entryTimestamp: 1700000000000,
    exitTimestamp: 1700000120000, // 120s duration
    entryPriceUsd: 0.00100,
    exitPriceUsd: 0.00142, // +42%
    positionSizeSol: 1.0,
    realizedPnlSol: 0.42,
    maxPriceObservedUsd: 0.00155,
    minPriceObservedUsd: 0.00096,
    feesPaidSol: 0.004,
    estimatedSlippageBps: 60,
    spieVectorAtEntry: { momentum: 0.88, safety: 0.90 },
    regimeAtEntry: 'TRENDING',
    exitReason: 'TAKE_PROFIT_STAGE_1',
    priceAtInitialSignalUsd: 0.00098,
    price5mPostExitUsd: 0.00130, // Price dropped post-exit (great exit!)
  });

  assert.equal(cert.symbol, 'ALPHA');
  assert.equal(cert.durationSeconds, 120);
  assert.equal(cert.realizedPnlBps, 4200);
  assert.ok(cert.maxFavorableExcursionPct > 0.50, 'MFE should be captured');
  assert.ok(cert.maxAdverseExcursionPct < 0, 'MAE should be negative excursion');
  assert.equal(cert.attribution, 'TOKEN_SELECTION_ALPHA');
  assert.ok(cert.integrityHash.length === 64, 'Integrity hash must be a valid 64-char SHA-256');

  // Verify certificate validation
  assert.ok(TradeCertificateFactory.verifyCertificate(cert), 'Certificate must pass cryptographic verification');
});
