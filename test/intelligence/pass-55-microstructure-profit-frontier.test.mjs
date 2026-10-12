/**
 * SYLPH FUSION — PASS 55 VERIFICATION SUITE
 * Market Microstructure-X (Sell Hazard, MEV Contamination, Barrier Fatigue) & Profit Frontier-X Certification
 * Specifications: Master Blueprint Sections 16, 20, 30 & Section LI
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SellHazardEngine,
  MevContaminationEngine,
  BarrierFatigueEngine,
} from '../../dist/intelligence/microstructure/microstructure-x.js';
import { certifyProfitFrontier } from '../../dist/intelligence/profit-frontier/index.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 55 Test 1: SellHazardEngine Evaluation & Holder Supply Overhang Invariants (Section 20)', async () => {
  const mint = 'MintSellHazardTest11111111111111111111111111';
  const currentPriceUsd = 0.005;

  // Safe holders portfolio
  const safeHolders = [
    {
      wallet: 'holder_organic_1',
      balanceTokens: 50_000_000n,
      costBasisUsd: 0.004, // small profit (+25%)
      isDevOrCabal: false,
      acquisitionTimeMs: Date.now() - 30_000,
    },
    {
      wallet: 'holder_organic_2',
      balanceTokens: 50_000_000n,
      costBasisUsd: 0.006, // underwater (-16%)
      isDevOrCabal: false,
      acquisitionTimeMs: Date.now() - 20_000,
    },
  ];

  const safeProfile = SellHazardEngine.evaluateSellHazard(mint, currentPriceUsd, safeHolders);
  assert.equal(safeProfile.mint, mint);
  assert.equal(safeProfile.currentPriceUsd, currentPriceUsd);
  assert.equal(safeProfile.profitOverhangPct, 0); // neither is > +50% gain
  assert.ok(safeProfile.totalSellHazard < 0.65);
  assert.equal(safeProfile.canSafelyAbsorbSell, true);

  // Critical dump hazard portfolio (Dev owns large share with >100% gain)
  const devDumpHolders = [
    {
      wallet: 'dev_wallet_1',
      balanceTokens: 70_000_000n, // 70% of supply
      costBasisUsd: 0.001, // 400% gain!
      isDevOrCabal: true,
      acquisitionTimeMs: Date.now() - 60_000,
    },
    {
      wallet: 'holder_retail_1',
      balanceTokens: 30_000_000n,
      costBasisUsd: 0.005,
      isDevOrCabal: false,
      acquisitionTimeMs: Date.now() - 10_000,
    },
  ];

  const criticalProfile = SellHazardEngine.evaluateSellHazard(mint, currentPriceUsd, devDumpHolders, 'dev_wallet_1');
  assert.equal(criticalProfile.profitOverhangPct, 0.7); // 70% in massive profit
  assert.equal(criticalProfile.devDumpHazard, 1.0); // maxed dev dump hazard
  assert.ok(criticalProfile.totalSellHazard >= 0.65);
  assert.equal(criticalProfile.canSafelyAbsorbSell, false); // INVARIANT: blocked
});

test('Pass 55 Test 2: MevContaminationEngine Trade Stream Filtration & Price Discovery (Section 30)', async () => {
  const mint = 'MintMevContamTest11111111111111111111111111';

  // Case A: Organic retail trade flow (< 40% MEV)
  const organicTrades = [
    { solAmount: 5.0, isMev: false },
    { solAmount: 4.0, isMev: false },
    { solAmount: 1.0, isMev: true },
  ];

  const organicReport = MevContaminationEngine.evaluateContamination(organicTrades, mint);
  assert.equal(organicReport.mint, mint);
  assert.equal(organicReport.totalVolumeSol, 10.0);
  assert.equal(organicReport.mevVolumeSol, 1.0);
  assert.equal(organicReport.organicVolumeSol, 9.0);
  assert.equal(organicReport.mevContaminationRatio, 0.1);
  assert.equal(organicReport.organicPriceDiscoveryRatio, 0.9);
  assert.equal(organicReport.isContaminated, false);

  // Case B: MEV dominated sandwich volume (>= 40% MEV)
  const contaminatedTrades = [
    { solAmount: 2.0, isMev: false },
    { solAmount: 5.0, isMev: true }, // sandwich frontrun
    { solAmount: 5.0, isMev: true }, // sandwich backrun
  ];

  const contaminatedReport = MevContaminationEngine.evaluateContamination(contaminatedTrades, mint);
  assert.equal(contaminatedReport.totalVolumeSol, 12.0);
  assert.equal(contaminatedReport.mevVolumeSol, 10.0);
  assert.ok(contaminatedReport.mevContaminationRatio >= 0.40);
  assert.equal(contaminatedReport.isContaminated, true); // INVARIANT: contaminated
});

test('Pass 55 Test 3: BarrierFatigueEngine Repricing Efficiency & Trapped Inventory (Section 16)', async () => {
  const record = BarrierFatigueEngine.recordAttempt({
    attemptId: 'bar_attempt_pass55_1',
    targetBarrierMultiplier: 2.0,
    independentCapitalSpentSol: 15.0,
    mechanicalCapitalSpentSol: 5.0,
    startPriceUsd: 0.002,
    endPriceUsd: 0.0042, // achieved 2.1x (> 2.0 * 0.95)
    trappedInventoryTokens: 25_000_000_000n,
  });

  assert.equal(record.attemptId, 'bar_attempt_pass55_1');
  assert.equal(record.targetBarrierMultiplier, 2.0);
  assert.equal(record.isSuccess, true);
  assert.equal(Number(record.durableRepricingUsd.toFixed(4)), 0.0022);
  assert.ok(record.attemptEfficiency > 0);
  assert.equal(record.trappedInventoryTokens, 25_000_000_000n);
});

test('Pass 55 Test 4: Profit Frontier-X ROI Optimization & Deterministic Certificate Issuance (Section LI)', async () => {
  const candidates = [
    {
      candidateId: 'ENG_SUBMISSION_PIPELINE',
      targetSubsystem: 'EXECUTION_ROUTER',
      expectedImprovementBps: 200,
      estimatedEffortHours: 10, // ROI = 2500 / 10 = 250
      reversibility: 'EASY',
      evpiUsd: 1200,
      expectedNetBenefitUsd: 2500,
      proposedAtMs: 1000,
    },
    {
      candidateId: 'ENG_MICROSTRUCTURE_PROFILER',
      targetSubsystem: 'MARKET_MICROSTRUCTURE',
      expectedImprovementBps: 120,
      estimatedEffortHours: 2, // ROI = 1000 / 2 = 500 (Optimal!)
      reversibility: 'EASY',
      evpiUsd: 600,
      expectedNetBenefitUsd: 1000,
      proposedAtMs: 1000,
    },
  ];

  const cert = certifyProfitFrontier(candidates);
  assert.ok(cert.certificateId.startsWith('frc_'));
  assert.equal(cert.optimalCandidateId, 'ENG_MICROSTRUCTURE_PROFILER'); // highest ROI
  assert.equal(cert.targetSubsystem, 'MARKET_MICROSTRUCTURE');
  assert.equal(cert.expectedNetBenefitUsd, 1000);
  assert.equal(cert.paretoCandidates.length, 2);
  assert.equal(cert.certificateHash.length, 64); // SHA-256 hex

  // Empty candidates fallback
  const emptyCert = certifyProfitFrontier([]);
  assert.ok(emptyCert.certificateId.startsWith('frc_'));
  assert.equal(emptyCert.optimalCandidateId, 'none');
  assert.equal(emptyCert.expectedNetBenefitUsd, 0);
});

test('Pass 55 Test 5: Master Orchestrator Decision Kernel Gating & ViewModel Telemetry (Sections 16, 20, 30, LI)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 5_100_000;
  const baseEvent = {
    eventId: 'evt_pass_55_test',
    mint: 'MintTokenMicrostructure551111111111111111111',
    signature: '5sig_pass55_micro',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51020,
    slot: 592_500,
    parentSlot: 592_499,
    blockhash: 'BhashPass55Micro',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'MICR55',
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
  assert.ok(result.sellHazard);
  assert.ok(result.mevContamination);
  assert.ok(result.barrierFatigue);
  assert.ok(result.frontierCertificate);
  assert.ok(result.frontierCertificate.certificateId.startsWith('frc_'));

  const vm = result.viewModel;
  assert.ok(vm);
  assert.ok(vm.sellHazard);
  assert.ok(vm.mevContamination);
  assert.ok(vm.barrierFatigue);
  assert.ok(vm.frontierCertificate);
  assert.equal(typeof vm.isMevContaminated, 'boolean');
  assert.equal(typeof vm.mevContaminationRatio, 'number');
  assert.equal(typeof vm.totalSellHazard, 'number');
  assert.equal(typeof vm.canSafelyAbsorbSell, 'boolean');

  // Test 5B: Gating under excessive MEV contamination (>= 40%)
  const contaminatedContext = {
    ...normalContext,
    enforceMevContaminationGating: true,
    mevContamination: {
      mint: baseEvent.mint,
      totalVolumeSol: 100.0,
      mevVolumeSol: 65.0,
      organicVolumeSol: 35.0,
      mevContaminationRatio: 0.65,
      organicPriceDiscoveryRatio: 0.35,
      isContaminated: true,
    },
  };

  const contaminatedResult = await engine.processEvent(baseEvent, contaminatedContext);
  assert.equal(contaminatedResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(contaminatedResult.whyExecutionBlocked?.includes('MEV CONTAMINATION EXCESSIVE'));
  assert.ok(contaminatedResult.whyExecutionBlocked?.includes('65.0% >= 40%'));

  // Test 5C: Gating under critical sell hazard overhang
  const sellHazardContext = {
    ...normalContext,
    enforceSellHazardGating: true,
    sellHazard: {
      mint: baseEvent.mint,
      currentPriceUsd: 0.005,
      profitOverhangPct: 0.80,
      breakEvenOverhangPct: 0.10,
      underwaterSupplyPct: 0.10,
      devDumpHazard: 0.90,
      cabalDumpHazard: 0.60,
      totalSellHazard: 0.85,
      canSafelyAbsorbSell: false,
    },
  };

  const sellHazardResult = await engine.processEvent(baseEvent, sellHazardContext);
  assert.equal(sellHazardResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(sellHazardResult.whyExecutionBlocked?.includes('CRITICAL SELL HAZARD OVERHANG'));
  assert.ok(sellHazardResult.whyExecutionBlocked?.includes('Hazard: 85.0%'));
});
