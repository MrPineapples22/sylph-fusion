import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_WALLET_SALT,
  saltHashWallet,
  deterministicCandidateId,
  computeFeatureSealHash,
  buildCandidateSnapshot,
  buildOutcomeLabel,
  verifySnapshotIntegrity,
  executeModelGate,
  throwIfAborted,
} from '../dist/candidate-snapshot.js';
import { SessionLogger } from '../dist/session-logger.js';

test('1. Versioned decision-time feature records with wallet hashing', () => {
  const mint = 'TokenMint1111111111111111111111111111111111';
  const pool = 'BondingCurve1111111111111111111111111111111';
  const creator = 'CreatorWallet11111111111111111111111111111';
  const holderA = 'HolderA11111111111111111111111111111111111';
  const holderB = 'HolderB11111111111111111111111111111111111';

  const snapshot = buildCandidateSnapshot({
    mint,
    poolAddress: pool,
    slot: 284100200,
    eventSignature: 'sig-mock-event-001',
    observedAtMs: 1726000000000,
    decisionAtMs: 1726000000050,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1.0,
      exitLadderConfigHash: 'ladder-tp20-50-100-stop8',
    },
    evaluationDisposition: 'cleared',
    microstructure: {
      buyerCount5m: 14,
      buyTransactionCount: 22,
      sellTransactionCount: 3,
      buySellRatio: 7.33,
      buyerArrivalVelocityPerSec: 0.12,
      topHoldersHashed: [
        saltHashWallet(holderA, DEFAULT_WALLET_SALT),
        saltHashWallet(holderB, DEFAULT_WALLET_SALT),
      ],
      creatorWalletHashed: saltHashWallet(creator, DEFAULT_WALLET_SALT),
      creatorInitialSupplyPct: 5.0,
      creatorCurrentBalancePct: 5.0,
      creatorNetDeltaPct: 0.0,
    },
    curve: {
      tokenAgeSeconds: 45,
      realSolReservesLamports: '2500000000',
      virtualSolReservesLamports: '32500000000',
      virtualTokenReserves: '1073000000000000',
      curveCompletionPct: 8.2,
      reserveDriftPct: 0.05,
      spotPriceUsd: 0.000028,
    },
    transport: {
      quoteAgeMs: 12,
      leadingRpcLatencyMs: 24,
      trailingRpcDropRatePct: 0.0,
      inFlightOrderCount: 0,
      oldestPendingAgeMs: 0,
      reservedCashRatio: 0.2,
    },
  });

  assert.equal(snapshot.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(snapshot.evaluationDisposition, 'cleared');
  assert.equal(snapshot.featureAvailability, 1.0);
  assert.equal(snapshot.missingFeatureCount, 0);

  // Raw wallet addresses must NOT appear in hashed fields
  assert.notEqual(snapshot.microstructure.creatorWalletHashed, creator);
  assert.ok(snapshot.microstructure.creatorWalletHashed.length === 64);
  assert.ok(snapshot.featureSealHash.length === 64);

  // Integrity verification passes
  const integrity = verifySnapshotIntegrity(snapshot);
  assert.equal(integrity.valid, true);
  assert.equal(integrity.recomputedSealHash, snapshot.featureSealHash);
});

