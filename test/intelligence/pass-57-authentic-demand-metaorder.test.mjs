/**
 * SYLPH FUSION — PASS 57 VERIFICATION SUITE
 * Microstructure Authentic Demand, Metaorder Inference & Participant Ecology Integration
 * Specifications: Master Blueprint Section 3 (Sol Agent 2), Section 17 (Authentic Demand & Sybil Purging),
 * Section 18 (Metaorders & Reversion Hazard), Section 19 (Wallets & Participant Ecology).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthenticDemandEngine,
  MetaorderIntelligenceEngine,
  ParticipantEcologyEngine,
} from '../../dist/intelligence/microstructure/microstructure-x.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 57 Test 1: AuthenticDemandEngine Sybil Purging & Unique Buyer Invariants (Section 17)', async () => {
  const mint = 'MintAuthenticDemandTest11111111111111111111111';

  // 1. Sybil cluster: 5 buyers all funded by the same root
  const sybilBuyers = [
    { wallet: 'w_sybil_1', fundingRoot: 'common_funder', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w_sybil_2', fundingRoot: 'common_funder', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w_sybil_3', fundingRoot: 'common_funder', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w_sybil_4', fundingRoot: 'common_funder', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w_sybil_5', fundingRoot: 'common_funder', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
  ];
  const sellers = [
    { wallet: 'w_seller_1', fundingRoot: 'seller_funder', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 0.5 },
  ];

  const sybilProfile = AuthenticDemandEngine.evaluateDemand(mint, 45, sybilBuyers, sellers);
  assert.equal(sybilProfile.rawBuyerCount, 5);
  assert.equal(sybilProfile.effectiveBuyerCount, 1); // Purged into 1 independent entity!
  assert.equal(sybilProfile.passesUniqueBuyerCheck, false); // INVARIANT: < 5 entities fails!

  // 2. Authentic organic demand: 6 independent buyers with distinct funding roots
  const organicBuyers = [
    { wallet: 'w_org_1', fundingRoot: 'binance_hot', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 2.0 },
    { wallet: 'w_org_2', fundingRoot: 'coinbase_hot', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.5 },
    { wallet: 'w_org_3', fundingRoot: 'kraken_hot', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 3.0 },
    { wallet: 'w_org_4', fundingRoot: 'bybit_hot', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w_org_5', fundingRoot: 'okx_hot', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 2.5 },
    { wallet: 'w_org_6', fundingRoot: 'kucoin_hot', isWashSuspect: false, isSubDust: false, isSniper: true, solAmount: 0.5 }, // Sniper recirculated
  ];

  const organicProfile = AuthenticDemandEngine.evaluateDemand(mint, 45, organicBuyers, sellers);
  assert.equal(organicProfile.effectiveBuyerCount, 6);
  assert.equal(organicProfile.passesUniqueBuyerCheck, true); // INVARIANT: >= 5 entities passes
  assert.equal(organicProfile.meetsAntiSniperBaseline, true);
  assert.ok(organicProfile.freshCapitalSol >= 10.0);
  assert.equal(organicProfile.recirculatedCapitalSol, 0.5);
  assert.ok(organicProfile.meaningfulBuyerBreadth > 0.5);
});

test('Pass 57 Test 2: MetaorderIntelligenceEngine Algorithmic Cadence & Reversion Hazard (Section 18)', async () => {
  const baseTime = 1_000_000;

  // 1. Regular algorithmic buying cadence (spaced 2.0s apart, CV = 0)
  const algoTrades = [
    { wallet: 'algo_wallet_1', timestampMs: baseTime, solAmount: 1.0, isBuy: true },
    { wallet: 'algo_wallet_1', timestampMs: baseTime + 2000, solAmount: 1.0, isBuy: true },
    { wallet: 'algo_wallet_1', timestampMs: baseTime + 4000, solAmount: 1.0, isBuy: true },
    { wallet: 'algo_wallet_1', timestampMs: baseTime + 6000, solAmount: 1.0, isBuy: true },
    { wallet: 'algo_wallet_1', timestampMs: baseTime + 8000, solAmount: 1.0, isBuy: true },
  ];

  const metaorder = MetaorderIntelligenceEngine.inferMetaorder(algoTrades);
  assert.ok(metaorder);
  assert.equal(metaorder.direction, 'BUY');
  assert.equal(metaorder.probableEntity, 'algo_wallet_1');
  assert.equal(metaorder.childCount, 5);
  assert.equal(metaorder.childNotionalSol, 5.0);
  assert.equal(metaorder.cadenceSeconds, 2.0);
  assert.ok(metaorder.confidence >= 0.85); // High confidence on regular interval

  // 2. Algorithmic sell dump
  const algoSellTrades = [
    { wallet: 'dump_algo_1', timestampMs: baseTime, solAmount: 5.0, isBuy: false },
    { wallet: 'dump_algo_1', timestampMs: baseTime + 1500, solAmount: 5.0, isBuy: false },
    { wallet: 'dump_algo_1', timestampMs: baseTime + 3000, solAmount: 5.0, isBuy: false },
  ];
  const sellMetaorder = MetaorderIntelligenceEngine.inferMetaorder(algoSellTrades);
  assert.ok(sellMetaorder);
  assert.equal(sellMetaorder.direction, 'SELL');

  // 3. Random irregular human cadence
  const humanTrades = [
    { wallet: 'human_wallet', timestampMs: baseTime, solAmount: 1.0, isBuy: true },
    { wallet: 'human_wallet', timestampMs: baseTime + 500, solAmount: 1.0, isBuy: true },
    { wallet: 'human_wallet', timestampMs: baseTime + 18000, solAmount: 1.0, isBuy: true },
  ];
  const humanMetaorder = MetaorderIntelligenceEngine.inferMetaorder(humanTrades);
  assert.ok(humanMetaorder);
  assert.ok(humanMetaorder.confidence <= 0.25); // Irregular intervals = low confidence
});

test('Pass 57 Test 3: ParticipantEcologyEngine Wallet Role Classification (Section 3)', async () => {
  // 1. Dev Insider
  const dev = ParticipantEcologyEngine.classifyWallet({
    firstTxAgeSeconds: 10,
    avgHoldDurationSeconds: 100,
    sandwichCount: 0,
    isDev: true,
    clusterSize: 1,
  });
  assert.equal(dev.role, 'DEV_INSIDER');
  assert.equal(dev.confidence, 1.0);

  // 2. MEV Sandwich Bot
  const mev = ParticipantEcologyEngine.classifyWallet({
    firstTxAgeSeconds: 50,
    avgHoldDurationSeconds: 5,
    sandwichCount: 3,
    isDev: false,
    clusterSize: 1,
  });
  assert.equal(mev.role, 'MEV_SANDWICH');

  // 3. Sniper
  const sniper = ParticipantEcologyEngine.classifyWallet({
    firstTxAgeSeconds: 1,
    avgHoldDurationSeconds: 10,
    sandwichCount: 0,
    isDev: false,
    clusterSize: 1,
  });
  assert.equal(sniper.role, 'SNIPER');

  // 4. Cabal Member
  const cabal = ParticipantEcologyEngine.classifyWallet({
    firstTxAgeSeconds: 30,
    avgHoldDurationSeconds: 400,
    sandwichCount: 0,
    isDev: false,
    clusterSize: 6,
  });
  assert.equal(cabal.role, 'CABAL_MEMBER');

  // 5. Diamond Holder
  const diamond = ParticipantEcologyEngine.classifyWallet({
    firstTxAgeSeconds: 300,
    avgHoldDurationSeconds: 2400,
    sandwichCount: 0,
    isDev: false,
    clusterSize: 1,
  });
  assert.equal(diamond.role, 'DIAMOND_HOLDER');

  // 6. Organic Retail
  const retail = ParticipantEcologyEngine.classifyWallet({
    firstTxAgeSeconds: 200,
    avgHoldDurationSeconds: 300,
    sandwichCount: 0,
    isDev: false,
    clusterSize: 1,
  });
  assert.equal(retail.role, 'ORGANIC_RETAIL');
});

test('Pass 57 Test 4: Decision Kernel Fail-Closed Gating Under Sybil Demand, Adverse Metaorder & Cabal Ecology', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);
  const eventTime = Date.now() - 500;

  const baseEvent = {
    eventId: 'evt_pass57_gating',
    mint: 'MintTokenDemandEcology5711111111111111111111',
    signature: '5sig_pass57_gating',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51320,
    slot: 593_500,
    parentSlot: 593_499,
    blockhash: 'BhashPass57Gating',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'DEMAND57',
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

  // Test 4A: Gating under insufficient authentic demand (Sybil clustering)
  const sybilDemandContext = {
    ...normalContext,
    enforceAuthenticDemandGating: true,
    authenticDemand: {
      mint: baseEvent.mint,
      rawBuyerCount: 8,
      effectiveBuyerCount: 2, // Only 2 independent entities!
      rawSellerCount: 1,
      effectiveSellerCount: 1,
      meaningfulBuyerBreadth: 0.25,
      controllerAdjustedBreadth: 0.25,
      freshCapitalSol: 1.5,
      recirculatedCapitalSol: 0.0,
      meetsAntiSniperBaseline: false,
      passesUniqueBuyerCheck: false,
    },
  };

  const sybilResult = await engine.processEvent(baseEvent, sybilDemandContext);
  assert.equal(sybilResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(sybilResult.whyExecutionBlocked?.includes('INSUFFICIENT AUTHENTIC DEMAND'));
  assert.ok(sybilResult.whyExecutionBlocked?.includes('Effective Buyers: 2 < 5'));

  // Test 4B: Gating under adverse sell metaorder
  const sellMetaorderContext = {
    ...normalContext,
    enforceMetaorderGating: true,
    inferredMetaorder: {
      orderId: 'meta_dump_1',
      direction: 'SELL',
      probableEntity: 'cabal_dumper_1',
      confidence: 0.88,
      childCount: 4,
      childNotionalSol: 20.0,
      estimatedTotalSol: 30.0,
      estimatedRemainingSol: 10.0,
      cadenceSeconds: 1.5,
      completionProbability: 0.67,
      informationProbability: 0.70,
      programReversionHazard: 0.10,
    },
  };

  const metaorderResult = await engine.processEvent(baseEvent, sellMetaorderContext);
  assert.equal(metaorderResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(metaorderResult.whyExecutionBlocked?.includes('ADVERSE METAORDER INFERRED'));
  assert.ok(metaorderResult.whyExecutionBlocked?.includes('Direction: SELL'));

  // Test 4C: Gating under adverse participant ecology (Cabal cluster)
  const cabalContext = {
    ...normalContext,
    enforceParticipantEcologyGating: true,
    participantEcology: {
      wallet: 'cabal_leader',
      role: 'CABAL_MEMBER',
      confidence: 0.90,
    },
  };

  const cabalResult = await engine.processEvent(baseEvent, cabalContext);
  assert.equal(cabalResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(cabalResult.whyExecutionBlocked?.includes('ADVERSE PARTICIPANT ECOLOGY'));
  assert.ok(cabalResult.whyExecutionBlocked?.includes('CABAL_MEMBER'));
});

test('Pass 57 Test 5: ViewModel Projection and Telemetry Strip Invariants (Sections 3, 17, 18, 19)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);
  const eventTime = Date.now() - 500;

  const baseEvent = {
    eventId: 'evt_pass57_vm_proj',
    mint: 'MintTokenDemandVM571111111111111111111111111',
    signature: '5sig_pass57_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 51350,
    slot: 593_600,
    parentSlot: 593_599,
    blockhash: 'BhashPass57VM',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'DEMANDVM57',
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

  const result = await engine.processEvent(baseEvent, normalContext);
  assert.ok(result.viewModel);

  const vm = result.viewModel;
  assert.ok(vm.authenticDemand);
  assert.equal(typeof vm.effectiveBuyerCount, 'number');
  assert.equal(typeof vm.meaningfulBuyerBreadth, 'number');
  assert.equal(typeof vm.passesUniqueBuyerCheck, 'boolean');
  assert.equal(typeof vm.meetsAntiSniperBaseline, 'boolean');
  assert.equal(typeof vm.participantEcologyRole, 'string');
  assert.ok(['DEV_INSIDER', 'MEV_SANDWICH', 'SNIPER', 'CABAL_MEMBER', 'ORGANIC_RETAIL', 'DIAMOND_HOLDER'].includes(vm.participantEcologyRole));
});
