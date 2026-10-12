import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LiquidityDepthEngine,
} from '../../dist/intelligence/microstructure/depth-engine.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

describe('Pass 62: Microstructure Liquidity Depth Engine & AMM Route Calibration (REQ-078)', () => {
  test('Pass 62 Test 1: LiquidityDepthEngine Non-Linear Tranches, Monotonicity & Marginal Impact Invariants (Major Update #4 & Blueprint §16)', () => {
    const engine = new LiquidityDepthEngine();
    const poolSol = 30.0;
    const tranches = [0.25, 0.5, 1.0, 2.5, 5.0, 10.0];

    const profile = engine.calculateDepth(poolSol, 1_000_000_000_000n, tranches);

    assert.equal(profile.poolSolReserves, 30.0);
    assert.equal(profile.tranches.length, 6);
    assert.equal(profile.isDepthCollapsed, false);
    assert.ok(profile.depthResilienceScore > 0.70, `Expected resilience score > 0.70, got ${profile.depthResilienceScore}`);
    assert.equal(profile.calibratedRoute, 'DIRECT_BONDING_CURVE');
    assert.match(profile.profileHash, /^[a-f0-9]{64}$/);

    // Monotonicity invariant: priceImpactBps strictly increases with tranche size
    for (let i = 0; i < profile.tranches.length - 1; i++) {
      const current = profile.tranches[i];
      const next = profile.tranches[i + 1];
      assert.ok(
        current.priceImpactBps < next.priceImpactBps,
        `Monotonicity violation: size ${current.sizeSol} impact ${current.priceImpactBps} >= size ${next.sizeSol} impact ${next.priceImpactBps}`
      );
      assert.ok(current.sizeSol < next.sizeSol);
    }

    // Exact non-linear formula verification for 10.0 SOL:
    // impactRatio = 10 / (30 + 10) = 0.25 -> 2500 bps
    const t10 = profile.tranches.find((t) => t.sizeSol === 10.0);
    assert.ok(t10);
    assert.equal(t10.priceImpactBps, 2500);
    assert.equal(t10.isSafeTranche, false); // 2500 > 250 bps
    assert.equal(t10.executableCapacityRemainingSol, 0); // 30 * 0.15 = 4.5 < 10.0

    // Smallest tranche (0.25 SOL):
    // impactRatio = 0.25 / 30.25 ~= 0.008264 -> 83 bps
    const t025 = profile.tranches.find((t) => t.sizeSol === 0.25);
    assert.ok(t025);
    assert.ok(t025.priceImpactBps <= 250);
    assert.equal(t025.isSafeTranche, true);
    assert.equal(t025.executableCapacityRemainingSol, 4.25); // 4.5 - 0.25

    // Max safe position must be non-zero and bounded by 250 bps threshold
    assert.ok(profile.maxSafePositionSol >= 0.5);
    assert.ok(profile.maxSafePositionSol <= 1.0);
  });

  test('Pass 62 Test 2: AMM Route Calibration, Reserve Volume Regimes & Dynamic Route Selection (Blueprint §28)', () => {
    const engine = new LiquidityDepthEngine();

    // Bonding curve regime (<= 85 SOL)
    assert.equal(engine.calibrateAmmRoute(50.0), 'DIRECT_BONDING_CURVE');
    assert.equal(engine.calibrateAmmRoute(85.0), 'DIRECT_BONDING_CURVE');

    // Raydium standard AMM (85.01 - 250 SOL)
    assert.equal(engine.calibrateAmmRoute(120.0), 'SPL_POOL_RAYDIUM');
    assert.equal(engine.calibrateAmmRoute(250.0), 'SPL_POOL_RAYDIUM');

    // Meteora DLMM concentrated liquidity (250.01 - 500 SOL)
    assert.equal(engine.calibrateAmmRoute(350.0), 'METEORA_DLMM');
    assert.equal(engine.calibrateAmmRoute(500.0), 'METEORA_DLMM');

    // Orca Whirlpool deep concentrated liquidity (> 500 SOL)
    assert.equal(engine.calibrateAmmRoute(750.0), 'WHIRLPOOL_ORCA');

    // Explicit override preserved
    assert.equal(engine.calibrateAmmRoute(30.0, 'METEORA_DLMM'), 'METEORA_DLMM');

    // Slippage estimation convenience method
    const slipBps = engine.estimateExecutionSlippageBps(1.0, 100.0);
    // 1 / (100 + 1) ~= 0.00990099 -> 99 bps
    assert.equal(slipBps, 99);

    // Tranche safety check
    const safetyCheckSafe = engine.evaluateTrancheSafety(1.0, 100.0, 250);
    assert.equal(safetyCheckSafe.isSafe, true);
    assert.equal(safetyCheckSafe.impactBps, 99);

    const safetyCheckUnsafe = engine.evaluateTrancheSafety(10.0, 20.0, 250);
    // 10 / (20 + 10) = 3333 bps > 250
    assert.equal(safetyCheckUnsafe.isSafe, false);
    assert.equal(safetyCheckUnsafe.impactBps, 3333);
  });

  test('Pass 62 Test 3: Liquidity Depth Collapse, Fail-Closed Edge Cases & Input Validation Invariants (Blueprint §16, §28)', () => {
    const engine = new LiquidityDepthEngine();

    // Edge case 1: Zero reserves pool
    const emptyProfile = engine.calculateDepth(0.0);
    assert.equal(emptyProfile.poolSolReserves, 0);
    assert.equal(emptyProfile.isDepthCollapsed, true);
    assert.equal(emptyProfile.depthResilienceScore, 0.0);
    assert.equal(emptyProfile.maxSafePositionSol, 0);
    assert.equal(emptyProfile.reserveDepletionRatio, 1.0);
    for (const tranche of emptyProfile.tranches) {
      assert.equal(tranche.priceImpactBps, 10_000);
      assert.equal(tranche.isSafeTranche, false);
      assert.equal(tranche.executableCapacityRemainingSol, 0);
    }

    // Edge case 2: Trace reserves (0.5 SOL) -> collapses
    const traceProfile = engine.calculateDepth(0.5);
    assert.equal(traceProfile.isDepthCollapsed, true);
    assert.ok(traceProfile.depthResilienceScore < 0.10);

    // Input validation: Negative reserves rejected
    assert.throws(() => {
      engine.calculateDepth(-5.0);
    }, /Invalid poolSolReserves/);

    // Input validation: NaN reserves rejected
    assert.throws(() => {
      engine.calculateDepth(NaN);
    }, /Invalid poolSolReserves/);

    // Input validation: Negative virtualTokenReserves rejected
    assert.throws(() => {
      engine.calculateDepth(30.0, -100n);
    }, /Invalid virtualTokenReserves/);
  });

  test('Pass 62 Test 4: MasterIntelligenceEngine Public Helper Methods for Liquidity Depth (Major Update #4 & Sections 16, 28)', () => {
    const engine = new MasterIntelligenceEngine();

    const depthEngine = engine.getLiquidityDepthEngine();
    assert.ok(depthEngine instanceof LiquidityDepthEngine);

    const evaluatedProfile = engine.evaluateLiquidityDepth(60.0);
    assert.equal(evaluatedProfile.poolSolReserves, 60.0);
    assert.equal(evaluatedProfile.isDepthCollapsed, false);
    assert.ok(evaluatedProfile.depthResilienceScore > 0.80);
    assert.equal(evaluatedProfile.calibratedRoute, 'DIRECT_BONDING_CURVE');
    assert.ok(evaluatedProfile.maxSafePositionSol >= 1.0);

    // High liquidity pool route calibration via helper
    const raydiumProfile = engine.evaluateLiquidityDepth(180.0);
    assert.equal(raydiumProfile.calibratedRoute, 'SPL_POOL_RAYDIUM');
  });

  test('Pass 62 Test 5: Master Orchestrator Decision Kernel Fail-Closed Gating on Liquidity Depth Collapse & ViewModel Telemetry', async () => {
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);

    const mint = 'MintDepthGating111111111111111111111111111';
    const eventTime = Date.now() - 500;

    const baseEvent = {
      eventId: 'evt_pass62_gating_01',
      eventType: 'TRADE',
      mint,
      signature: '5sig_pass62_gating',
      instructionIndex: 0,
      source: 'PUMP_PORTAL',
      sourceTimestampMs: eventTime,
      receivedTimestampMs: eventTime + 10,
      monotonicTimestamp: 60200,
      slot: 602_200,
      parentSlot: 602_199,
      blockhash: 'BhashPass62Gating',
      commitment: 'confirmed',
      transactionVersion: 'legacy',
      sequenceId: 1,
      chainState: 'CONFIRMED',
      payload: {
        amountSol: 25.0,
        priceSol: 0.00004,
        symbol: 'DEP62',
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
      tokenAgeSec: 40,
      marketCapSol: 120,
      liquiditySol: 35,
      txCount: 12,
      rawWallets: baseWallets,
      isMintRenounced: true,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 12,
    };

    // Sub-test A: Healthy Liquidity Depth passes gating
    const healthyResult = await engine.processEvent(baseEvent, {
      ...normalContext,
      enforceLiquidityDepthGating: true,
      targetTradeSizeSol: 0.5,
      poolSolReserves: 35.0,
    });

    assert.ok(healthyResult.liquidityDepthProfile);
    assert.equal(healthyResult.liquidityDepthProfile.isDepthCollapsed, false);
    assert.ok(healthyResult.viewModel.liquidityDepthResilienceScore > 0.75);
    assert.equal(healthyResult.viewModel.isLiquidityDepthCollapsed, false);
    assert.equal(healthyResult.viewModel.liquidityCalibratedRoute, 'DIRECT_BONDING_CURVE');
    assert.ok(healthyResult.viewModel.liquidityMaxSafePositionSol >= 0.5);

    // Sub-test B: Collapsed Liquidity Depth triggers fail-closed Decision Kernel blocking
    const collapsedProfile = engine.evaluateLiquidityDepth(0.5);
    assert.equal(collapsedProfile.isDepthCollapsed, true);

    const collapsedResult = await engine.processEvent({ ...baseEvent, eventId: 'evt_pass62_gating_02' }, {
      ...normalContext,
      enforceLiquidityDepthGating: true,
      targetTradeSizeSol: 0.5,
      liquidityDepthProfile: collapsedProfile,
    });

    assert.equal(collapsedResult.decision, 'CHALLENGED_ABSTAIN', collapsedResult.whyExecutionBlocked);
    assert.match(collapsedResult.whyExecutionBlocked, /BLOCKED — LIQUIDITY DEPTH COLLAPSE/);
    assert.equal(collapsedResult.liquidityDepthProfile.isDepthCollapsed, true);
    assert.equal(collapsedResult.viewModel.isLiquidityDepthCollapsed, true);

    // Sub-test C: Excessive Target Trade Size exceeding maxSafePositionSol triggers gating
    const excessiveSizeResult = await engine.processEvent({ ...baseEvent, eventId: 'evt_pass62_gating_03' }, {
      ...normalContext,
      enforceLiquidityDepthGating: true,
      targetTradeSizeSol: 15.0, // Exceeds safe size on 35 SOL pool
      poolSolReserves: 35.0,
    });

    assert.equal(excessiveSizeResult.decision, 'CHALLENGED_ABSTAIN');
    assert.match(excessiveSizeResult.whyExecutionBlocked, /BLOCKED — LIQUIDITY DEPTH COLLAPSE/);
  });
});