test('2. Immutable timestamps, ordering constraints, and seal hash tamper detection', () => {
  const baseParams = {
    mint: 'TokenMint2222222222222222222222222222222222',
    poolAddress: 'PoolAddress222222222222222222222222222222',
    slot: 284100250,
    eventSignature: 'sig-mock-event-002',
    observedAtMs: 1726000001000,
    decisionAtMs: 1726000001020,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1.0,
      exitLadderConfigHash: 'ladder-tp20-50-100-stop8',
    },
    evaluationDisposition: 'cleared',
  };

  // Valid snapshot
  const snapshot = buildCandidateSnapshot(baseParams);
  assert.ok(snapshot.decisionAtMs >= snapshot.observedAtMs);

  // Clock inversion rejection: observedAtMs > decisionAtMs
  assert.throws(() => {
    buildCandidateSnapshot({
      ...baseParams,
      observedAtMs: 1726000002000,
      decisionAtMs: 1726000001000, // Inverted!
    });
  }, /Clock consistency violation/);

  // Slot non-positive rejection
  assert.throws(() => {
    buildCandidateSnapshot({
      ...baseParams,
      slot: 0,
    });
  }, /Invalid slot number/);

  // Tamper detection: modifying features after computation invalidates featureSealHash
  const tampered = JSON.parse(JSON.stringify(snapshot));
  tampered.microstructure.buyTransactionCount = 99999;
  const tamperCheck = verifySnapshotIntegrity(tampered);
  assert.equal(tamperCheck.valid, false);
  assert.ok(tamperCheck.reason.includes('Feature seal hash mismatch'));
});

test('3. Explicit outcome states, right-censoring, and excursion metrics', () => {
  const candidateId = deterministicCandidateId(
    'TokenMint3333333333333333333333333333333333',
    284100300,
    'sig-mock-event-003'
  );

  // Case A: Fully resolved profitable exit
  const resolvedOutcome = buildOutcomeLabel({
    candidateId,
    mint: 'TokenMint3333333333333333333333333333333333',
    entrySnapshotSlot: 284100300,
    censored: false,
    terminalState: 'take_profit',
    observationDurationMs: 45_000,
    costBasisLamports: '100000000', // 0.1 SOL
    grossProceedsLamports: '125000000', // 0.125 SOL
    dexImpactLamports: '1000000',
    priorityFeeLamports: '200000',
    jitoTipLamports: '10000',
    ataRentLamports: '2039280',
    realizedSlippageBps: 45,
    maximumFavorableExcursionPct: 30.5,
    maximumAdverseExcursionPct: -4.2,
    exitStage: 2,
  });

  assert.equal(resolvedOutcome.censored, false);
  assert.equal(resolvedOutcome.terminalState, 'take_profit');
  // Net = 125M - 100M - 1M - 200k - 10k - 2.03928M = 21750720
  assert.equal(resolvedOutcome.netReturnLamports, '21750720');
  assert.ok(Number(resolvedOutcome.netReturnBps) > 2000);
  assert.equal(resolvedOutcome.maximumFavorableExcursionPct, 30.5);
  assert.equal(resolvedOutcome.maximumAdverseExcursionPct, -4.2);

  // Case B: Right-censored token at session shutdown (MUST NOT be labeled as loss)
  const censoredOutcome = buildOutcomeLabel({
    candidateId,
    mint: 'TokenMint3333333333333333333333333333333333',
    entrySnapshotSlot: 284100300,
    censored: true,
    censoringReason: 'session_terminated',
    observationDurationMs: 12_000,
    costBasisLamports: '100000000',
    grossProceedsLamports: '98000000', // Current mark
    dexImpactLamports: 0n,
    priorityFeeLamports: 0n,
    jitoTipLamports: 0n,
    ataRentLamports: 0n,
    maximumFavorableExcursionPct: 2.1,
    maximumAdverseExcursionPct: -2.0,
    exitStage: 0,
  });

  assert.equal(censoredOutcome.censored, true);
  assert.equal(censoredOutcome.censoringReason, 'session_terminated');
  assert.equal(censoredOutcome.terminalState, 'censored_at_cutoff');
});

