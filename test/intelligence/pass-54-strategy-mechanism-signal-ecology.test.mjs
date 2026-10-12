/**
 * SYLPH FUSION — PASS 54 VERIFICATION SUITE
 * Strategy Mechanism Fingerprinting & Signal Ecology-X Integration
 * Specifications: Master Blueprint Section 41 & Section XV
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrategyEcologyRegistry } from '../../dist/intelligence/signal-ecology/mechanism-fingerprint.js';
import { SignalFamilyAggregator } from '../../dist/intelligence/signal-ecology/family-aggregator.js';
import { certifySignalPortfolio } from '../../dist/intelligence/signal-ecology/signal-portfolio-certificate.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 54 Test 1: Strategy Mechanism Fingerprinting & Semantic Duplicate Detection (Section 41)', async () => {
  const registry = new StrategyEcologyRegistry();

  const baseStrategy = {
    strategyId: 'strat_alpha_momentum_v1',
    inputs: ['slot', 'price', 'liquidity', 'wallets', 'bondingCurvePct'],
    featureTransformations: ['log_return', 'inflow_ratio', 'arrival_velocity'],
    hypothesis: 'Momentum with convex liquidity cushion',
    decisionRule: 'Enter when consensus is STRONG and reachability > 0.35',
    riskRule: 'Stop loss at 25% or liquidity collapse',
    capitalRule: 'Convex Kelly bounded by 2.5% pool depth',
    executionRoute: 'Jito-Bundle with adaptive tip',
    exitRule: 'Dynamic stopping liquidation ratchet',
    targetRegime: 'RISK_ON',
  };

  const registered = registry.registerStrategy(baseStrategy);
  assert.ok(registered.fingerprintHash);
  assert.equal(typeof registered.fingerprintHash, 'string');
  assert.equal(registered.fingerprintHash.length, 64); // SHA-256 hex

  // Evaluate candidate identical in logic but renamed strategy ID
  const renamedCandidate = {
    strategyId: 'strat_renamed_copycat_v2',
    inputs: ['slot', 'price', 'liquidity', 'wallets', 'bondingCurvePct'],
    featureTransformations: ['log_return', 'inflow_ratio', 'arrival_velocity'],
    hypothesis: 'Momentum with convex liquidity cushion',
    decisionRule: 'Enter when consensus is STRONG and reachability > 0.35',
    riskRule: 'Stop loss at 25% or liquidity collapse',
    capitalRule: 'Convex Kelly bounded by 2.5% pool depth',
    executionRoute: 'Jito-Bundle with adaptive tip',
    exitRule: 'Dynamic stopping liquidation ratchet',
    targetRegime: 'RISK_ON',
  };

  const evalRenamed = registry.evaluateCandidate(renamedCandidate);
  assert.equal(evalRenamed.candidateStrategyId, 'strat_renamed_copycat_v2');
  assert.equal(evalRenamed.matchedStrategyId, 'strat_alpha_momentum_v1');
  assert.equal(evalRenamed.similarityScore, 1.0);
  assert.equal(evalRenamed.isSemanticDuplicate, true);
  assert.equal(evalRenamed.requiredOosSampleHurdle, 200);

  // Evaluate candidate with completely distinct mechanics
  const distinctCandidate = {
    strategyId: 'strat_mean_reversion_contrarian',
    inputs: ['rpc_latency', 'mempool_tip_density'],
    featureTransformations: ['fourier_transform', 'wavelet_decomposition'],
    hypothesis: 'Contrarian mean reversion on extreme slippage',
    decisionRule: 'Enter when RSI < 10 and dispersion > 2.5 sigma',
    riskRule: 'Time stop at 45 seconds',
    capitalRule: 'Fixed 0.5 SOL allocation',
    executionRoute: 'Direct TPU pipelining',
    exitRule: 'Immediate market taker dump',
    targetRegime: 'ABNORMAL',
  };

  const evalDistinct = registry.evaluateCandidate(distinctCandidate);
  assert.equal(evalDistinct.candidateStrategyId, 'strat_mean_reversion_contrarian');
  assert.ok(evalDistinct.similarityScore < 0.20);
  assert.equal(evalDistinct.isSemanticDuplicate, false);
  assert.equal(evalDistinct.inheritsFalsificationPrior, false);
  assert.equal(evalDistinct.requiredOosSampleHurdle, 100);
});

test('Pass 54 Test 2: Falsified Mechanism Negative-Knowledge & Inheritance Hurdle (Section 41)', async () => {
  const registry = new StrategyEcologyRegistry();

  const failedStrategy = {
    strategyId: 'strat_curve_chaser_failed',
    inputs: ['bondingCurvePct', 'recent_swaps'],
    featureTransformations: ['curve_acceleration'],
    hypothesis: 'Chasing bonding curve steepness near graduation',
    decisionRule: 'Buy when curve > 80%',
    riskRule: 'No stop loss, hold to Raydium',
    capitalRule: 'All-in 50% pool depth',
    executionRoute: 'Public mempool swap',
    exitRule: 'Exit at 10x or zero',
    targetRegime: 'NEUTRAL',
  };

  const registered = registry.registerStrategy(failedStrategy);

  // Record permanent negative-knowledge falsification
  registry.recordFalsifiedMechanism({
    fingerprintHash: registered.fingerprintHash,
    strategyId: registered.strategyId,
    falsifiedAt: Date.now() - 3600_000,
    falsificationReason: 'Catastrophic post-migration dump; empirical win rate < 8% over 1,000 runs',
    evidenceRoot: '0x_evidence_falsification_603',
  });

  // Candidate with exact identical fingerprint
  const exactCopyCandidate = {
    ...failedStrategy,
    strategyId: 'strat_curve_chaser_resurrected',
  };

  const evalDirect = registry.evaluateCandidate(exactCopyCandidate);
  assert.equal(evalDirect.similarityScore, 1.0);
  assert.equal(evalDirect.isSemanticDuplicate, true);
  assert.equal(evalDirect.inheritsFalsificationPrior, true);
  assert.ok(evalDirect.priorFalsificationRecord);
  assert.equal(evalDirect.priorFalsificationRecord?.strategyId, 'strat_curve_chaser_failed');
  assert.equal(evalDirect.requiredOosSampleHurdle, 500); // Maximum 500-sample penalty

  // Candidate with 80%+ similarity to the falsified strategy
  const nearCopyCandidate = {
    strategyId: 'strat_curve_chaser_tweaked',
    inputs: ['bondingCurvePct', 'recent_swaps', 'volume_1m'],
    featureTransformations: ['curve_acceleration'],
    hypothesis: 'Chasing bonding curve steepness near graduation',
    decisionRule: 'Buy when curve > 80%',
    riskRule: 'No stop loss, hold to Raydium',
    capitalRule: 'All-in 50% pool depth',
    executionRoute: 'Public mempool swap',
    exitRule: 'Exit at 10x or zero',
    targetRegime: 'NEUTRAL',
  };

  const evalNear = registry.evaluateCandidate(nearCopyCandidate);
  assert.ok(evalNear.similarityScore >= 0.80);
  assert.equal(evalNear.inheritsFalsificationPrior, true);
  assert.equal(evalNear.requiredOosSampleHurdle, 300); // 300-sample inherited penalty
});

test('Pass 54 Test 3: Signal Family Aggregation & Effective Independent Alpha Units (Section XV)', async () => {
  const aggregator = new SignalFamilyAggregator();

  const defaultQuantiles = { p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9 };

  // Case A: Redundant predictions sharing evidence root
  const redundantSpecialists = [
    { specialistId: 'spec_alpha_a', version: '1.0.0', role: 'ALPHA', target: 'Mint1', horizonSec: 300, pointEstimate: 0.85, quantiles: defaultQuantiles, uncertainty: 0.05, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_shared_alpha', evidenceAncestry: [], modelHash: 'hash_a', availableAtMs: 1000 },
    { specialistId: 'spec_alpha_b', version: '1.0.0', role: 'ALPHA', target: 'Mint1', horizonSec: 300, pointEstimate: 0.82, quantiles: defaultQuantiles, uncertainty: 0.06, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_shared_alpha', evidenceAncestry: [], modelHash: 'hash_b', availableAtMs: 1000 },
    { specialistId: 'spec_risk_1', version: '1.0.0', role: 'RISK', target: 'Mint1', horizonSec: 300, pointEstimate: 0.75, quantiles: defaultQuantiles, uncertainty: 0.04, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_risk_1', evidenceAncestry: [], modelHash: 'hash_r', availableAtMs: 1000 },
  ];

  const resRedundant = aggregator.aggregate(redundantSpecialists);
  assert.equal(resRedundant.effectiveIndependentAlphaUnits, 2); // 1 for ALPHA (shared root) + 1 for RISK
  assert.equal(resRedundant.redundancyPenalties.ALPHA, 0.5); // 1 duplicate out of 2 = 50% redundancy
  assert.equal(resRedundant.redundancyPenalties.RISK, 0);

  // Case B: 7 completely independent specialist roles
  const independentSpecialists = [
    { specialistId: 'spec_alpha_1', version: '1.0.0', role: 'ALPHA', target: 'Mint1', horizonSec: 300, pointEstimate: 0.90, quantiles: defaultQuantiles, uncertainty: 0.02, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_alpha', evidenceAncestry: [], modelHash: 'hash_1', availableAtMs: 1000 },
    { specialistId: 'spec_risk_1', version: '1.0.0', role: 'RISK', target: 'Mint1', horizonSec: 300, pointEstimate: 0.88, quantiles: defaultQuantiles, uncertainty: 0.03, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_risk', evidenceAncestry: [], modelHash: 'hash_2', availableAtMs: 1000 },
    { specialistId: 'spec_exec_1', version: '1.0.0', role: 'EXECUTION', target: 'Mint1', horizonSec: 300, pointEstimate: 0.15, quantiles: defaultQuantiles, uncertainty: 0.04, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_exec', evidenceAncestry: [], modelHash: 'hash_3', availableAtMs: 1000 },
    { specialistId: 'spec_regime_1', version: '1.0.0', role: 'REGIME', target: 'Mint1', horizonSec: 300, pointEstimate: 0.95, quantiles: defaultQuantiles, uncertainty: 0.01, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_regime', evidenceAncestry: [], modelHash: 'hash_4', availableAtMs: 1000 },
    { specialistId: 'spec_auth_1', version: '1.0.0', role: 'AUTHENTICITY', target: 'Mint1', horizonSec: 300, pointEstimate: 1.0, quantiles: defaultQuantiles, uncertainty: 0.01, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_auth', evidenceAncestry: [], modelHash: 'hash_5', availableAtMs: 1000 },
    { specialistId: 'spec_cap_1', version: '1.0.0', role: 'CAPACITY', target: 'Mint1', horizonSec: 300, pointEstimate: 0.80, quantiles: defaultQuantiles, uncertainty: 0.02, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_cap', evidenceAncestry: [], modelHash: 'hash_6', availableAtMs: 1000 },
    { specialistId: 'spec_surv_1', version: '1.0.0', role: 'SURVIVAL', target: 'Mint1', horizonSec: 300, pointEstimate: 0.92, quantiles: defaultQuantiles, uncertainty: 0.02, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_indep_surv', evidenceAncestry: [], modelHash: 'hash_7', availableAtMs: 1000 },
  ];

  const resIndependent = aggregator.aggregate(independentSpecialists);
  assert.equal(resIndependent.effectiveIndependentAlphaUnits, 7);
  for (const role of ['ALPHA', 'RISK', 'EXECUTION', 'REGIME', 'AUTHENTICITY', 'CAPACITY', 'SURVIVAL']) {
    assert.equal(resIndependent.redundancyPenalties[role], 0);
    assert.ok(resIndependent.roleAverages[role] > 0);
  }
});

test('Pass 54 Test 4: Signal Portfolio Certificate Issuance & Invariant Verification (Section XV)', async () => {
  const aggregator = new SignalFamilyAggregator();
  const defaultQuantiles = { p10: 0.1, p25: 0.25, p50: 0.5, p75: 0.75, p90: 0.9 };

  const specialists = [
    { specialistId: 'spec_alpha_1', version: '1.0.0', role: 'ALPHA', target: 'MintCert1', horizonSec: 300, pointEstimate: 0.85, quantiles: defaultQuantiles, uncertainty: 0.02, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_a', evidenceAncestry: [], modelHash: 'h_a', availableAtMs: 1000 },
    { specialistId: 'spec_risk_1', version: '1.0.0', role: 'RISK', target: 'MintCert1', horizonSec: 300, pointEstimate: 0.80, quantiles: defaultQuantiles, uncertainty: 0.03, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_r', evidenceAncestry: [], modelHash: 'h_r', availableAtMs: 1000 },
    { specialistId: 'spec_surv_1', version: '1.0.0', role: 'SURVIVAL', target: 'MintCert1', horizonSec: 300, pointEstimate: 0.90, quantiles: defaultQuantiles, uncertainty: 0.02, supportedContext: ['PUMP_CURVE'], evidenceRoot: 'root_s', evidenceAncestry: [], modelHash: 'h_s', availableAtMs: 1000 },
  ];

  const aggregation = aggregator.aggregate(specialists);

  // Invariant: separate 7 roles, never collapsed into one single score
  const soundProfile = {
    alphaScore: 0.85,
    riskScore: 0.80,
    executionCostBps: 120,
    regimeConfidence: 0.92,
    authenticityProven: true,
    capacityUsd: 12_500,
    survivalProbability: 0.88,
  };

  const soundCert = certifySignalPortfolio({
    targetMint: 'MintCert1',
    slot: 290100200n,
    aggregation,
    roleProfile: soundProfile,
  });

  assert.ok(soundCert.certificateId.startsWith('spc_'));
  assert.equal(soundCert.targetMint, 'MintCert1');
  assert.equal(soundCert.slot, 290100200n);
  assert.equal(soundCert.effectiveIndependentAlphaUnits, 3);
  assert.equal(soundCert.isEcologySound, true);
  assert.equal(soundCert.roleProfile.authenticityProven, true);
  assert.equal(soundCert.roleProfile.survivalProbability, 0.88);
  assert.equal(soundCert.certificateHash.length, 64);

  // Deficient ecology test: low survival probability (< 0.70)
  const deficientSurvivalProfile = {
    ...soundProfile,
    survivalProbability: 0.45,
  };

  const deficientCert = certifySignalPortfolio({
    targetMint: 'MintCert1',
    slot: 290100200n,
    aggregation,
    roleProfile: deficientSurvivalProfile,
  });

  assert.equal(deficientCert.isEcologySound, false);

  // Deficient ecology test: authenticity unproven
  const unprovenAuthProfile = {
    ...soundProfile,
    authenticityProven: false,
  };

  const unprovenCert = certifySignalPortfolio({
    targetMint: 'MintCert1',
    slot: 290100200n,
    aggregation,
    roleProfile: unprovenAuthProfile,
  });

  assert.equal(unprovenCert.isEcologySound, false);
});

test('Pass 54 Test 5: Master Orchestrator Decision Kernel Gating & ViewModel Telemetry (Blueprint Section 41 & Section XV)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_900_000;
  const baseEvent = {
    eventId: 'evt_pass_54_test',
    mint: 'MintTokenEcology5411111111111111111111111111111',
    signature: '5sig_pass54_ecology',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 49020,
    slot: 591_200,
    parentSlot: 591_199,
    blockhash: 'BhashPass54Ecology',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'ECOL54',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const baseWallets = [
    { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
    { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
    { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
  ];

  const normalContext = {
    tokenAgeSec: 45,
    marketCapSol: 100,
    liquiditySol: 30,
    txCount: 8,
    rawWallets: baseWallets,
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 10,
  };

  // Run normal pipeline
  const result = await engine.processEvent(baseEvent, normalContext);
  assert.ok(result.mechanismEvaluation);
  assert.ok(result.signalPortfolioCertificate);
  assert.equal(result.signalPortfolioCertificate.targetMint, baseEvent.mint);
  assert.ok(result.signalPortfolioCertificate.certificateId.startsWith('spc_'));

  const vm = result.viewModel;
  assert.ok(vm);
  assert.ok(vm.mechanismEvaluation);
  assert.ok(vm.signalPortfolioCertificate);
  assert.equal(typeof vm.isEcologySound, 'boolean');
  assert.ok(vm.effectiveIndependentAlphaUnits >= 1);
  assert.equal(vm.inheritsFalsificationPrior, false);

  // Test 5B: Falsification prior gating
  const falsifiedContext = {
    ...normalContext,
    enforceMechanismEcologyGating: true,
    mechanismEvaluation: {
      candidateStrategyId: 'strat_candidate_falsified',
      matchedStrategyId: 'strat_known_dead_prior',
      similarityScore: 0.95,
      isSemanticDuplicate: true,
      inheritsFalsificationPrior: true,
      requiredOosSampleHurdle: 500,
    },
  };

  const falsifiedResult = await engine.processEvent(baseEvent, falsifiedContext);
  assert.equal(falsifiedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(falsifiedResult.whyExecutionBlocked?.includes('STRATEGY MECHANISM FALSIFIED PRIOR'));

  // Test 5C: Deficient signal portfolio ecology gating
  const deficientContext = {
    ...normalContext,
    enforceSignalPortfolioGating: true,
    signalPortfolioCertificate: {
      certificateId: 'spc_deficient_123',
      targetMint: baseEvent.mint,
      slot: BigInt(baseEvent.slot),
      roleProfile: {
        alphaScore: 0.2,
        riskScore: 0.1,
        executionCostBps: 900,
        regimeConfidence: 0.3,
        authenticityProven: false,
        capacityUsd: 100,
        survivalProbability: 0.25,
      },
      effectiveIndependentAlphaUnits: 1,
      alphaConcentrationBps: 10000,
      redundancyPenalties: {},
      isEcologySound: false,
      certificateHash: 'hash_def_123',
      issuedAtMs: Date.now(),
    },
  };

  const deficientResult = await engine.processEvent(baseEvent, deficientContext);
  assert.equal(deficientResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(deficientResult.whyExecutionBlocked?.includes('SIGNAL PORTFOLIO ECOLOGY DEFICIENT'));
});
