/**
 * SYLPH FUSION — PASS 53 VERIFICATION SUITE
 * Evacuation-X: Convex Flow Model & Portfolio Evacuation Certificate
 * Specifications: Master Blueprint Sections XXVI & XXVII
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvacuationFlowModel } from '../../dist/intelligence/survival/evacuation-x/evacuation-flow-model.js';
import { certifyPortfolioEvacuation } from '../../dist/intelligence/survival/evacuation-x/portfolio-evacuation-certificate.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 53: Evacuation-X Convex Flow Model Multi-Commodity Simulation & Unclipped Risk (Sections XXVI & XXVII)', async () => {
  const model = new EvacuationFlowModel();

  const positions = [
    {
      mint: 'MintTokenAlpha1111111111111111111111111111111',
      poolAddress: 'PoolSharedRaydium111111111111111111111111111',
      balanceRaw: 2_000_000_000_000n, // 2,000,000 tokens (decimals 6)
      markPriceUsd: 0.004, // $8,000 value
      availableLiquidityUsd: 15_000,
      expectedDailyVolumeUsd: 40_000,
    },
    {
      mint: 'MintTokenBeta22222222222222222222222222222222',
      poolAddress: 'PoolUniqueOrca22222222222222222222222222222',
      balanceRaw: 500_000_000_000n, // 500,000 tokens
      markPriceUsd: 0.002, // $1,000 value
      availableLiquidityUsd: 5_000,
      expectedDailyVolumeUsd: 10_000,
    },
  ];

  const analysis = model.analyzePortfolio(positions, 300);

  // 1. Basic portfolio value accounting
  assert.equal(analysis.totalPositionValueUsd, 9000);
  assert.ok(analysis.recoverableCapitalByDeadlineUsd > 0);
  assert.ok(analysis.recoverableCapitalByDeadlineUsd <= analysis.totalPositionValueUsd);

  // 2. Shared bottleneck detection (> $5000 queued in single pool)
  assert.equal(analysis.sharedBottlenecks.length, 1);
  assert.ok(analysis.sharedBottlenecks[0].includes('Shared pool bottleneck on PoolShar'));
  assert.ok(analysis.sharedBottlenecks[0].includes('$8000 queued'));

  // 3. Clearance curve simulation (5 steps)
  assert.equal(analysis.clearanceCurve.length, 5);
  for (let i = 0; i < 5; i++) {
    const step = analysis.clearanceCurve[i];
    assert.equal(step.stepIndex, i + 1);
    assert.equal(step.elapsedSec, (300 / 5) * (i + 1));
    assert.equal(step.cumulativeExitedFraction, (i + 1) / 5);
    assert.equal(step.trancheSizeUsd, 9000 / 5);
    assert.ok(step.totalSlippageBps >= step.instantaneousImpactBps);
  }

  // 4. UNCLIPPED RISK INVARIANT (Section XXVII: never clamp measured risk to allowed risk)
  // With $1800 tranche in $20,000 pool -> participation rate = 0.09 -> slippage ~ 162 bps
  assert.ok(analysis.p95CostBps > 0);
  assert.ok(analysis.p99CostBps >= analysis.p95CostBps);
  assert.equal(analysis.survivalDeficitUsd, Number((9000 - analysis.recoverableCapitalByDeadlineUsd).toFixed(2)));
});

test('Pass 53: Portfolio Evacuation Certificate Issuance & Clearance Feasibility (Section XXVI)', async () => {
  const model = new EvacuationFlowModel();
  const slot = 590_000n;

  // Case 1: Feasible portfolio clearance
  const lowRiskPositions = [
    {
      mint: 'MintLowRisk111111111111111111111111111111111',
      poolAddress: 'PoolLowRisk111111111111111111111111111111111',
      balanceRaw: 100_000_000_000n, // 100,000 tokens
      markPriceUsd: 0.001, // $100 value
      availableLiquidityUsd: 20_000,
      expectedDailyVolumeUsd: 50_000,
    },
  ];
  const feasibleAnalysis = model.analyzePortfolio(lowRiskPositions, 300);
  const feasibleCert = certifyPortfolioEvacuation(slot, feasibleAnalysis, 1000);

  assert.equal(feasibleCert.clearanceFeasible, true);
  assert.equal(feasibleCert.slot, slot);
  assert.equal(feasibleCert.certificateHash.length, 64);
  assert.ok(feasibleCert.certificateId.startsWith('pec_'));
  assert.ok(feasibleCert.p95CostBps <= 1000);
  assert.ok(feasibleCert.issuedAtMs > 0);

  // Case 2: Infeasible clearance due to high slippage exceeding max allowable cost
  const highRiskPositions = [
    {
      mint: 'MintIlliquid11111111111111111111111111111111',
      poolAddress: 'PoolIlliquid11111111111111111111111111111111',
      balanceRaw: 10_000_000_000_000n, // 10,000,000 tokens
      markPriceUsd: 0.005, // $50,000 value
      availableLiquidityUsd: 2_000, // Tiny liquidity
      expectedDailyVolumeUsd: 5_000,
    },
  ];
  const highRiskAnalysis = model.analyzePortfolio(highRiskPositions, 300);
  const infeasibleCert = certifyPortfolioEvacuation(slot, highRiskAnalysis, 1000); // 1000 bps ceiling

  assert.equal(infeasibleCert.clearanceFeasible, false);
  assert.ok(infeasibleCert.p95CostBps > 1000);
  assert.ok(infeasibleCert.survivalDeficitUsd > 0);
});

test('Pass 53: Master Intelligence Engine Public Helper Method (Sections XXVI & XXVII)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const slot = 590_050n;
  const positions = [
    {
      mint: 'MintHelper1111111111111111111111111111111111',
      poolAddress: 'PoolHelper1111111111111111111111111111111111',
      balanceRaw: 200_000_000_000n,
      markPriceUsd: 0.002, // $400 value
      availableLiquidityUsd: 10_000,
      expectedDailyVolumeUsd: 25_000,
    },
  ];

  const result = engine.evaluatePortfolioEvacuation(positions, slot, 250, 1200);

  assert.ok(result.analysis);
  assert.equal(result.analysis.totalPositionValueUsd, 400);
  assert.ok(result.certificate);
  assert.equal(result.certificate.slot, slot);
  assert.equal(result.certificate.clearanceFeasible, true);
  assert.ok(result.certificate.certificateId.startsWith('pec_'));
});

test('Pass 53: Decision Kernel Fail-Closed Gating Under Infeasible Evacuation Clearance', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_800_000;
  const baseEvent = {
    eventId: 'evt_pass_53_gate_test',
    mint: 'MintPass53Gate1111111111111111111111111111',
    signature: '5sig_pass53_gate',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 48010,
    slot: 590_100,
    parentSlot: 590_100 - 1,
    blockhash: 'BhashPass53Gate',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 30.0,
      priceSol: 0.00005,
      symbol: 'P53GATE',
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

  const baseContext = {
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

  // Case 1: Infeasible evacuation clearance fails closed
  const infeasibleResult = await engine.processEvent(baseEvent, {
    ...baseContext,
    enforceEvacuationClearanceGating: true,
    evacuationCertificate: {
      certificateId: 'pec_infeasible_test',
      slot: 590_100n,
      totalValueUsd: 15_000,
      recoverableCapitalByDeadlineUsd: 8_000,
      p50CostBps: 2200,
      p95CostBps: 3400,
      p99CostBps: 4500,
      survivalDeficitUsd: 7000.0,
      sharedBottlenecks: ['Shared pool bottleneck on PoolBlocked: $15000 queued'],
      clearanceFeasible: false,
      certificateHash: 'hash_pass53_infeasible',
      issuedAtMs: eventTime,
    },
  });

  assert.equal(infeasibleResult.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(infeasibleResult.whyExecutionBlocked.includes('EVACUATION CLEARANCE INFEASIBLE'));
  assert.ok(infeasibleResult.whyExecutionBlocked.includes('P95 Cost: 3400 bps'));
  assert.ok(infeasibleResult.whyExecutionBlocked.includes('Deficit: $7000.00'));
});

test('Pass 53: ViewModel and Telemetry Strip Projection Invariants', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const eventTime = 4_800_000;
  const event = {
    eventId: 'evt_pass_53_vm_test',
    mint: 'MintPass53VmTest111111111111111111111111111',
    signature: '5sig_pass53_vm',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 48020,
    slot: 590_110,
    parentSlot: 590_109,
    blockhash: 'BhashPass53Vm',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 2,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 15.0,
      priceSol: 0.00004,
      symbol: 'P53VM',
    },
    sourceConfidence: 0.98,
    freshnessMs: 12,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const context = {
    tokenAgeSec: 25,
    marketCapSol: 80,
    liquiditySol: 25,
    txCount: 6,
    rawWallets: [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
    ],
    isMintRenounced: true,
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    poolOpsPerSec: 5,
  };

  const result = await engine.processEvent(event, context);

  // MasterPipelineResult invariants
  assert.ok(result.evacuationAnalysis);
  assert.ok(result.evacuationCertificate);
  assert.ok(result.evacuationCertificate.certificateId.startsWith('pec_'));

  // AetherFluxViewModel invariants
  const vm = result.viewModel;
  assert.ok(vm);
  assert.ok(vm.evacuationAnalysis);
  assert.ok(vm.evacuationCertificate);
  assert.equal(typeof vm.isClearanceFeasible, 'boolean');
  assert.equal(typeof vm.evacuationP95CostBps, 'number');
  assert.equal(typeof vm.survivalDeficitUsd, 'number');
});