test('4. Complete fee, slippage, sizing, and policy metadata reconciliation', () => {
  const candidateId = 'cand-fee-reconcile-test';
  const outcome = buildOutcomeLabel({
    candidateId,
    mint: 'TokenMint4444444444444444444444444444444444',
    entrySnapshotSlot: 284100400,
    censored: false,
    terminalState: 'stop_loss',
    observationDurationMs: 60_000,
    costBasisLamports: '100000000', // 0.1 SOL
    grossProceedsLamports: '92000000', // 0.092 SOL
    dexImpactLamports: '800000', // 0.0008 SOL
    priorityFeeLamports: '250000', // 0.00025 SOL
    jitoTipLamports: '15000', // 0.000015 SOL
    ataRentLamports: '0',
    realizedSlippageBps: 82,
    maximumFavorableExcursionPct: 1.5,
    maximumAdverseExcursionPct: -8.5,
    exitStage: 0,
  });

  // Gross loss: -8_000_000. Frictions: 800_000 + 250_000 + 15_000 = 1_065_000.
  // Net = -8_000_000 - 1_065_000 = -9_065_000.
  assert.equal(outcome.grossProceedsLamports, '92000000');
  assert.equal(outcome.frictionTotalLamports, '1065000');
  assert.equal(outcome.netReturnLamports, '-9065000');
  assert.equal(outcome.realizedSlippageBps, 82);
});

test('5. Separate tracking for rejected, notEvaluated, and modelUnavailable dispositions', () => {
  const baseMicro = {
    buyerCount5m: 5,
    buyTransactionCount: 8,
    sellTransactionCount: 1,
    buySellRatio: 8.0,
    buyerArrivalVelocityPerSec: 0.05,
    topHoldersHashed: [],
    creatorWalletHashed: 'hashed-creator-5',
    creatorInitialSupplyPct: 0.0,
    creatorCurrentBalancePct: 0.0,
    creatorNetDeltaPct: 0.0,
  };

  // A. Rejected by hard safety check
  const rejectedSnap = buildCandidateSnapshot({
    mint: 'MintRejected1111111111111111111111111111111',
    poolAddress: 'PoolRejected111111111111111111111111111111',
    slot: 284100500,
    eventSignature: 'sig-reject-001',
    observedAtMs: 1726000005000,
    decisionAtMs: 1726000005010,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1.0,
      exitLadderConfigHash: 'ladder-v1',
    },
    evaluationDisposition: 'rejected',
    dispositionReason: 'excessive_spot_price_drift_frontrun',
    microstructure: baseMicro,
  });
  assert.equal(rejectedSnap.evaluationDisposition, 'rejected');
  assert.equal(rejectedSnap.dispositionReason, 'excessive_spot_price_drift_frontrun');

  // B. Not evaluated (bypassed due to portfolio exposure limit)
  const notEvalSnap = buildCandidateSnapshot({
    mint: 'MintNotEval11111111111111111111111111111111',
    poolAddress: 'PoolNotEval1111111111111111111111111111111',
    slot: 284100501,
    eventSignature: 'sig-noteval-001',
    observedAtMs: 1726000005100,
    decisionAtMs: 1726000005105,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1.0,
      exitLadderConfigHash: 'ladder-v1',
    },
    evaluationDisposition: 'notEvaluated',
    dispositionReason: 'max_portfolio_exposure_reached',
    microstructure: baseMicro,
  });
  assert.equal(notEvalSnap.evaluationDisposition, 'notEvaluated');
  assert.equal(notEvalSnap.dispositionReason, 'max_portfolio_exposure_reached');

  // C. Model unavailable (fail-closed when ML inference times out or schema fails)
  const modelUnavailableSnap = buildCandidateSnapshot({
    mint: 'MintModelUnavail1111111111111111111111111111',
    poolAddress: 'PoolModelUnavail111111111111111111111111111',
    slot: 284100502,
    eventSignature: 'sig-modelunavail-001',
    observedAtMs: 1726000005200,
    decisionAtMs: 1726000005215,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1.0,
      exitLadderConfigHash: 'ladder-v1',
    },
    evaluationDisposition: 'modelUnavailable',
    dispositionReason: 'ml_inference_timeout_12ms_exceeded_10ms_cap',
    microstructure: baseMicro,
  });
  assert.equal(modelUnavailableSnap.evaluationDisposition, 'modelUnavailable');
  assert.equal(modelUnavailableSnap.dispositionReason, 'ml_inference_timeout_12ms_exceeded_10ms_cap');

  // All three must have valid integrity seals
  assert.equal(verifySnapshotIntegrity(rejectedSnap).valid, true);
  assert.equal(verifySnapshotIntegrity(notEvalSnap).valid, true);
  assert.equal(verifySnapshotIntegrity(modelUnavailableSnap).valid, true);
});

