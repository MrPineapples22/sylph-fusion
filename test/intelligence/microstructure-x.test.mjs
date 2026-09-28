import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AuthenticDemandEngine,
  MetaorderIntelligenceEngine,
  SellHazardEngine,
  ParticipantEcologyEngine,
  CapitalTournamentEngine,
  BarrierFatigueEngine,
  MevContaminationEngine,
} from '../../dist/intelligence/microstructure/microstructure-x.js';

test('AuthenticDemandEngine: enforces Sybil clustering, anti-sniper baseline, and <5 unique buyers penalty', () => {
  // Scenario 1: 5 raw buyers, but 3 share the same funding root -> only 3 effective buyers
  const buyersSybil = [
    { wallet: 'w1', fundingRoot: 'cabal_root', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w2', fundingRoot: 'cabal_root', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w3', fundingRoot: 'cabal_root', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'w4', fundingRoot: 'independent_1', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 2.0 },
    { wallet: 'w5', fundingRoot: 'independent_2', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.5 },
  ];

  const profile1 = AuthenticDemandEngine.evaluateDemand('mint_sybil', 12, buyersSybil, []);
  assert.equal(profile1.rawBuyerCount, 5);
  assert.equal(profile1.effectiveBuyerCount, 3); // cabal_root + independent_1 + independent_2
  assert.equal(profile1.passesUniqueBuyerCheck, false); // < 5 unique buyers
  assert.equal(profile1.meetsAntiSniperBaseline, true); // age >= 10s & effectiveBuyers >= 3

  // Scenario 2: Age 4 seconds (violates anti-sniper baseline)
  const profile2 = AuthenticDemandEngine.evaluateDemand('mint_young', 4, buyersSybil, []);
  assert.equal(profile2.meetsAntiSniperBaseline, false);

  // Scenario 3: Clean independent buyers
  const cleanBuyers = [
    { wallet: 'c1', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'c2', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'c3', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'c4', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'c5', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
    { wallet: 'c6', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: 1.0 },
  ];
  const profile3 = AuthenticDemandEngine.evaluateDemand('mint_clean', 25, cleanBuyers, []);
  assert.equal(profile3.effectiveBuyerCount, 6);
  assert.equal(profile3.passesUniqueBuyerCheck, true);
  assert.equal(profile3.meetsAntiSniperBaseline, true);
  assert.equal(profile3.freshCapitalSol, 6.0);
});

test('MetaorderIntelligenceEngine: detects algorithmic child orders with regular interval cadence', () => {
  const algoTrades = [
    { wallet: 'bot_entity_1', timestampMs: 1000, solAmount: 0.5, isBuy: true },
    { wallet: 'bot_entity_1', timestampMs: 3000, solAmount: 0.5, isBuy: true }, // interval 2s
    { wallet: 'bot_entity_1', timestampMs: 5000, solAmount: 0.5, isBuy: true }, // interval 2s
    { wallet: 'bot_entity_1', timestampMs: 7000, solAmount: 0.5, isBuy: true }, // interval 2s
  ];

  const metaorder = MetaorderIntelligenceEngine.inferMetaorder(algoTrades);
  assert.notEqual(metaorder, null);
  assert.equal(metaorder.direction, 'BUY');
  assert.equal(metaorder.childCount, 4);
  assert.equal(metaorder.childNotionalSol, 2.0);
  assert.equal(metaorder.confidence >= 0.8, true);
  assert.equal(metaorder.cadenceSeconds, 2.0);
});

test('SellHazardEngine: computes cost basis distribution, profit overhang, and dev dump hazard', () => {
  const holders = [
    { wallet: 'dev_wallet', balanceTokens: 30_000_000n, costBasisUsd: 0.0001, isDevOrCabal: true, acquisitionTimeMs: 1000 },
    { wallet: 'cabal_wallet', balanceTokens: 20_000_000n, costBasisUsd: 0.0001, isDevOrCabal: true, acquisitionTimeMs: 1500 },
    { wallet: 'holder_profit', balanceTokens: 20_000_000n, costBasisUsd: 0.0001, isDevOrCabal: false, acquisitionTimeMs: 2000 },
    { wallet: 'holder_breakeven', balanceTokens: 30_000_000n, costBasisUsd: 0.00035, isDevOrCabal: false, acquisitionTimeMs: 3000 },
  ];

  const hazard = SellHazardEngine.evaluateSellHazard('mint_hazard', 0.0004, holders, 'dev_wallet');
  assert.equal(hazard.devDumpHazard >= 0.8, true);
  assert.equal(hazard.cabalDumpHazard >= 0.4, true);
  assert.equal(hazard.profitOverhangPct >= 0.6, true);
  assert.equal(hazard.totalSellHazard > 0.65, true);
  assert.equal(hazard.canSafelyAbsorbSell, false);
});

test('ParticipantEcologyEngine: classifies ecological niches correctly', () => {
  const dev = ParticipantEcologyEngine.classifyWallet({ firstTxAgeSeconds: 0, avgHoldDurationSeconds: 10, sandwichCount: 0, isDev: true, clusterSize: 1 });
  assert.equal(dev.role, 'DEV_INSIDER');

  const mev = ParticipantEcologyEngine.classifyWallet({ firstTxAgeSeconds: 5, avgHoldDurationSeconds: 2, sandwichCount: 5, isDev: false, clusterSize: 1 });
  assert.equal(mev.role, 'MEV_SANDWICH');

  const sniper = ParticipantEcologyEngine.classifyWallet({ firstTxAgeSeconds: 1, avgHoldDurationSeconds: 15, sandwichCount: 0, isDev: false, clusterSize: 1 });
  assert.equal(sniper.role, 'SNIPER');

  const diamond = ParticipantEcologyEngine.classifyWallet({ firstTxAgeSeconds: 300, avgHoldDurationSeconds: 3600, sandwichCount: 0, isDev: false, clusterSize: 1 });
  assert.equal(diamond.role, 'DIAMOND_HOLDER');
});

test('CapitalTournamentEngine: evaluates relative capital share and ranks competitive leaders', () => {
  const status1 = CapitalTournamentEngine.evaluateRank('mint_leader', 350, 1000, 25, 5000, 1200);
  assert.equal(status1.capitalSharePct, 35);
  assert.equal(status1.capitalShareMomentum, 10);
  assert.equal(status1.tournamentRank, 'DOMINANT');

  const status2 = CapitalTournamentEngine.evaluateRank('mint_losing', 20, 1000, 10, 5000, 1200);
  assert.equal(status2.capitalSharePct, 2);
  assert.equal(status2.capitalShareMomentum, -8);
  assert.equal(status2.tournamentRank, 'LOSING');
});

test('BarrierFatigueEngine: records attempts and computes attempt efficiency', () => {
  const attempt = BarrierFatigueEngine.recordAttempt({
    attemptId: 'att_2x_1',
    targetBarrierMultiplier: 2,
    independentCapitalSpentSol: 50,
    mechanicalCapitalSpentSol: 10,
    startPriceUsd: 0.001,
    endPriceUsd: 0.0021,
    trappedInventoryTokens: 100_000n,
  });

  assert.equal(attempt.isSuccess, true);
  assert.equal(attempt.durableRepricingUsd > 0.001, true);
  assert.equal(attempt.attemptEfficiency > 0, true);
});

test('MevContaminationEngine: identifies MEV volume and flags contamination above 40%', () => {
  const trades = [
    { solAmount: 30, isMev: false },
    { solAmount: 30, isMev: false },
    { solAmount: 40, isMev: true }, // 40% MEV
  ];

  const report = MevContaminationEngine.evaluateContamination(trades, 'mint_mev');
  assert.equal(report.totalVolumeSol, 100);
  assert.equal(report.mevVolumeSol, 40);
  assert.equal(report.mevContaminationRatio, 0.40);
  assert.equal(report.isContaminated, true);
});

test('rejects invalid market inputs before deriving ratios and ranks', () => {
  assert.throws(() => AuthenticDemandEngine.evaluateDemand('mint', NaN, [], []), RangeError);
  assert.throws(() => AuthenticDemandEngine.evaluateDemand('mint', 10, [
    { wallet: 'w', isWashSuspect: false, isSubDust: false, isSniper: false, solAmount: -1 },
  ], []), RangeError);
  assert.throws(() => SellHazardEngine.evaluateSellHazard('mint', 1, [
    { wallet: 'w', balanceTokens: -1n, costBasisUsd: 1, isDevOrCabal: false, acquisitionTimeMs: 0 },
  ]), RangeError);
  assert.throws(() => CapitalTournamentEngine.evaluateRank('mint', 101, 100, 0, 0, 0), RangeError);
  assert.throws(() => BarrierFatigueEngine.recordAttempt({
    attemptId: 'a', targetBarrierMultiplier: 2, independentCapitalSpentSol: 1,
    mechanicalCapitalSpentSol: 0, startPriceUsd: 0, endPriceUsd: 1,
    trappedInventoryTokens: 0n,
  }), RangeError);
  assert.throws(() => MevContaminationEngine.evaluateContamination([{ solAmount: Infinity, isMev: false }], 'mint'), RangeError);
});

test('insufficient activity never asserts sell absorption or organic price discovery', () => {
  assert.equal(SellHazardEngine.evaluateSellHazard('mint', 1, []).canSafelyAbsorbSell, false);
  const empty = MevContaminationEngine.evaluateContamination([], 'mint');
  assert.equal(empty.totalVolumeSol, 0);
  assert.equal(empty.organicPriceDiscoveryRatio, 0);
});

test('metaorder inference rejects mixed and out-of-order child trades', () => {
  const children = [
    { wallet: 'a', timestampMs: 1, solAmount: 1, isBuy: true },
    { wallet: 'a', timestampMs: 2, solAmount: 1, isBuy: true },
    { wallet: 'b', timestampMs: 3, solAmount: 1, isBuy: true },
  ];
  assert.equal(MetaorderIntelligenceEngine.inferMetaorder(children), null);
  assert.equal(MetaorderIntelligenceEngine.inferMetaorder(children.map((t) => ({ ...t, wallet: 'a' })).reverse()), null);
  assert.throws(() => MetaorderIntelligenceEngine.inferMetaorder(children.map((t) => ({ ...t, solAmount: -1 }))), RangeError);
});

test('sell inventory ratios preserve fractional holder shares', () => {
  const holders = [
    { wallet: 'dev', balanceTokens: 1n, costBasisUsd: 1, isDevOrCabal: true, acquisitionTimeMs: 0 },
    { wallet: 'other', balanceTokens: 999n, costBasisUsd: 1, isDevOrCabal: false, acquisitionTimeMs: 0 },
  ];
  const profile = SellHazardEngine.evaluateSellHazard('mint', 1, holders, 'dev');
  assert.equal(profile.devDumpHazard, 0.003);
  assert.equal(profile.breakEvenOverhangPct, 1);
});
