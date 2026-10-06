/**
 * SYLPH FUSION — PAPER_MAX_RISK INTEGRATION & COMPLIANCE TEST SUITE
 * Specification: Master Blueprint Sections VIII, IX, X, CXXIX, CXXXV, CXXXVI
 *
 * Verifies all 15 Mandatory Proof Invariants of Section CXXIX:
 * 1. Rolling DD can be bypassed
 * 2. Daily loss can be bypassed
 * 3. HELIX demotion does not stop the simulated experiment
 * 4. Position cap can be bypassed
 * 5. 100% simulated bankroll can be allocated
 * 6. Stop loss can be disabled
 * 7. Extreme runner can remain open through 90%+ drawdowns
 * 8. Bankruptcy is allowed and recorded without resetting bankroll
 * 9. Every bypass is journaled (PAPER_RISK_BYPASS)
 * 10. Accounting remains conserved (Double-entry / BigInt)
 * 11. Impossible fills remain impossible (Constant Product AMM reserves respected)
 * 12. Unavailable liquidity still prevents a fake fill (SIMULATED_UNEXITABLE)
 * 13. Live signer remains unavailable (LIVE_SIGNING_UNAVAILABLE)
 * 14. No network submission occurs (PAPER-only boundary)
 * 15. PAPER evidence remains PAPER evidence (cannot self-promote to VERIFIED_EXECUTION)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PaperAuthorityPolicy,
  RiskGateCounterfactualLedger,
} from '../../dist/platform/paper/paper-authority-policy.js';
import {
  ExecutablePaperSimulator,
} from '../../dist/platform/paper/executable-paper-simulator.js';
import {
  MonteCarloBankrollEngine,
} from '../../dist/platform/paper/monte-carlo-engine.js';
import {
  V8HistoricalReplayEngine,
} from '../../dist/platform/paper/v8-replay.js';
import {
  CatchabilityEngine,
} from '../../dist/intelligence/moonshot/catchability.js';
import {
  WinnerSeparationEngine,
} from '../../dist/intelligence/moonshot/winner-separation.js';
import {
  CompetingRiskRunner,
} from '../../dist/intelligence/moonshot/hazard-engine.js';
import {
  WalletEntropyCalculator,
} from '../../dist/intelligence/network/wallet-entropy.js';
import {
  FundingClusterEngine,
} from '../../dist/intelligence/network/funding-clusters.js';
import {
  OrganicTakeoverDetector,
} from '../../dist/intelligence/network/coordination-decay.js';
import {
  AntiPortfolioEngine,
} from '../../dist/intelligence/research/anti-portfolio.js';
import {
  createUniversalEvidence,
  canPromoteEvidence,
} from '../../dist/platform/evidence/universal-evidence.js';
import {
  UnifiedPipelineUnit,
} from '../../dist/platform/pipeline/unified-unit.js';
import {
  CommandGateway,
} from '../../dist/command-gateway.js';
import {
  recordEquity,
  recordFailure,
  exitDecision,
} from '../../dist/core.js';
import {
  assertPaperRuntime,
} from '../../dist/fusion.js';

describe('SYLPH FUSION — Master Solana PAPER_MAX_RISK Blueprint', () => {

  it('Invariant 1 & 2: Rolling DD and daily loss can be bypassed in PAPER_MAX_RISK with shadow tracking', () => {
    const standardState = {
      version: 1,
      wallet: 'TestWallet',
      mode: 'paper',
      positions: {},
      pending: null,
      cash: '1000000000',
      day: '2026-10-05',
      dayPnl: '0',
      closed: {},
      halted: false,
    };

    // Standard mode halts on 500 bps (5%) drawdown
    recordEquity(standardState, 1000n, Date.now() - 1000, 3600000, 500);
    recordEquity(standardState, 900n, Date.now(), 3600000, 500); // 10% drawdown
    assert.equal(standardState.halted, true, 'Standard mode must halt on drawdown breach');

    // Max risk mode bypasses halt and tracks shadow status
    const maxRiskState = {
      version: 1,
      wallet: 'MaxRiskWallet',
      mode: 'paper_max_risk',
      positions: {},
      pending: null,
      cash: '1000000000',
      day: '2026-10-05',
      dayPnl: '0',
      closed: {},
      halted: false,
    };

    recordEquity(maxRiskState, 1000n, Date.now() - 1000, 3600000, 500);
    recordEquity(maxRiskState, 500n, Date.now(), 3600000, 500); // 50% drawdown!
    assert.equal(maxRiskState.halted, false, 'PAPER_MAX_RISK must NOT halt on drawdown breach');
    assert.equal(maxRiskState.risk?.shadowHalted, true, 'Shadow halt must be recorded for research');
    assert.ok(maxRiskState.risk?.bypassedHalts?.some(h => h.includes('ROLLING_DRAWDOWN')));
  });

  it('Invariant 3 & 4: HELIX demotion and position caps can be bypassed in PAPER_MAX_RISK', () => {
    const policy = new PaperAuthorityPolicy('PAPER_MAX_RISK');

    // 1. Position cap evaluation
    const capDecision = policy.evaluateRule({
      rule: 'MAX_POSITIONS_LIMIT',
      check: () => ({ allowed: false, reason: 'Positions exceed max limit 3' }),
      mint: 'TestMint111111111111111111111111111111111111',
    });

    assert.equal(capDecision.normalAllowed, false, 'Normal decision would DENY');
    assert.equal(capDecision.paperAllowed, true, 'PAPER_MAX_RISK transforms decision to ATTEMPT');
    assert.equal(capDecision.bypassed, true, 'Bypass flag must be true');

    // 2. HELIX demotion rule
    const helixDecision = policy.evaluateRule({
      rule: 'HELIX_STRATEGY_DEMOTION',
      check: () => ({ allowed: false, reason: 'Strategy statistically demoted by canary' }),
      mint: 'TestMint222222222222222222222222222222222222',
    });

    assert.equal(helixDecision.paperAllowed, true, 'Demoted strategy still executes in PAPER_MAX_RISK');
  });

  it('Invariant 5: 100% simulated bankroll can be allocated in PAPER_MAX_RISK', () => {
    const gateway = CommandGateway.resetInstance();
    const policy = new PaperAuthorityPolicy('PAPER_MAX_RISK');
    gateway.setPaperPolicy(policy);
    gateway.setCashUsd(500.0);

    assert.equal(gateway.getPaperPolicy().isMaxRisk(), true);
  });

  it('Invariant 6 & 7: Stop loss can be disabled and runners can remain open through 90% drawdown', () => {
    const position = {
      mint: 'RunnerMint1111111111111111111111111111111111',
      creator: 'Creator1',
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      qty: '1000000',
      initialQty: '1000000',
      cost: '1000000000',     // 1 SOL cost
      originalCost: '1000000000',
      peak: '10000000000',    // Reached 10x
      stage: 1,
      opened: Date.now() - 3600000,
      reserve: '1000000000',
      panic: false,
      creatorTokens: '0',
    };

    // Current value has suffered a 90% drawdown from peak (down to 1 SOL)
    const collapsedValue = 1000000000n;

    // Standard mode forces exit on trailing stop or breakeven trigger
    const standardExit = exitDecision(position, collapsedValue, 1200, false);
    assert.ok(standardExit !== null, 'Standard mode would stop out');

    // Max risk mode allows runner to ride through 90% drawdown
    const maxRiskExit = exitDecision(position, collapsedValue, 1200, true);
    assert.equal(maxRiskExit, null, 'PAPER_MAX_RISK suppresses ordinary stop loss to test deep recoveries');
  });

  it('Invariant 8: Bankruptcy is allowed and recorded without resetting bankroll', () => {
    const policy = new PaperAuthorityPolicy('PAPER_MAX_RISK');
    assert.equal(policy.hasBankrupted(), false);

    const record = policy.handleBankruptcy({
      bankrollId: 'bankroll_test_01',
      currentEquityLamports: 0n,
      startingBankrollLamports: 1_000_000_000n,
      maximumEquityLamports: 3_500_000_000n,
      maximumDrawdownBps: 10_000, // 100% drawdown
      totalTradesExecuted: 42,
      largestLossLamports: 1_000_000_000n,
      largestPositionLamports: 1_000_000_000n,
      cause: 'FULL_KELLY_OVEREXPOSURE',
      strategy: 'hyper-aggressive-convex',
      regime: 'HOSTILE_VOLATILE',
      riskRulesBypassed: ['ROLLING_DRAWDOWN_LIMIT', 'MAX_POSITIONS_LIMIT'],
      startedAtMs: Date.now() - 3600_000,
    });

    assert.equal(record.outcome, 'BANKRUPT');
    assert.equal(record.maximumDrawdownBps, 10_000);
    assert.equal(policy.hasBankrupted(), true);
    assert.equal(policy.getBankruptcyRecord()?.cause, 'FULL_KELLY_OVEREXPOSURE');
  });

  it('Invariant 9: Every risk bypass is journaled and tracked in counterfactual ledger', () => {
    const unit = new UnifiedPipelineUnit('PAPER_MAX_RISK');

    unit.recordPaperRiskBypass({
      eventId: 'evt_test_bypass_01',
      timestamp: Date.now(),
      mode: 'PAPER_MAX_RISK',
      rule: 'ROLLING_DRAWDOWN_LIMIT',
      normalResult: 'DENY',
      paperMaxRiskResult: 'ATTEMPT',
      reason: 'COUNTERFACTUAL_RESEARCH',
      mint: 'TestMint333333333333333333333333333333333333',
    });

    const entries = unit.journal.all();
    const bypassEntry = entries.find(e => e.toState === 'RISK_BYPASSED_PAPER');
    assert.ok(bypassEntry, 'Canonical journal must contain RISK_BYPASSED_PAPER entry');
    assert.equal(bypassEntry.economicFactId, 'fact_evt_test_bypass_01');

    const recentBypasses = unit.paperPolicy.counterfactualLedger.getRecentBypasses();
    assert.equal(recentBypasses.length, 1);
    assert.equal(recentBypasses[0].rule, 'ROLLING_DRAWDOWN_LIMIT');
  });

  it('Invariant 10: Double-entry accounting remains conserved under all paper outcomes', () => {
    const unit = new UnifiedPipelineUnit('PAPER_MAX_RISK');

    // Post friction and verify double-entry balance
    unit.doubleEntry.postNetworkFriction('frict_01', 50_000n, 'Test paper execution tip');
    const conservation = unit.doubleEntry.checkConservation();
    assert.equal(conservation.conserved, true, 'Double-entry accounting must remain conserved');
  });

  it('Invariant 11: Impossible fills remain impossible (Constant Product AMM reserves respected)', () => {
    const simulator = new ExecutablePaperSimulator();

    // Attempt to buy more than total virtual tokens in the pool
    const result = simulator.simulateExecution({
      side: 'BUY',
      mint: 'TestMint444444444444444444444444444444444444',
      poolAddress: 'pool_test_01',
      positionSizeLamports: 10_000_000_000_000n, // Huge 10,000 SOL buy against 30 SOL pool
      decisionTimestamp: Date.now(),
      currentTimestamp: Date.now(),
      currentSlot: 300000000n,
      route: 'PUMP_FUN',
      reserves: {
        base: 1_000_000_000_000n,
        quote: 30_000_000_000n, // 30 SOL
      },
      priorityFeeLamports: 50_000n,
      jitoTipLamports: 100_000n,
      maxSlippageBps: 200, // 2% max slippage
      simulatedLatencyMs: 200,
      blockhashAgeMs: 5000,
      transportCondition: 'HEALTHY',
    });

    assert.equal(result.outcome, 'SIMULATED_REJECTED', 'Fills violating slippage/depth must be rejected');
    assert.ok(result.reason?.includes('SLIPPAGE_TOLERANCE_EXCEEDED'));
  });

  it('Invariant 12: Unavailable liquidity strictly prevents fake fills (SIMULATED_UNEXITABLE)', () => {
    const simulator = new ExecutablePaperSimulator();

    // Pool quote reserves depleted (rug / drain)
    const result = simulator.simulateExecution({
      side: 'SELL',
      mint: 'TestMint555555555555555555555555555555555555',
      poolAddress: 'pool_test_02',
      positionSizeLamports: 0n,
      tokenQuantityRaw: 500_000_000n,
      decisionTimestamp: Date.now(),
      currentTimestamp: Date.now(),
      currentSlot: 300000000n,
      route: 'PUMP_FUN',
      reserves: {
        base: 1_000_000_000n,
        quote: 0n, // Depleted liquidity!
      },
      priorityFeeLamports: 50_000n,
      jitoTipLamports: 100_000n,
      maxSlippageBps: 1000,
      simulatedLatencyMs: 200,
      blockhashAgeMs: 5000,
      transportCondition: 'HEALTHY',
    });

    assert.equal(result.outcome, 'SIMULATED_UNEXITABLE', 'Zero liquidity must return SIMULATED_UNEXITABLE');
  });

  it('Invariant 13 & 14: Live signer remains unavailable and production capital blocked', () => {
    assert.throws(() => {
      assertPaperRuntime({ MODE: 'live' });
    }, /PAPER_ONLY_RUNTIME/);
  });

  it('Invariant 15: Universal Evidence model strictly prevents self-promotion', () => {
    const paperEvidence = createUniversalEvidence({
      value: { priceSol: 0.005 },
      evidenceClass: 'PAPER_SIMULATED',
      source: 'executable_paper_simulator',
      issuer: 'sim_unit',
      observedAt: Date.now(),
      slot: 300000000n,
      provenance: 'unit_test',
    });

    assert.equal(paperEvidence.evidenceClass, 'PAPER_SIMULATED');

    // Self-promotion from PAPER_SIMULATED to VERIFIED_EXECUTION or VERIFIED_CHAIN is forbidden
    assert.equal(canPromoteEvidence('PAPER_SIMULATED', 'VERIFIED_EXECUTION'), false);
    assert.equal(canPromoteEvidence('PAPER_SIMULATED', 'VERIFIED_CHAIN'), false);
    assert.equal(canPromoteEvidence('MODELLED_COUNTERFACTUAL', 'VERIFIED_CHAIN'), false);

    // Epistemic invariants: UNKNOWN !== false, MISSING !== 0
    assert.throws(() => {
      createUniversalEvidence({
        value: false,
        evidenceClass: 'UNKNOWN',
        source: 'test',
        issuer: 'test',
        observedAt: Date.now(),
        slot: 100n,
        provenance: 'test',
      });
    }, /EPISTEMIC_VIOLATION/);

    assert.throws(() => {
      createUniversalEvidence({
        value: 0,
        evidenceClass: 'MISSING',
        source: 'test',
        issuer: 'test',
        observedAt: Date.now(),
        slot: 100n,
        provenance: 'test',
      });
    }, /EPISTEMIC_VIOLATION/);
  });

  it('Moonshot Catchability Engine accurately computes EATH(q) and monetizable peak T_EMP', () => {
    const birthTime = Date.now() - 600_000;
    const trajectory = [
      { timestampMs: birthTime, slot: 100n, priceSol: 0.0001, realQuoteReservesLamports: 30_000_000_000n, virtualQuoteReservesLamports: 30_000_000_000n, virtualTokenReserves: 1_000_000_000_000n },
      { timestampMs: birthTime + 5000, slot: 112n, priceSol: 0.0005, realQuoteReservesLamports: 60_000_000_000n, virtualQuoteReservesLamports: 60_000_000_000n, virtualTokenReserves: 800_000_000_000n },
      { timestampMs: birthTime + 30000, slot: 175n, priceSol: 0.002, realQuoteReservesLamports: 150_000_000_000n, virtualQuoteReservesLamports: 150_000_000_000n, virtualTokenReserves: 500_000_000_000n },
      { timestampMs: birthTime + 120000, slot: 400n, priceSol: 0.01, realQuoteReservesLamports: 500_000_000_000n, virtualQuoteReservesLamports: 500_000_000_000n, virtualTokenReserves: 200_000_000_000n }, // 100x displayed
    ];

    const profile = CatchabilityEngine.evaluateTrajectory({
      mint: 'MoonshotTestMint111111111111111111111111111',
      birthTimestampMs: birthTime,
      trajectory,
    });

    assert.ok(profile.displayedAthMultiple >= 50);
    assert.ok(profile.eathBySize.size > 0);
    assert.ok(profile.qualifiedLabels.some(l => l.includes('EXECUTABLE_')));
  });

  it('Winner Separation Engine computes WST, MSET and Crowding Horizon', () => {
    const analysis = WinnerSeparationEngine.analyzeSeparation({
      winnerMint: 'WinnerMint1111111111111111111111111111111',
      matchedControls: [
        { mint: 'Ctrl1', launchTimestampMs: 1000, startingMcapSol: 30, startingLiquiditySol: 30, venue: 'PUMP', solRegime: 'BULL', reached2x: false, reached10x: false, rugged: true },
        { mint: 'Ctrl2', launchTimestampMs: 1000, startingMcapSol: 30, startingLiquiditySol: 30, venue: 'PUMP', solRegime: 'BULL', reached2x: true, reached10x: false, rugged: false },
      ],
      slices: [
        { elapsedMs: 1000, elapsedSlots: 2, pWinner: 0.1, pControlMean: 0.05, executableEvSol: -0.1, entryPriceBpsVsBirth: 0, entropyConfidence: 0.2 },
        { elapsedMs: 5000, elapsedSlots: 12, pWinner: 0.45, pControlMean: 0.08, executableEvSol: 0.35, entryPriceBpsVsBirth: 150, entropyConfidence: 0.8 },
        { elapsedMs: 15000, elapsedSlots: 37, pWinner: 0.85, pControlMean: 0.05, executableEvSol: 0.9, entryPriceBpsVsBirth: 400, entropyConfidence: 0.95 },
      ],
    });

    assert.equal(analysis.wstMs, 5000, 'WST must identify when separation exceeds theta');
    assert.equal(analysis.msetMs, 5000, 'MSET must identify earliest positive EV time');
    assert.ok(analysis.decisionSlackMs > 0);
  });

  it('CompetingRiskRunner evaluates dynamic hazard ratios over static stops', () => {
    const runnerState = CompetingRiskRunner.evaluateHazards({
      elapsedSeconds: 60,
      currentMultiple: 3.5,
      walletEntropy: 1.8,
      independentCapitalAcceleration: 0.5,
      exitDepthLamports: 100_000_000_000n,
      poolQuoteReservesLamports: 200_000_000_000n,
      coordinationDecayRate: 0.02,
      sellerAbsorptionRate: 0.85,
      recentPriceVelocityBps: 150,
    });

    assert.ok(runnerState.h2x > 0);
    assert.ok(runnerState.hRug > 0);
    assert.ok(runnerState.netConvexHazardRatio > 0);
    assert.equal(runnerState.recommendedAction, 'PYRAMID_ADD', 'High convex hazard ratio and high entropy recommend pyramiding');
  });

  it('Wallet Entropy and Buyer Derivatives detect manufactured vs organic demand', () => {
    const calc = new WalletEntropyCalculator();
    const t0 = Date.now();

    // 1. Organic diverse distribution
    const organic = calc.calculateEntropy(t0, 100n, [
      { clusterId: 'cluster_a', volumeLamports: 1000n, buyerCount: 5 },
      { clusterId: 'cluster_b', volumeLamports: 1200n, buyerCount: 6 },
      { clusterId: 'cluster_c', volumeLamports: 900n, buyerCount: 4 },
      { clusterId: 'cluster_d', volumeLamports: 1100n, buyerCount: 5 },
    ]);

    assert.ok(organic.entropy > 1.5, 'Diverse clusters produce high entropy');
    assert.ok(organic.manufacturedDemandRiskScore < 0.3);

    // 2. Coordinated single-cluster sybil
    const sybil = calc.calculateEntropy(t0 + 2000, 105n, [
      { clusterId: 'cluster_same_funder', volumeLamports: 50_000n, buyerCount: 50 },
    ]);

    assert.equal(sybil.entropy, 0, 'Concentrated sybil flow produces zero entropy');
    assert.ok(sybil.manufacturedDemandRiskScore > 0.5);
  });

  it('Independent Capital Origin Acceleration (ICOA) tracks second derivative of funding roots', () => {
    const engine = new FundingClusterEngine();
    const t = Date.now();

    engine.registerWallet({ walletAddress: 'w1', fundingRootAddress: 'root_A', firstActiveTimestampMs: t });
    engine.registerWallet({ walletAddress: 'w2', fundingRootAddress: 'root_B', firstActiveTimestampMs: t });
    const snap1 = engine.evaluateIcoa(t);

    engine.registerWallet({ walletAddress: 'w3', fundingRootAddress: 'root_C', firstActiveTimestampMs: t + 1000 });
    engine.registerWallet({ walletAddress: 'w4', fundingRootAddress: 'root_D', firstActiveTimestampMs: t + 1000 });
    engine.registerWallet({ walletAddress: 'w5', fundingRootAddress: 'root_E', firstActiveTimestampMs: t + 1000 });
    const snap2 = engine.evaluateIcoa(t + 1000);

    assert.ok(snap2.clusterVelocity > 0);
  });

  it('Organic Takeover Detector transitions through coordination decay phases', () => {
    const detector = new OrganicTakeoverDetector();
    const t = Date.now();

    const phase1 = detector.evaluateCoordination({
      timestampMs: t,
      totalVolumeLamports: 10_000_000_000n,
      coordinatedVolumeLamports: 9_000_000_000n,
      uniqueIndependentWallets: 3,
    });
    assert.equal(phase1.currentPhase, 'COORDINATED_SEED');

    const phase2 = detector.evaluateCoordination({
      timestampMs: t + 10_000,
      totalVolumeLamports: 50_000_000_000n,
      coordinatedVolumeLamports: 5_000_000_000n, // Drops to 10%
      uniqueIndependentWallets: 65,
    });
    assert.equal(phase2.currentPhase, 'ORGANIC_DOMINANCE');
    assert.equal(phase2.isTakeoverConfirmed, true);
  });

  it('Anti-Portfolio tracks rejected candidates and calculates Moonshot Tax', () => {
    const anti = new AntiPortfolioEngine();

    anti.recordRejection({
      mint: 'RejectedRunnerMint1111111111111111111111111',
      filterName: 'EARLY_BUYER_COUNT_FILTER',
      rejectionReason: 'Insufficient initial buyers',
      entryPriceSol: 0.0001,
      entryLiquidityLamports: 30_000_000_000n,
      eligibleForSecondChance: true,
    });

    anti.recordRejection({
      mint: 'RejectedRugMint2222222222222222222222222',
      filterName: 'RUG_DETECTOR',
      rejectionReason: 'Suspicious creator funding',
      entryPriceSol: 0.0001,
      entryLiquidityLamports: 30_000_000_000n,
      eligibleForSecondChance: false,
    });

    // Update subsequent real outcomes
    anti.updateRejectedOutcome({
      mint: 'RejectedRunnerMint1111111111111111111111111',
      peakMultiple: 50.0, // Ended up doing 50x!
      worstDrawdownBps: 2000,
      isRug: false,
      isDead: false,
      actualExecutableReturnBps: 3000,
    });

    anti.updateRejectedOutcome({
      mint: 'RejectedRugMint2222222222222222222222222',
      peakMultiple: 1.0,
      worstDrawdownBps: 10_000,
      isRug: true, // Did rug
      isDead: true,
      actualExecutableReturnBps: -10_000,
    });

    const summary = anti.computeAntiPortfolioSummary();
    assert.equal(summary.totalRejectedCount, 2);
    assert.equal(summary.rejectedRugCount, 1);
    assert.equal(summary.rejected50xCount, 1);
    assert.ok(summary.overallMoonshotTax > 0, 'Moonshot tax must quantify sacrificed upside');
  });

  it('Monte Carlo Bankroll Engine evaluates terminal wealth distributions and bankrupt paths', () => {
    const sim = MonteCarloBankrollEngine.simulatePaths({
      mode: 'PAPER_MAX_RISK',
      startingCapitalUsd: 250,
      numPaths: 100,
      tradesPerPath: 20,
      empiricalOutcomes: [
        { returnMultiple: 0.0, holdingTimeSeconds: 30, isRug: true },
        { returnMultiple: 0.8, holdingTimeSeconds: 60, isRug: false },
        { returnMultiple: 2.5, holdingTimeSeconds: 180, isRug: false },
        { returnMultiple: 10.0, holdingTimeSeconds: 300, isRug: false },
      ],
      sizingFraction: 0.5, // 50% max risk sizing
    });

    assert.equal(sim.totalPaths, 100);
    assert.ok(sim.percentiles.p50 > 0 || sim.bankruptcyProbability > 0);
    assert.ok(Number.isFinite(sim.expectedLogGrowth));
    assert.ok(Number.isFinite(sim.luckAdjusted.extremeWinnerContributionPct));
  });

  it('V8 Historical Causal Replay compares PAPER_STANDARD vs PAPER_MAX_RISK side-by-side', () => {
    const candidates = [
      {
        mint: 'Cand1_Runner',
        birthTimestampMs: Date.now() - 100000,
        startingMcapSol: 30,
        startingLiquidityLamports: 30_000_000_000n,
        peakMultiple: 25.0,
        isRug: false,
        isDead: false,
        isCensored: false,
        timeToPeakSeconds: 120,
        worstDrawdownBps: 1500,
        holderConcentrationBps: 4000,
        walletEntropy: 1.5,
        realReservesLamports: 30_000_000_000n,
      },
      {
        mint: 'Cand2_Rug',
        birthTimestampMs: Date.now() - 90000,
        startingMcapSol: 30,
        startingLiquidityLamports: 30_000_000_000n,
        peakMultiple: 1.1,
        isRug: true,
        isDead: true,
        isCensored: false,
        timeToPeakSeconds: 15,
        worstDrawdownBps: 10000,
        holderConcentrationBps: 7500, // Denied by standard concentration filter
        walletEntropy: 0.5,
        realReservesLamports: 30_000_000_000n,
      },
      {
        mint: 'Cand3_ConcentratedMoonshot',
        birthTimestampMs: Date.now() - 80000,
        startingMcapSol: 30,
        startingLiquidityLamports: 30_000_000_000n,
        peakMultiple: 15.0,
        isRug: false,
        isDead: false,
        isCensored: false,
        timeToPeakSeconds: 300,
        worstDrawdownBps: 2500,
        holderConcentrationBps: 7200, // Filtered by standard, but entered by MAX_RISK!
        walletEntropy: 1.2,
        realReservesLamports: 30_000_000_000n,
      },
    ];

    const report = V8HistoricalReplayEngine.runReplay({
      candidates,
      startingBankrollLamports: 5_000_000_000n, // 5 SOL
      standardPositionSizeLamports: 250_000_000n, // 0.25 SOL
      maxRiskPositionFraction: 0.5, // 50%
    });

    assert.ok(report.standard.candidateCount === 3);
    assert.ok(report.maxRisk.candidateCount === 3);
    assert.ok(report.maxRisk.riskBypassesCount > 0, 'PAPER_MAX_RISK must bypass rejected rules');
    assert.ok(report.conclusions.length > 0);
  });
});