test('6. Deterministic replay test: identical inputs produce byte-for-byte identical snapshots and labels', () => {
  const runSimulation = () => {
    const fixedTime = 1726000100000;
    const fixedSlot = 284200100;
    const mint = 'TokenDeterministicReplay1111111111111111111';
    const pool = 'PoolDeterministicReplay11111111111111111111';
    const sig = 'sig-deterministic-replay-001';

    const snap = buildCandidateSnapshot({
      mint,
      poolAddress: pool,
      slot: fixedSlot,
      eventSignature: sig,
      observedAtMs: fixedTime,
      decisionAtMs: fixedTime + 18,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-tp20-50-100-stop8',
      },
      evaluationDisposition: 'cleared',
      microstructure: {
        buyerCount5m: 10,
        buyTransactionCount: 15,
        sellTransactionCount: 2,
        buySellRatio: 7.5,
        buyerArrivalVelocityPerSec: 0.1,
        topHoldersHashed: [saltHashWallet('Wallet1', 'test-salt')],
        creatorWalletHashed: saltHashWallet('Creator1', 'test-salt'),
        creatorInitialSupplyPct: 4.5,
        creatorCurrentBalancePct: 4.5,
        creatorNetDeltaPct: 0.0,
      },
      curve: {
        tokenAgeSeconds: 30,
        realSolReservesLamports: '2000000000',
        virtualSolReservesLamports: '32000000000',
        virtualTokenReserves: '1000000000000000',
        curveCompletionPct: 6.25,
        reserveDriftPct: 0.01,
        spotPriceUsd: 0.000025,
      },
      transport: {
        quoteAgeMs: 8,
        leadingRpcLatencyMs: 15,
        trailingRpcDropRatePct: 0.0,
        inFlightOrderCount: 0,
        oldestPendingAgeMs: 0,
        reservedCashRatio: 0.1,
      },
    });

    const outcome = buildOutcomeLabel({
      candidateId: snap.candidateId,
      mint,
      entrySnapshotSlot: fixedSlot,
      censored: false,
      terminalState: 'take_profit',
      observationDurationMs: 30_000,
      costBasisLamports: '100000000',
      grossProceedsLamports: '120000000',
      dexImpactLamports: '500000',
      priorityFeeLamports: '150000',
      jitoTipLamports: '10000',
      ataRentLamports: '0',
      realizedSlippageBps: 35,
      maximumFavorableExcursionPct: 22.0,
      maximumAdverseExcursionPct: -1.0,
      exitStage: 1,
    });

    return { snap, outcome };
  };

  const passA = runSimulation();
  const passB = runSimulation();

  // Snapshot identity assertions
  assert.equal(passA.snap.candidateId, passB.snap.candidateId);
  assert.equal(passA.snap.featureSealHash, passB.snap.featureSealHash);
  assert.equal(JSON.stringify(passA.snap), JSON.stringify(passB.snap));

  // Outcome identity assertions
  assert.equal(passA.outcome.candidateId, passB.outcome.candidateId);
  assert.equal(passA.outcome.netReturnLamports, passB.outcome.netReturnLamports);
  assert.equal(JSON.stringify(passA.outcome), JSON.stringify(passB.outcome));
});

