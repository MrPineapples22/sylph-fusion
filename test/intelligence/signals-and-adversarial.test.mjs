import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DecomposedHsiEngine } from '../../dist/intelligence/signals/hsi.js';
import { PumpScoreEngine, PoDEngine } from '../../dist/intelligence/signals/pumpscore.js';
import { HierarchicalRegimeEngine } from '../../dist/intelligence/signals/regime.js';
import { WalletIntelligenceEngine } from '../../dist/intelligence/adversarial/wallet-intelligence.js';
import { CleanRoomStateEngine } from '../../dist/intelligence/adversarial/clean-room.js';

test('DecomposedHsiEngine: decomposes HSI into 7 evidence families and flags creator dump', () => {
  const engine = new DecomposedHsiEngine();

  // 1. Organic healthy token
  const organic = engine.evaluate({
    buyerCount: 40,
    uniqueFundingClusters: 35,
    realQuoteReservesLamports: 5_000_000_000n, // 5 SOL
    virtualTokenReserves: 500_000_000_000n,
    buyCount: 60,
    sellCount: 15,
    buyVolumeSol: 25,
    sellVolumeSol: 5,
    tokenAgeSeconds: 120,
    creatorNetDeltaPct: 0,
    averageTradeSizeSol: 0.4,
    tradeSizeVariance: 0.25,
  });

  assert.ok(organic.compositeHsi <= 35, `Organic HSI should be low (got ${organic.compositeHsi})`);
  assert.equal(organic.effectiveIndependentParticipants >= 30, true);

  // 2. Creator dump shock
  const creatorDump = engine.evaluate({
    buyerCount: 40,
    uniqueFundingClusters: 35,
    realQuoteReservesLamports: 5_000_000_000n,
    virtualTokenReserves: 500_000_000_000n,
    buyCount: 60,
    sellCount: 30,
    buyVolumeSol: 20,
    sellVolumeSol: 25,
    tokenAgeSeconds: 120,
    creatorNetDeltaPct: -15, // Creator dumped 15% supply!
    averageTradeSizeSol: 0.4,
    tradeSizeVariance: 0.25,
  });

  assert.ok(creatorDump.compositeHsi >= 50);
  assert.equal(creatorDump.families.sellPressure >= 90, true);
  assert.match(creatorDump.suspicionReason, /sell pressure/);
});

test('PumpScore & PoDEngine: measures curve momentum and sniper dump risk', () => {
  const pumpEngine = new PumpScoreEngine();
  const podEngine = new PoDEngine();

  const score = pumpEngine.calculatePumpScore({
    curveCompletionPct: 65,
    netBuyVolumeSol: 8.5,
    buyerAcceleration: 3.2,
    solReserveLamports: 20_000_000_000n,
  });

  assert.ok(score >= 70, `PumpScore should be high for accelerating curve (got ${score})`);

  // PoD: Snipers with 500% gain + 45% top-10 concentration
  const dumpRisk = podEngine.calculateDumpRisk({
    top10HoldersPct: 45,
    earlySnipersUnrealizedGainPct: 500,
    creatorHoldingPct: 2.0,
    curveProgressPct: 60,
  });

  assert.equal(dumpRisk.imminentDumpWarning, true);
  assert.ok(dumpRisk.dumpRiskScore >= 75);
  assert.match(dumpRisk.primaryTrigger, /unrealized profit/);
});

test('HierarchicalRegimeEngine: evaluates major and sub-regimes with risk multipliers', () => {
  const regimeEngine = new HierarchicalRegimeEngine();

  // Network stress
  const stress = regimeEngine.evaluate({
    solReturn24hPct: 2.0,
    runnerRatePct: 5.0,
    launchFrequencyPerMin: 12,
    medianLiquiditySol: 2.5,
    rpcDropRatePct: 6.5, // > 5% drop rate
    manipulationPrevalencePct: 15,
  });
  assert.equal(stress.majorRegime, 'ABNORMAL');
  assert.equal(stress.subRegime, 'NETWORK_STRESS');
  assert.equal(stress.riskMultiplier, 0.2);

  // Risk-On Euphoric
  const riskOn = regimeEngine.evaluate({
    solReturn24hPct: 8.0,
    runnerRatePct: 16.0,
    launchFrequencyPerMin: 20,
    medianLiquiditySol: 4.0,
    rpcDropRatePct: 0.5,
    manipulationPrevalencePct: 10,
  });
  assert.equal(riskOn.majorRegime, 'RISK_ON');
  assert.equal(riskOn.subRegime, 'EUPHORIC');
  assert.equal(riskOn.riskMultiplier, 1.0);
});

test('WalletIntelligence & CleanRoomState: detects Sybil clusters and calculates deception gap', () => {
  const walletEngine = new WalletIntelligenceEngine();

  // Register master funder and 20 funded throwaway wallets
  const masterFunder = 'MasterFunderWallet111111111111111111111';
  const buyers = [];
  for (let i = 0; i < 20; i++) {
    const addr = `ThrowawayBuyer_${i}_111111111111111111111111`;
    buyers.push(addr);
    walletEngine.registerWallet({
      address: addr,
      fundingParent: masterFunder, // Shared ancestor!
      firstSeenSlot: 100,
      reputationScore: 10,
    });
  }

  const part = walletEngine.calculateEffectiveParticipants(buyers);
  assert.equal(part.rawBuyerCount, 20);
  assert.equal(part.effectiveIndependentCount, 1, '20 bundled wallets with 1 parent = 1 effective participant');
  assert.equal(part.clusterDispersalRatio, 0.05);

  // Clean-Room Decontamination
  const cleanRoom = new CleanRoomStateEngine();
  const deceptionReport = cleanRoom.evaluateDecontamination(
    {
      volumeSol: 100,
      buyerCount: 20,
      compositeHsi: 30,
      pumpScore: 80,
    },
    0.6 // 60% of volume/buyers from coordinated cluster
  );

  assert.equal(deceptionReport.isDeceptionSevere, true);
  assert.equal(deceptionReport.volumeDeceptionPct, 60.0);
  assert.equal(deceptionReport.decontaminated.cleanVolumeSol, 40.0);
  assert.equal(deceptionReport.decontaminated.cleanBuyerCount, 8);
  assert.ok(deceptionReport.decontaminated.cleanCompositeHsi > 30, 'Clean HSI should be higher when deception is removed');
});
