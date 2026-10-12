import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExecutionAttemptLedger,
  CANONICAL_EXECUTION_OUTCOMES,
} from '../../dist/intelligence/execution-adaptation/index.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

describe('Pass 61: Execution Attempt Ledger & Action Vector Integration (REQ-077)', () => {
  const sampleActionVector = Object.freeze({
    transport: 'JITO_SINGLE_TX_BUNDLE',
    route: 'PUMP_FUN',
    txVersion: 'v0',
    targetSlot: 100_000n,
    region: 'GLOBAL',
    cuLimit: 300_000,
    priorityFeeMicroLamports: 15_000n,
    jitoTipLamports: 25_000n,
    slippageBps: 250,
    expirySlots: 150,
    retryPolicy: {
      maxRetries: 3,
      retryIntervalMs: 500,
    },
  });

  test('Pass 61 Test 1: ExecutionAttemptLedger Epistemic Invariants & Canonical Outcomes Accounting (Section XX)', () => {
    const ledger = new ExecutionAttemptLedger();

    // Verify all 7 canonical outcomes are defined
    assert.equal(CANONICAL_EXECUTION_OUTCOMES.length, 7);
    assert.deepEqual(new Set(CANONICAL_EXECUTION_OUTCOMES), new Set([
      'FINALIZED_SUCCESS',
      'FINALIZED_INSTRUCTION_FAILURE',
      'SLIPPAGE_REJECTED',
      'DELIVERY_FAILED',
      'BLOCKHASH_EXPIRED',
      'CERTIFIED_NO_LAND',
      'UNKNOWN',
    ]));

    // Record one attempt of each canonical outcome
    const outcomes = [
      { outcome: 'FINALIZED_SUCCESS', landed: 100_002n, slip: 15, cu: 180_000, fee: 30_000n },
      { outcome: 'FINALIZED_INSTRUCTION_FAILURE', landed: 100_003n, slip: 0, cu: 50_000, fee: 20_000n },
      { outcome: 'SLIPPAGE_REJECTED', landed: undefined, slip: undefined, cu: undefined, fee: 5_000n },
      { outcome: 'DELIVERY_FAILED', landed: undefined, slip: undefined, cu: undefined, fee: 0n },
      { outcome: 'BLOCKHASH_EXPIRED', landed: undefined, slip: undefined, cu: undefined, fee: 0n },
      { outcome: 'CERTIFIED_NO_LAND', landed: undefined, slip: undefined, cu: undefined, fee: 0n },
      { outcome: 'UNKNOWN', landed: undefined, slip: undefined, cu: undefined, fee: 0n },
    ];

    outcomes.forEach((item, idx) => {
      ledger.recordAttempt({
        attemptId: `att_${idx}`,
        intentId: `intent_alpha_${idx % 2}`,
        actionVector: sampleActionVector,
        outcome: item.outcome,
        submissionSlot: 100_000n,
        landedSlot: item.landed,
        realizedSlippageBps: item.slip,
        realizedCuConsumed: item.cu,
        realizedTotalFeeLamports: item.fee,
        recordedAtMs: Date.now() + idx,
      });
    });

    const stats = ledger.getStats();
    assert.equal(stats.totalAttempts, 7);
    assert.equal(stats.landedCount, 2);
    assert.equal(stats.successCount, 1);
    assert.equal(stats.instructionFailureCount, 1);
    assert.equal(stats.deliveryFailedCount, 1);
    assert.equal(stats.blockhashExpiredCount, 1);
    assert.equal(stats.certifiedNoLandCount, 1);

    // Epistemic invariant: Landing rate includes ALL attempts in the denominator
    const expectedLandingRate = (2 / 7) * 100;
    assert.ok(Math.abs(stats.landingRatePct - expectedLandingRate) < 0.001);

    const expectedSuccessRate = (1 / 7) * 100;
    assert.ok(Math.abs(stats.executionSuccessRatePct - expectedSuccessRate) < 0.001);

    // Slippage and CU averages
    assert.equal(stats.meanRealizedSlippageBps, 7.5); // (15 + 0) / 2
    assert.equal(stats.meanCuConsumed, 115_000); // (180_000 + 50_000) / 2

    // Temporal paradox invariant: landedSlot < submissionSlot rejected
    assert.throws(() => {
      ledger.recordAttempt({
        attemptId: 'att_paradox',
        intentId: 'intent_paradox',
        actionVector: sampleActionVector,
        outcome: 'FINALIZED_SUCCESS',
        submissionSlot: 100_005n,
        landedSlot: 100_002n, // PRECEDES submission
        recordedAtMs: Date.now(),
      });
    }, /TEMPORAL_PARADOX/);

    // Duplicate attemptId rejected
    assert.throws(() => {
      ledger.recordAttempt({
        attemptId: 'att_0', // ALREADY EXISTS
        intentId: 'intent_dup',
        actionVector: sampleActionVector,
        outcome: 'FINALIZED_SUCCESS',
        submissionSlot: 100_000n,
        recordedAtMs: Date.now(),
      });
    }, /DUPLICATE_ATTEMPT_ID/);
  });

  test('Pass 61 Test 2: ExecutionActionVector Structure & Protocol Invariants (Section XXI)', () => {
    assert.equal(sampleActionVector.transport, 'JITO_SINGLE_TX_BUNDLE');
    assert.equal(sampleActionVector.route, 'PUMP_FUN');
    assert.equal(sampleActionVector.txVersion, 'v0');
    assert.equal(sampleActionVector.targetSlot, 100_000n);
    assert.equal(sampleActionVector.region, 'GLOBAL');
    assert.equal(sampleActionVector.cuLimit, 300_000);
    assert.equal(sampleActionVector.priorityFeeMicroLamports, 15_000n);
    assert.equal(sampleActionVector.jitoTipLamports, 25_000n);
    assert.equal(sampleActionVector.slippageBps, 250);
    assert.equal(sampleActionVector.expirySlots, 150);
    assert.equal(sampleActionVector.retryPolicy.maxRetries, 3);
    assert.equal(sampleActionVector.retryPolicy.retryIntervalMs, 500);
  });

  test('Pass 61 Test 3: MasterIntelligenceEngine Public Helper Methods for Attempt Ledger (Sections XX, XXI)', () => {
    const engine = new MasterIntelligenceEngine();

    const ledger = engine.getExecutionAttemptLedger();
    assert.ok(ledger instanceof ExecutionAttemptLedger);

    const initialStats = engine.getExecutionAttemptStats();
    assert.equal(initialStats.totalAttempts, 0);

    // Record an execution attempt through engine helper
    engine.recordExecutionAttempt({
      attemptId: 'engine_att_1',
      intentId: 'intent_sol_1',
      actionVector: sampleActionVector,
      outcome: 'FINALIZED_SUCCESS',
      submissionSlot: 200_000n,
      landedSlot: 200_001n,
      realizedSlippageBps: 12,
      realizedCuConsumed: 195_000,
      realizedTotalFeeLamports: 35_000n,
      recordedAtMs: Date.now(),
    });

    const updatedStats = engine.getExecutionAttemptStats();
    assert.equal(updatedStats.totalAttempts, 1);
    assert.equal(updatedStats.successCount, 1);
    assert.equal(updatedStats.landingRatePct, 100);
    assert.equal(updatedStats.executionSuccessRatePct, 100);
    assert.equal(updatedStats.meanRealizedSlippageBps, 12);

    const byIntent = ledger.getAttemptsByIntent('intent_sol_1');
    assert.equal(byIntent.length, 1);
    assert.equal(byIntent[0].attemptId, 'engine_att_1');
  });

  test('Pass 61 Test 4: Master Orchestrator Decision Kernel Fail-Closed Gating on Delivery Failure Collapse', async () => {
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);

    const mint = 'MintAttemptGating111111111111111111111111111';
    const eventTime = Date.now() - 500;

    const baseEvent = {
      eventId: 'evt_pass61_gating_01',
      eventType: 'TRADE',
      mint,
      signature: '5sig_pass61_gating',
      instructionIndex: 0,
      source: 'PUMP_PORTAL',
      sourceTimestampMs: eventTime,
      receivedTimestampMs: eventTime + 10,
      monotonicTimestamp: 60100,
      slot: 601_200,
      parentSlot: 601_199,
      blockhash: 'BhashPass61Gating',
      commitment: 'confirmed',
      transactionVersion: 'legacy',
      sequenceId: 1,
      chainState: 'CONFIRMED',
      payload: {
        amountSol: 25.0,
        priceSol: 0.00004,
        symbol: 'ATT61',
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

    // Case A: Ledger with healthy delivery history (< 70% unlanded)
    const healthyContext = {
      ...normalContext,
      enforceAttemptLedgerGating: true,
      attemptStats: {
        totalAttempts: 5,
        landedCount: 4,
        successCount: 4,
        instructionFailureCount: 0,
        slippageRejectedCount: 0,
        deliveryFailedCount: 1,
        blockhashExpiredCount: 0,
        certifiedNoLandCount: 0,
        unknownCount: 0,
        landingRatePct: 80.0,
        executionSuccessRatePct: 80.0,
        meanRealizedSlippageBps: 10,
        meanCuConsumed: 200_000,
        meanTotalFeeLamports: 25_000n,
        outcomeDistribution: {
          FINALIZED_SUCCESS: 4,
          FINALIZED_INSTRUCTION_FAILURE: 0,
          SLIPPAGE_REJECTED: 0,
          DELIVERY_FAILED: 1,
          BLOCKHASH_EXPIRED: 0,
          CERTIFIED_NO_LAND: 0,
          UNKNOWN: 0,
        },
      },
    };

    const resultHealthy = await engine.processEvent(baseEvent, healthyContext);
    assert.notEqual(resultHealthy.whyExecutionBlocked?.includes('EXECUTION ATTEMPT DELIVERY COLLAPSE'), true);

    // Case B: Severe delivery failure collapse (unlanded ratio >= 70%)
    const collapsedContext = {
      ...normalContext,
      enforceAttemptLedgerGating: true,
      attemptStats: {
        totalAttempts: 5,
        landedCount: 1,
        successCount: 1,
        instructionFailureCount: 0,
        slippageRejectedCount: 0,
        deliveryFailedCount: 3,
        blockhashExpiredCount: 1,
        certifiedNoLandCount: 0,
        unknownCount: 0,
        landingRatePct: 20.0,
        executionSuccessRatePct: 20.0,
        meanRealizedSlippageBps: 10,
        meanCuConsumed: 200_000,
        meanTotalFeeLamports: 25_000n,
        outcomeDistribution: {
          FINALIZED_SUCCESS: 1,
          FINALIZED_INSTRUCTION_FAILURE: 0,
          SLIPPAGE_REJECTED: 0,
          DELIVERY_FAILED: 3,
          BLOCKHASH_EXPIRED: 1,
          CERTIFIED_NO_LAND: 0,
          UNKNOWN: 0,
        },
      },
    };

    const resultCollapsed = await engine.processEvent({ ...baseEvent, eventId: 'evt_pass61_gating_02' }, collapsedContext);
    assert.equal(resultCollapsed.decision, 'CHALLENGED_ABSTAIN');
    assert.ok(resultCollapsed.whyExecutionBlocked?.includes('EXECUTION ATTEMPT DELIVERY COLLAPSE'));
  });

  test('Pass 61 Test 5: Master Pipeline ViewModel Projection, Telemetry Strip & Lifecycle Invariants (Sections XX, XXI)', async () => {
    const engine = new MasterIntelligenceEngine();
    certifySyntheticRuntimeForTestOnly(engine);

    const baseEvent = {
      eventId: 'evt_attempt_vm_1',
      eventType: 'TRADE',
      mint: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      slot: 160_000,
      commitment: 'confirmed',
      sourceTimestampMs: Date.now() - 500,
      receivedTimestampMs: Date.now() - 50,
      signature: '5K2F7o5pZp3bFmJc1R4Z8G2uX1Q5yM9wP7sT3vL6kK8h',
      slotLeader: 'Leader1111111111111111111111111111111111111',
      payload: {
        amountSol: 15.0,
        priceSol: 0.00004,
        symbol: 'ATT61',
      },
    };

    const context = {
      marketCapSol: 80,
      liquiditySol: 40,
      txCount: 30,
      tokenAgeSec: 180,
      rawWallets: [
        { address: 'w1', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 4.0 },
        { address: 'w2', solFundedAmount: 6.0, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 5.0 },
      ],
    };

    const result = await engine.processEvent(baseEvent, context);

    // Verify MasterPipelineResult fields
    assert.ok(result.executionActionVector !== undefined);
    assert.equal(result.executionActionVector.route, 'PUMP_FUN');
    assert.equal(result.executionActionVector.txVersion, 'v0');
    assert.ok(result.executionAttemptStats !== undefined);

    // Verify AetherFluxViewModel fields
    const vm = result.viewModel;
    assert.ok(vm.executionLandingRatePct !== undefined);
    assert.ok(vm.executionSuccessRatePct !== undefined);
    assert.ok(vm.executionTotalAttempts !== undefined);
    assert.ok(vm.executionTransport !== undefined);
    assert.ok(vm.lastExecutionOutcome !== undefined);
    assert.equal(vm.lastExecutionOutcome, 'FINALIZED_SUCCESS');
  });
});