test('7. SessionLogger candidate and outcome streams logging and file integrity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fusion-candidate-log-test-'));
  try {
    const logger = new SessionLogger(dir);
    await logger.init();

    const snap = buildCandidateSnapshot({
      mint: 'MintLogTest111111111111111111111111111111111',
      poolAddress: 'PoolLogTest11111111111111111111111111111111',
      slot: 284100600,
      eventSignature: 'sig-log-test-001',
      observedAtMs: 1726000006000,
      decisionAtMs: 1726000006025,
      policyContext: {
        policyVersion: 'fusion-v1.4',
        maxSlippageBps: 1200,
        targetSizeLamports: '100000000',
        priorityFeeMultiplier: 1.0,
        exitLadderConfigHash: 'ladder-v1',
      },
      evaluationDisposition: 'cleared',
    });

    const outcome = buildOutcomeLabel({
      candidateId: snap.candidateId,
      mint: snap.mint,
      entrySnapshotSlot: snap.slot,
      censored: true,
      censoringReason: 'session_terminated',
      observationDurationMs: 15_000,
      costBasisLamports: '100000000',
      grossProceedsLamports: '100000000',
      dexImpactLamports: 0n,
      priorityFeeLamports: 0n,
      jitoTipLamports: 0n,
      ataRentLamports: 0n,
      maximumFavorableExcursionPct: 0.0,
      maximumAdverseExcursionPct: 0.0,
      exitStage: 0,
    });

    logger.writeCandidateSnapshot(snap);
    logger.writeOutcomeLabel(outcome);
    await logger.close();

    // Read back candidates.jsonl and outcomes.jsonl
    const candLines = (await readFile(join(dir, 'candidates.jsonl'), 'utf8')).trim().split('\n');
    const outLines = (await readFile(join(dir, 'outcomes.jsonl'), 'utf8')).trim().split('\n');

    assert.equal(candLines.length, 1);
    assert.equal(outLines.length, 1);

    const parsedSnap = JSON.parse(candLines[0]);
    const parsedOutcome = JSON.parse(outLines[0]);

    assert.equal(parsedSnap.candidateId, snap.candidateId);
    assert.equal(parsedSnap.featureSealHash, snap.featureSealHash);
    assert.equal(parsedOutcome.candidateId, outcome.candidateId);
    assert.equal(parsedOutcome.censored, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('8. Runtime model gate measures execution duration and enforces 10ms hard timeout', async () => {
  const baseSnap = buildCandidateSnapshot({
    mint: 'MintModelTimeoutTest11111111111111111111111',
    poolAddress: 'PoolModelTimeoutTest1111111111111111111111',
    slot: 284100700,
    eventSignature: 'sig-model-gate-001',
    observedAtMs: 1726000007000,
    decisionAtMs: 1726000007010,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
      priorityFeeMultiplier: 1.0,
      exitLadderConfigHash: 'ladder-v1',
    },
    evaluationDisposition: 'cleared',
    microstructure: {
      buyerCount5m: 12,
      buyTransactionCount: 20,
      sellTransactionCount: 2,
      buySellRatio: 10.0,
      buyerArrivalVelocityPerSec: 0.2,
      topHoldersHashed: [],
      creatorWalletHashed: 'creator-hash',
      creatorInitialSupplyPct: 0.0,
      creatorCurrentBalancePct: 0.0,
      creatorNetDeltaPct: 0.0,
    },
    curve: {
      tokenAgeSeconds: 25,
      realSolReservesLamports: '2000000000',
      virtualSolReservesLamports: '32000000000',
      virtualTokenReserves: '1000000000000000',
      curveCompletionPct: 5.0,
      reserveDriftPct: 0.0,
      spotPriceUsd: 0.000025,
    },
    transport: {
      quoteAgeMs: 5,
      leadingRpcLatencyMs: 12,
      trailingRpcDropRatePct: 0.0,
      inFlightOrderCount: 0,
      oldestPendingAgeMs: 0,
      reservedCashRatio: 0.1,
    },
  });

  // Case A: Fast model (sub-10ms, e.g. 1ms) -> passes with measured runtime duration
  const fastEvaluator = {
    name: 'xgb-fast',
    version: '1.0.0',
    async scoreCandidate() {
      // Simulate fast in-memory inference (~0.1ms tree traversal)
      await Promise.resolve();
      return { score: 0.82, accept: true, confidence: 0.95 };
    },
  };

  const fastDecision = await executeModelGate(baseSnap, fastEvaluator, { maxInferenceMs: 10.0, mode: 'ml_gated' });
  assert.equal(fastDecision.accepted, true);
  assert.equal(fastDecision.evaluationDisposition, 'cleared');
  assert.equal(fastDecision.score, 0.82);
  assert.ok(fastDecision.inferenceDurationMs < 10.0);
  assert.ok(fastDecision.inferenceDurationMs >= 0.0);

  // Case B: Slow model (> 10ms timeout, e.g. 25ms) -> aborts, rejects entry, marks modelUnavailable, and triggers AbortSignal
  let abortedSignalReceived = false;
  let loopIterationsExecuted = 0;
  const slowEvaluator = {
    name: 'xgb-slow',
    version: '1.0.0',
    async scoreCandidate(snap, signal) {
      signal?.addEventListener('abort', () => {
        abortedSignalReceived = true;
      });
      // Cooperative inference loop checking signal on every iteration
      for (let i = 0; i < 100; i++) {
        throwIfAborted(signal);
        loopIterationsExecuted++;
        await new Promise(r => setTimeout(r, 2));
      }
      return { score: 0.99, accept: true };
    },
  };

  const timeoutDecision = await executeModelGate(baseSnap, slowEvaluator, { maxInferenceMs: 10.0, mode: 'ml_gated' });
  assert.equal(timeoutDecision.accepted, false);
  assert.equal(timeoutDecision.evaluationDisposition, 'modelUnavailable');
  assert.ok(timeoutDecision.rejectionReason.includes('ml_inference_timeout'));
  assert.ok(timeoutDecision.rejectionReason.includes('exceeded_10ms_cap'));
  assert.ok(timeoutDecision.inferenceDurationMs >= 8.0);
  assert.equal(abortedSignalReceived, true); // Proves AbortSignal is actively signaled to stop work!
  assert.ok(loopIterationsExecuted < 20); // Proves loop cooperative termination stopped further execution!

  // Case C: Runtime model failure/exception -> fail-closed modelUnavailable rejection
  const failingEvaluator = {
    name: 'xgb-failing',
    version: '1.0.0',
    async scoreCandidate() {
      throw new Error('CUDA_OUT_OF_MEMORY');
    },
  };

  const errorDecision = await executeModelGate(baseSnap, failingEvaluator, { maxInferenceMs: 10.0, mode: 'ml_gated' });
  assert.equal(errorDecision.accepted, false);
  assert.equal(errorDecision.evaluationDisposition, 'modelUnavailable');
  assert.ok(errorDecision.rejectionReason.includes('ml_inference_error_CUDA_OUT_OF_MEMORY'));

  // Case D: Schema completeness failure (missing features) -> strictly rejects with modelUnavailable before model call
  const incompleteSnap = { ...baseSnap, missingFeatureCount: 2, featureAvailability: 0.8 };
  let modelWasCalled = false;
  const guardedEvaluator = {
    name: 'xgb-guard',
    version: '1.0.0',
    async scoreCandidate() {
      modelWasCalled = true;
      return { score: 0.9, accept: true };
    },
  };

  const incompleteDecision = await executeModelGate(incompleteSnap, guardedEvaluator, { maxInferenceMs: 10.0, mode: 'ml_gated' });
  assert.equal(incompleteDecision.accepted, false);
  assert.equal(incompleteDecision.evaluationDisposition, 'modelUnavailable');
  assert.ok(incompleteDecision.rejectionReason.includes('schema_incomplete_missing_2_features'));
  assert.equal(modelWasCalled, false); // Proves model was NOT invoked when schema is incomplete
});

