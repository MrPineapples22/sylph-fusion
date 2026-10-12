import test from 'node:test';
import assert from 'node:assert/strict';
import { DynamicExitEngine } from '../../dist/intelligence/spie/dynamic-exits.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { LiquidityDepthEngine } from '../../dist/intelligence/microstructure/depth-engine.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 28 - DynamicExitEngine: Moonshot Ratchet Ladder to 100x (+10,000% PnL)', () => {
  const engine = new DynamicExitEngine();

  // Test 1: Breakeven Protection at +8% peak pullback
  const bePos = {
    mint: 'BE_MINT_1111111111111111111111111111111111111',
    entryPriceUsd: 1.0,
    currentPriceUsd: 1.006, // Pulled back to <= 1.008
    highestPriceUsd: 1.09,  // Peak +9% >= +8%
    lowestPriceUsd: 0.99,
    unrealizedPnlPct: 0.006,
    realSolReserve: 50,
    priorBlockSolReserve: 50,
    consecutiveSellBlocks: 0,
    currentSellPressureRatio: 0.2,
    isDevSold: false,
    stagesCompleted: 0,
    holdingTimeSeconds: 45,
  };
  const beResult = engine.evaluateGodTierExits(bePos);
  assert.equal(beResult.action, 'BREAKEVEN_PROTECT');
  assert.ok(Math.abs(beResult.protectiveStopUsd - 1.005) < 1e-4);

  // Test 2: 2x Double (Exact Peak 2.0x -> 1.50x Floor)
  const dblPos = { ...bePos, currentPriceUsd: 1.45, highestPriceUsd: 2.0, unrealizedPnlPct: 0.45 };
  const dblResult = engine.evaluateGodTierExits(dblPos);
  assert.equal(dblResult.action, 'EXIT_100_PROFIT');
  assert.ok(Math.abs(dblResult.protectiveStopUsd - 1.50) < 1e-4);

  // Test 3: 10x Moonshot (Peak 11.5x -> 8.05x Trailing > 7.50x Floor)
  const tenXPos = { ...bePos, currentPriceUsd: 7.2, highestPriceUsd: 11.5, unrealizedPnlPct: 6.2 };
  const tenXResult = engine.evaluateGodTierExits(tenXPos);
  assert.equal(tenXResult.action, 'EXIT_100_PROFIT');
  assert.ok(tenXResult.protectiveStopUsd >= 7.50);
  assert.ok(Math.abs(tenXResult.protectiveStopUsd - 8.05) < 1e-2);

  // Test 4: 20x Moonshot (Peak 21.0x -> 15.0x Floor)
  const twentyXPos = { ...bePos, currentPriceUsd: 14.5, highestPriceUsd: 21.0, unrealizedPnlPct: 13.5 };
  const twentyXResult = engine.evaluateGodTierExits(twentyXPos);
  assert.equal(twentyXResult.action, 'EXIT_100_PROFIT');
  assert.ok(Math.abs(twentyXResult.protectiveStopUsd - 15.0) < 1e-4);

  // Test 5: 50x Moonshot (Peak 51.0x -> 35.70x Trailing >= 35.0x Floor)
  const fiftyXPos = { ...bePos, currentPriceUsd: 34.0, highestPriceUsd: 51.0, unrealizedPnlPct: 33.0 };
  const fiftyXResult = engine.evaluateGodTierExits(fiftyXPos);
  assert.equal(fiftyXResult.action, 'EXIT_100_PROFIT');
  assert.ok(fiftyXResult.protectiveStopUsd >= 35.0);
  assert.ok(Math.abs(fiftyXResult.protectiveStopUsd - 35.70) < 1e-2);

  // Test 6: 100x Moonshot (+10,000% PnL) (Peak 101.0x -> 70.70x Trailing >= 70.0x Floor)
  const hundredXPos = { ...bePos, currentPriceUsd: 68.0, highestPriceUsd: 101.0, unrealizedPnlPct: 67.0 };
  const hundredXResult = engine.evaluateGodTierExits(hundredXPos);
  assert.equal(hundredXResult.action, 'EXIT_100_PROFIT');
  assert.ok(hundredXResult.protectiveStopUsd >= 70.0);
  assert.ok(Math.abs(hundredXResult.protectiveStopUsd - 70.70) < 1e-2);
});

test('Pass 28 - LiquidityDepthEngine: Non-linear price impact tranches', () => {
  const depthEngine = new LiquidityDepthEngine();
  const profile = depthEngine.calculateDepth(30.0);

  assert.equal(profile.poolSolReserves, 30.0);
  assert.ok(profile.tranches.length >= 6);

  // Check 0.5 SOL tranche impact
  const tranche05 = profile.tranches.find(t => t.sizeSol === 0.5);
  assert.ok(tranche05);
  assert.ok(tranche05.priceImpactBps > 0 && tranche05.priceImpactBps < 200);

  // Max safe position before 250 bps impact
  assert.ok(profile.maxSafePositionSol >= 0.5);
});

test('Pass 28 - MasterIntelligenceEngine: LiquidityDepth & Moonshot Ratchet integration', async () => {
  const orchestrator = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(orchestrator);

  // Verify depthEngine is mounted on orchestrator
  assert.ok(orchestrator.depthEngine instanceof LiquidityDepthEngine);

  // Verify evaluateDynamicExit Moonshot Ratchets
  const exit100x = orchestrator.evaluateDynamicExit({
    mint: 'Moonshot100x11111111111111111111111111111111111',
    entryPriceUsd: 0.001,
    currentPriceUsd: 0.068, // Pulled back below 70x floor
    highestPriceUsd: 0.101, // 101x peak (+10,000% PnL)
  });

  assert.equal(exit100x.godTier.action, 'EXIT_100_PROFIT');
  assert.ok(exit100x.godTier.reason.includes('DYNAMIC_STAGED_TRAIL'));
  assert.ok(exit100x.godTier.protectiveStopUsd >= 0.070);
  assert.ok(Math.abs(exit100x.godTier.protectiveStopUsd - 0.0707) < 1e-4);

  // Process a real pipeline event with context
  const eventTime = 2_000_000;
  const canonicalEvent = {
    eventId: 'evt_pass28_moonshot',
    eventType: 'TOKEN_CREATE',
    mint: 'MoonshotPump1111111111111111111111111111111111',
    signature: 'sig_pass28_moon',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 20010,
    slot: 400_000,
    parentSlot: 399_999,
    blockhash: 'BhashPass28',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 20.0,
      priceSol: 0.00004,
      symbol: 'MOON100',
    },
    sourceConfidence: 0.99,
    freshnessMs: 10,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 45,
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 3.0 },
      { address: 'w2', solFundedAmount: 4.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 2.5 },
      { address: 'w3', solFundedAmount: 6.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 4.0 },
      { address: 'w4', solFundedAmount: 3.5, parentFundingAddress: 'okx_hot', buyVolumeSol: 2.0 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 200,
    liquiditySol: 65,
    txCount: 75,
  };

  const result = await orchestrator.processEvent(canonicalEvent, context);

  assert.ok(result.spieEvaluation);
  assert.ok(result.convexKelly);
  assert.ok(result.spieEvaluation.factors.liquidityDepth > 0);
  assert.ok(Number.isFinite(result.convexKelly.recommendedAllocationSol));
});
