import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  OrderedObservationStagingEngine,
} from '../../dist/platform/ingestion/ordered-observation-buffer.js';
import {
  SimulationRiskEnvelopeEngine,
} from '../../dist/platform/execution/simulation-risk-envelope.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

describe('Pass 65: Ordered Observation Staging, Geyser Watermark Tracker & Simulation-First Risk Envelope (REQ-083 / REQ-084)', () => {
  test('Pass 65 Test 1: OrderedObservationStagingEngine Slot & Tx-Index Deterministic Ordering & Drain Prefix (Solana Streamer & Richat)', () => {
    const engine = new OrderedObservationStagingEngine({ maxBufferSize: 100 });
    const now = Date.now();

    const hashFor = (str) => createHash('sha256').update(str).digest('hex');

    // Stage out-of-order slots and transaction indices
    engine.stageObservation({
      slot: 102,
      transactionIndex: 1,
      signature: 'sig_102_tx1',
      eventType: 'SWAP',
      receivedAtMs: now,
      observationDigest: hashFor('102_1'),
    });

    engine.stageObservation({
      slot: 100,
      transactionIndex: 2,
      signature: 'sig_100_tx2',
      eventType: 'SWAP',
      receivedAtMs: now,
      observationDigest: hashFor('100_2'),
    });

    engine.stageObservation({
      slot: 100,
      transactionIndex: 0,
      signature: 'sig_100_tx0',
      eventType: 'CREATE',
      receivedAtMs: now,
      observationDigest: hashFor('100_0'),
    });

    engine.stageObservation({
      slot: 101,
      transactionIndex: 0,
      signature: 'sig_101_tx0',
      eventType: 'SWAP',
      receivedAtMs: now,
      observationDigest: hashFor('101_0'),
    });

    // Drain up to slot 101 (should return slot 100 tx 0, slot 100 tx 2, slot 101 tx 0)
    const drained = engine.drainOrderedObservations(101);
    assert.equal(drained.length, 3);
    assert.equal(drained[0].slot, 100);
    assert.equal(drained[0].transactionIndex, 0);
    assert.equal(drained[1].slot, 100);
    assert.equal(drained[1].transactionIndex, 2);
    assert.equal(drained[2].slot, 101);
    assert.equal(drained[2].transactionIndex, 0);

    // Remaining in buffer: slot 102 tx 1
    const remaining = engine.drainOrderedObservations(105);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].slot, 102);
    assert.equal(remaining[0].transactionIndex, 1);

    // After full drain, buffer is empty
    assert.equal(engine.drainOrderedObservations().length, 0);
  });

  test('Pass 65 Test 2: WatermarkGapReport Epistemic Invariants & Hole Detection Across Sparse Slots', () => {
    const engine = new OrderedObservationStagingEngine();
    const hashFor = (str) => createHash('sha256').update(str).digest('hex');

    // 1. Empty report
    const emptyReport = engine.getWatermarkReport();
    assert.equal(emptyReport.status, 'EMPTY');
    assert.equal(emptyReport.completeness, 'NOT_ESTABLISHED');
    assert.equal(emptyReport.pendingCount, 0);
    assert.equal(emptyReport.hasObservedSlotHoles, false);

    // 2. Stage contiguous observations (slots 500, 501, 502)
    engine.stageObservation({
      slot: 500,
      transactionIndex: 0,
      signature: 'sig_500',
      eventType: 'SWAP',
      receivedAtMs: 1000,
      observationDigest: hashFor('500'),
    });
    engine.stageObservation({
      slot: 501,
      transactionIndex: 0,
      signature: 'sig_501',
      eventType: 'SWAP',
      receivedAtMs: 1005,
      observationDigest: hashFor('501'),
    });
    engine.stageObservation({
      slot: 502,
      transactionIndex: 0,
      signature: 'sig_502',
      eventType: 'SWAP',
      receivedAtMs: 1010,
      observationDigest: hashFor('502'),
    });

    const orderedReport = engine.getWatermarkReport();
    assert.equal(orderedReport.status, 'OBSERVATIONS_ORDERED');
    assert.equal(orderedReport.hasObservedSlotHoles, false);
    assert.equal(orderedReport.observedSlotHoleCount, 0);
    assert.equal(orderedReport.pendingCount, 3);
    assert.match(orderedReport.watermarkDigest, /^[a-f0-9]{64}$/);

    // 3. Stage sparse observation with gap (skip slots 503, 504 -> stage slot 505)
    engine.stageObservation({
      slot: 505,
      transactionIndex: 0,
      signature: 'sig_505',
      eventType: 'SWAP',
      receivedAtMs: 1020,
      observationDigest: hashFor('505'),
    });

    const gapReport = engine.getWatermarkReport();
    assert.equal(gapReport.status, 'SPARSE_SLOT_OBSERVATIONS');
    assert.equal(gapReport.hasObservedSlotHoles, true);
    assert.equal(gapReport.observedSlotHoleCount, 2); // missing slots 503, 504
  });

  test('Pass 65 Test 3: SimulationRiskEnvelopeEngine Exact Simulation Verification, Staleness & CU Utilization (MOBIUS Searcher)', () => {
    const riskEngine = new SimulationRiskEnvelopeEngine({
      maxAllowedSimulationAgeMs: 400,
      maxAllowedCuRatio: 0.85,
      maxAllowedSlippageBps: 200,
      maxTradeNotionalSol: 5.0,
      maxTipLamports: 500_000n,
    });

    const now = 10_000;

    // 1. Healthy simulation approved
    const healthyCert = riskEngine.evaluateSimulation(
      {
        simulationId: 'sim_valid_01',
        mint: 'TokenValid111111111111111111111111111111111111',
        slot: 448300000,
        simulatedAtMs: now - 50, // 50ms age (< 400ms)
        computeUnitsConsumed: 120_000,
        computeUnitsLimit: 200_000, // 60% (< 85%)
        isSimulationSuccess: true,
        expectedSolOut: 0.5,
        expectedTokenOut: 10_000,
        expectedSlippageBps: 120, // 120 bps (< 200 bps)
        tipLamports: 25_000n,
      },
      { nowMs: now, tradeNotionalSol: 0.5 }
    );

    assert.equal(healthyCert.isApproved, true);
    assert.equal(healthyCert.verdict, 'SIMULATION_APPROVED');
    assert.equal(healthyCert.rejectionReason, null);
    assert.equal(healthyCert.cuUtilizationPct, 60.0);
    assert.match(healthyCert.certificateId, /^srec_[a-f0-9]{16}$/);

    // 2. Stale simulation rejected
    const staleCert = riskEngine.evaluateSimulation(
      {
        simulationId: 'sim_stale_02',
        mint: 'TokenValid111111111111111111111111111111111111',
        slot: 448300000,
        simulatedAtMs: now - 500, // 500ms age (> 400ms)
        computeUnitsConsumed: 100_000,
        computeUnitsLimit: 200_000,
        isSimulationSuccess: true,
        expectedSolOut: 0.5,
        expectedTokenOut: 10_000,
        expectedSlippageBps: 100,
      },
      { nowMs: now, tradeNotionalSol: 0.5 }
    );
    assert.equal(staleCert.isApproved, false);
    assert.equal(staleCert.verdict, 'SIMULATION_STALE');
    assert.match(staleCert.rejectionReason, /exceeds max allowed/);

    // 3. Failed simulated execution rejected
    const failedCert = riskEngine.evaluateSimulation(
      {
        simulationId: 'sim_fail_03',
        mint: 'TokenValid111111111111111111111111111111111111',
        slot: 448300000,
        simulatedAtMs: now - 20,
        computeUnitsConsumed: 50_000,
        computeUnitsLimit: 200_000,
        isSimulationSuccess: false,
        errorDetails: 'Custom(6001)', // Slippage exceeded
        expectedSolOut: 0.0,
        expectedTokenOut: 0,
        expectedSlippageBps: 500,
      },
      { nowMs: now, tradeNotionalSol: 0.5 }
    );
    assert.equal(failedCert.isApproved, false);
    assert.equal(failedCert.verdict, 'SIMULATION_FAILED');
    assert.match(failedCert.rejectionReason, /Custom\(6001\)/);

    // 4. Excessive compute units rejected
    const cuCert = riskEngine.evaluateSimulation(
      {
        simulationId: 'sim_cu_04',
        mint: 'TokenValid111111111111111111111111111111111111',
        slot: 448300000,
        simulatedAtMs: now - 30,
        computeUnitsConsumed: 185_000,
        computeUnitsLimit: 200_000, // 92.5% (> 85%)
        isSimulationSuccess: true,
        expectedSolOut: 0.5,
        expectedTokenOut: 10_000,
        expectedSlippageBps: 100,
      },
      { nowMs: now, tradeNotionalSol: 0.5 }
    );
    assert.equal(cuCert.isApproved, false);
    assert.equal(cuCert.verdict, 'CU_BUDGET_EXCEEDED');

    // 5. Excessive slippage rejected
    const slippageCert = riskEngine.evaluateSimulation(
      {
        simulationId: 'sim_slip_05',
        mint: 'TokenValid111111111111111111111111111111111111',
        slot: 448300000,
        simulatedAtMs: now - 30,
        computeUnitsConsumed: 100_000,
        computeUnitsLimit: 200_000,
        isSimulationSuccess: true,
        expectedSolOut: 0.5,
        expectedTokenOut: 10_000,
        expectedSlippageBps: 350, // 350 bps (> 200 bps)
      },
      { nowMs: now, tradeNotionalSol: 0.5 }
    );
    assert.equal(slippageCert.isApproved, false);
    assert.equal(slippageCert.verdict, 'SLIPPAGE_EXCEEDED');
  });

  test('Pass 65 Test 4: Cryptographic Simulation Certificate Invariants & Fail-Closed Canary Fences', () => {
    const riskEngine = new SimulationRiskEnvelopeEngine();

    // Malformed simulation evidence fails closed
    const malformedCert = riskEngine.evaluateSimulation(null);
    assert.equal(malformedCert.isApproved, false);
    assert.equal(malformedCert.verdict, 'MALFORMED_EVIDENCE');
    assert.equal(malformedCert.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');

    // Missing required fields
    const missingFieldsCert = riskEngine.evaluateSimulation({
      simulationId: '',
      mint: 'Test',
      slot: -5,
      simulatedAtMs: -1,
      computeUnitsConsumed: -1,
      computeUnitsLimit: 0,
      isSimulationSuccess: true,
      expectedSolOut: 0,
      expectedTokenOut: 0,
      expectedSlippageBps: 0,
    });
    assert.equal(missingFieldsCert.isApproved, false);
    assert.equal(missingFieldsCert.verdict, 'MALFORMED_EVIDENCE');
  });

  test('Pass 65 Test 5: Master Intelligence Engine Fail-Closed Gating, ViewModel Telemetry & Public Helpers (REQ-083 / REQ-084)', async () => {
    const master = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(master);

    const mint = 'SoLWatermarkRiskMaster1111111111111111111111';
    const receivedAtMs = Date.now();
    const sourceAtMs = receivedAtMs - 40;

    const baseEvent = {
      eventId: 'evt_pass65_gate_01',
      eventType: 'TOKEN_CREATE',
      mint,
      slot: 448300500,
      timestampNs: BigInt(sourceAtMs) * 1_000_000n,
      sourceTimestampMs: sourceAtMs,
      receivedTimestampMs: receivedAtMs,
      sequenceId: 1,
      chainState: 'CONFIRMED',
      sourceConfidence: 0.99,
      freshnessMs: 10,
      provenance: ['PUMP_PORTAL_WS'],
      payload: {
        mint,
        amountSol: 30.0,
        priceSol: 0.00004,
        symbol: 'WTR65',
        creator: 'CreatorWalletAlpha1111111111111111111111111',
        initialLiquiditySol: 30.0,
      },
    };

    const baseWallets = [
      { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
      { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      { address: 'w3', solFundedAmount: 4.5, parentFundingAddress: 'kraken_hot', buyVolumeSol: 3.5 },
      { address: 'w4', solFundedAmount: 7.0, parentFundingAddress: 'okx_hot', buyVolumeSol: 6.0 },
    ];

    const baseContext = {
      tokenAgeSec: 40,
      marketCapSol: 120,
      liquiditySol: 35,
      targetTradeSizeSol: 0.5,
      txCount: 12,
      rawWallets: baseWallets,
      isMintRenounced: true,
      programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      hasFreezeAuthority: false,
      hasMintAuthority: false,
      poolOpsPerSec: 12,
    };

    // Subtest 5A: Decision Kernel gating on Watermark Gap
    const gapBlockedResult = await master.processEvent(baseEvent, {
      ...baseContext,
      enforceOrderedWatermarkGating: true,
      observationWatermarkReport: {
        highWatermarkSlot: 448300505,
        lastDrainedSlot: 448300499,
        lowestPendingSlot: 448300500,
        pendingCount: 2,
        hasObservedSlotHoles: true,
        observedSlotHoleCount: 3,
        hasLateObservations: false,
        capacityOverflowed: false,
        completeness: 'NOT_ESTABLISHED',
        watermarkDigest: '00'.repeat(32),
        status: 'SPARSE_SLOT_OBSERVATIONS',
      },
    });
    assert.equal(gapBlockedResult.decision, 'CHALLENGED_ABSTAIN');
    assert.match(gapBlockedResult.whyExecutionBlocked || '', /INGESTION ORDERING EVIDENCE INCOMPLETE/);

    // Subtest 5B: Decision Kernel gating on Simulation Risk Failure
    const simBlockedResult = await master.processEvent(baseEvent, {
      ...baseContext,
      enforceSimulationRiskGating: true,
      simulationEvidence: {
        simulationId: 'sim_fail_master',
        mint,
        slot: 448300500,
        simulatedAtMs: receivedAtMs - 800, // 800ms old -> STALE
        computeUnitsConsumed: 100_000,
        computeUnitsLimit: 200_000,
        isSimulationSuccess: true,
        expectedSolOut: 0.5,
        expectedTokenOut: 10_000,
        expectedSlippageBps: 100,
      },
    });
    assert.equal(simBlockedResult.decision, 'CHALLENGED_ABSTAIN');
    assert.match(simBlockedResult.whyExecutionBlocked || '', /SIMULATION RISK FENCE BREACH/);

    // Subtest 5C: ViewModel telemetry verification
    assert.ok(gapBlockedResult.viewModel.observationWatermarkReport);
    assert.ok(gapBlockedResult.viewModel.simulationRiskCertificate);
    assert.ok(gapBlockedResult.observationWatermarkReport);
    assert.ok(gapBlockedResult.simulationRiskCertificate);

    // Subtest 5D: Public helper methods
    assert.ok(master.getOrderedObservationBuffer() instanceof OrderedObservationStagingEngine);
    assert.ok(master.getSimulationRiskEnvelope() instanceof SimulationRiskEnvelopeEngine);

    const stagedReport = master.stageObservation({
      slot: 448300500,
      transactionIndex: 0,
      signature: 'test_helper_sig',
      eventType: 'SWAP',
      receivedAtMs: receivedAtMs,
      observationDigest: '00'.repeat(32),
    });
    assert.ok(stagedReport.highWatermarkSlot >= 448300500);

    const evalCert = master.evaluateSimulationRisk({
      simulationId: 'helper_sim_01',
      mint,
      slot: 448300500,
      simulatedAtMs: receivedAtMs,
      computeUnitsConsumed: 80_000,
      computeUnitsLimit: 200_000,
      isSimulationSuccess: true,
      expectedSolOut: 0.5,
      expectedTokenOut: 10_000,
      expectedSlippageBps: 80,
    }, { nowMs: receivedAtMs, tradeNotionalSol: 0.5 });
    assert.equal(evalCert.isApproved, true);
    assert.equal(evalCert.verdict, 'SIMULATION_APPROVED');
  });
});
