/**
 * SYLPH FUSION — PASS 60 VERIFICATION SUITE
 * Economic Flight Recorder, Writable-Set Contention Fee Surface & Execution Policy Master Integration
 * Specifications: Master Blueprint Sections 5, 6, 7 (Economic Flight Recorder),
 * Section XX (Execution Attempt Recording), Section XXII (Writable-Set Fee Model),
 * Section XXIII (Execution Policy Promotion).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EconomicFlightRecorder,
  SQLiteExecutionAttemptStore,
  WritableSetFeeSurface,
  computeWritableSetHash,
  createPolicyArtifact,
} from '../../dist/intelligence/execution-adaptation/index.js';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Pass 60 Test 1: EconomicFlightRecorder Epistemic Invariants (Pre-Decision Discovery, Append-Only SQLite WAL, Trigger Immutability) (Sections 5, 6, 7)', async () => {
  const store = new SQLiteExecutionAttemptStore(':memory:');
  const recorder = new EconomicFlightRecorder(store);

  const factId = 'fact_pass60_epistemic_01';
  const mint = 'MintFlightRecorder11111111111111111111111111';
  const creator = 'CreatorFlight111111111111111111111111111111';

  // Invariant 1: Record candidate at DISCOVERED stage BEFORE knowing result (zero selection bias)
  const discoveryRecord = recorder.recordDiscovery({
    economicFactId: factId,
    mint,
    creator,
    protocol: 'Pump_Bonding_Curve',
    regime: 'EXPANSION',
  });

  assert.equal(discoveryRecord.stage, 'DISCOVERED');
  assert.equal(discoveryRecord.revision, 0);
  assert.equal(discoveryRecord.economicFactId, factId);
  assert.equal(discoveryRecord.mint, mint);
  assert.ok(discoveryRecord.flightId.startsWith(`flight_${factId}_r0`));
  assert.ok(discoveryRecord.recordHash.length === 64);

  // Invariant 2: Guarded lifecycle from DISCOVERED -> FILTER_EVALUATED -> DECISION_CREATED
  const filterRecord = recorder.advanceLifecycle(factId, discoveryRecord.executionGenerationId, 'FILTER_EVALUATED', {});
  assert.equal(filterRecord.stage, 'FILTER_EVALUATED');
  assert.equal(filterRecord.revision, 1);
  assert.ok(filterRecord.recordHash.length === 64);
  assert.notEqual(filterRecord.recordHash, discoveryRecord.recordHash);

  const decisionRecord = recorder.advanceLifecycle(factId, discoveryRecord.executionGenerationId, 'DECISION_CREATED', {
    decisionPrice: 155.5,
    requestedInputLamports: 1_000_000_000n,
    priorityFeeLamports: 100_000n,
    jitoTipLamports: 25_000n,
    transport: 'JITO_BUNDLE',
  });
  assert.equal(decisionRecord.stage, 'DECISION_CREATED');
  assert.equal(decisionRecord.revision, 2);
  assert.equal(decisionRecord.decisionPrice, 155.5);
  assert.equal(decisionRecord.requestedInputLamports, 1_000_000_000n);

  // Invariant 3: History store query by attempt & fact/gen
  const latest = store.getLatest(factId, discoveryRecord.executionGenerationId);
  assert.ok(latest);
  assert.equal(latest.revision, 2);
  assert.equal(latest.stage, 'DECISION_CREATED');

  const allRevs = store.getRevisions(factId, discoveryRecord.executionGenerationId);
  assert.equal(allRevs.length, 3);
  assert.equal(allRevs[0].stage, 'DISCOVERED');
  assert.equal(allRevs[1].stage, 'FILTER_EVALUATED');
  assert.equal(allRevs[2].stage, 'DECISION_CREATED');

  // Invariant 4: SQLite Database Triggers enforce strict immutable history (No updates, No deletes)
  const db = (store).db;
  assert.throws(
    () => {
      db.prepare('UPDATE flight_records SET stage = ? WHERE flight_id = ?').run('LANDED_SUCCESS', discoveryRecord.flightId);
    },
    /FLIGHT_RECORDER_UPDATE_FORBIDDEN/,
    'Database trigger must forbid any UPDATE'
  );

  assert.throws(
    () => {
      db.prepare('DELETE FROM flight_records WHERE flight_id = ?').run(discoveryRecord.flightId);
    },
    /FLIGHT_RECORDER_DELETE_FORBIDDEN/,
    'Database trigger must forbid any DELETE'
  );
});

test('Pass 60 Test 2: WritableSetFeeSurface Hierarchy Tier Fallback & Exact Contention Ratio Matching (Section XXII)', async () => {
  const surface = new WritableSetFeeSurface();

  const accounts = [
    'Mint111111111111111111111111111111111111111',
    'ProgramState111111111111111111111111111111111',
    'Vault1111111111111111111111111111111111111111',
  ];
  const programId = 'PumpFunProgram11111111111111111111111111111';

  // 1. Initial lookup with zero history returns GLOBAL fallback
  const recGlobal = surface.getRecommendation(accounts, programId);
  assert.equal(recGlobal.matchedTier, 'GLOBAL');
  assert.equal(recGlobal.recommendedPriorityFeeMicroLamports, 50_000n);
  assert.equal(recGlobal.recommendedJitoTipLamports, 10_000n);
  assert.equal(recGlobal.observedContentionRatio, 0.2);
  assert.equal(recGlobal.writableSetHash, computeWritableSetHash(accounts));

  // 2. Add 1 observation on program cohort
  surface.updateObservation(['OtherAcc1', 'OtherAcc2'], programId, 80_000n, 15_000n);
  const recProgram = surface.getRecommendation(accounts, programId);
  assert.equal(recProgram.matchedTier, 'PROGRAM_POOL_COHORT');
  assert.equal(recProgram.recommendedPriorityFeeMicroLamports, 80_000n);
  assert.equal(recProgram.recommendedJitoTipLamports, 15_000n);
  assert.equal(recProgram.observedContentionRatio, 0.5);

  // 3. Add 3 exact observations on accounts -> promotes to EXACT_WRITABLE_SET tier
  surface.updateObservation(accounts, programId, 120_000n, 30_000n);
  surface.updateObservation(accounts, programId, 140_000n, 40_000n);
  surface.updateObservation(accounts, programId, 160_000n, 50_000n);

  const recExact = surface.getRecommendation(accounts, programId);
  assert.equal(recExact.matchedTier, 'EXACT_WRITABLE_SET');
  assert.ok(recExact.recommendedPriorityFeeMicroLamports >= 120_000n);
  assert.ok(recExact.recommendedJitoTipLamports >= 30_000n);
  assert.ok(recExact.observedContentionRatio >= 0.3);
});

test('Pass 60 Test 3: ExecutionPolicyArtifact Deterministic SHA-256 Identification & Promotion Tiers (Section XXIII)', async () => {
  // 1. Create Champion Policy
  const champion = createPolicyArtifact({
    tier: 'CHAMPION',
    version: '1.0.0-PROD',
    basePriorityFeeMicroLamports: 100_000n,
    baseJitoTipLamports: 25_000n,
    maxSlippageBps: 250,
    targetCuBufferFraction: 0.20,
    preferredTransport: 'JITO_SINGLE_TX_BUNDLE',
  });

  assert.equal(champion.tier, 'CHAMPION');
  assert.equal(champion.version, '1.0.0-PROD');
  assert.ok(champion.policyId.startsWith('pol_champion_'));
  assert.equal(champion.policyHash.length, 64);
  assert.equal(champion.preferredTransport, 'JITO_SINGLE_TX_BUNDLE');

  // 2. Create Challenger Policy
  const challenger = createPolicyArtifact({
    tier: 'CHALLENGER',
    version: '1.1.0-EXP',
    basePriorityFeeMicroLamports: 150_000n,
    baseJitoTipLamports: 40_000n,
    maxSlippageBps: 200,
    targetCuBufferFraction: 0.25,
    preferredTransport: 'JITO_SINGLE_TX_BUNDLE',
  });

  assert.equal(challenger.tier, 'CHALLENGER');
  assert.ok(challenger.policyId.startsWith('pol_challenger_'));
  assert.notEqual(challenger.policyHash, champion.policyHash);

  // 3. Create Probe Policy
  const probe = createPolicyArtifact({
    tier: 'PROBE',
    version: '0.9.0-CANARY',
    basePriorityFeeMicroLamports: 50_000n,
    baseJitoTipLamports: 10_000n,
    maxSlippageBps: 300,
    targetCuBufferFraction: 0.15,
    preferredTransport: 'DIRECT_RPC',
  });

  assert.equal(probe.tier, 'PROBE');
  assert.ok(probe.policyId.startsWith('pol_probe_'));
});

test('Pass 60 Test 4: Master Orchestrator Decision Kernel Fail-Closed Gating on Severe Writable-Set Contention & Unpromoted Policies', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintFeeContentionGating111111111111111111111';
  const eventTime = Date.now() - 500;

  const baseEvent = {
    eventId: 'evt_pass60_gating_01',
    eventType: 'TRADE',
    mint,
    signature: '5sig_pass60_gating',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: eventTime,
    receivedTimestampMs: eventTime + 10,
    monotonicTimestamp: 60100,
    slot: 601_200,
    parentSlot: 601_199,
    blockhash: 'BhashPass60Gating',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 25.0,
      priceSol: 0.00004,
      symbol: 'FEE60',
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

  // 1. Severe contention ratio (>= 0.95) blocks capital fail closed
  const saturatedFeeRec = {
    writableSetHash: 'hash_saturated_lock',
    matchedTier: 'EXACT_WRITABLE_SET',
    recommendedPriorityFeeMicroLamports: 500_000n,
    recommendedJitoTipLamports: 150_000n,
    observedContentionRatio: 0.98,
  };

  const contextSevereContention = {
    ...normalContext,
    enforceFeeContentionGating: true,
    feeRecommendation: saturatedFeeRec,
  };

  const resultSevere = await engine.processEvent(baseEvent, contextSevereContention);
  assert.equal(resultSevere.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(resultSevere.whyExecutionBlocked?.includes('BLOCKED — SEVERE WRITABLE-SET CONTENTION'));
  assert.ok(resultSevere.whyExecutionBlocked?.includes('98.0%'));

  // 2. Unpromoted PROBE policy blocks execution fail closed
  const probePolicy = createPolicyArtifact({
    tier: 'PROBE',
    version: '0.1.0-UNPROMOTED',
    basePriorityFeeMicroLamports: 50_000n,
    baseJitoTipLamports: 10_000n,
    maxSlippageBps: 300,
    targetCuBufferFraction: 0.15,
    preferredTransport: 'DIRECT_RPC',
  });

  const contextProbe = {
    ...normalContext,
    enforcePolicyGating: true,
    executionPolicy: probePolicy,
  };

  const resultProbe = await engine.processEvent({ ...baseEvent, eventId: 'evt_pass60_gating_02' }, contextProbe);
  assert.equal(resultProbe.decision, 'CHALLENGED_ABSTAIN');
  assert.ok(resultProbe.whyExecutionBlocked?.includes('BLOCKED — UNPROMOTED EXECUTION POLICY'));
  assert.ok(resultProbe.whyExecutionBlocked?.includes('Tier: PROBE'));

  // 3. Normal conditions do NOT trigger contention or policy block
  const normalFeeRec = {
    writableSetHash: 'hash_normal_lock',
    matchedTier: 'EXACT_WRITABLE_SET',
    recommendedPriorityFeeMicroLamports: 100_000n,
    recommendedJitoTipLamports: 25_000n,
    observedContentionRatio: 0.25,
  };

  const contextNormal = {
    ...normalContext,
    enforceFeeContentionGating: true,
    enforcePolicyGating: true,
    feeRecommendation: normalFeeRec,
  };

  const resultNormal = await engine.processEvent({ ...baseEvent, eventId: 'evt_pass60_gating_03' }, contextNormal);
  assert.notEqual(resultNormal.whyExecutionBlocked?.includes('SEVERE WRITABLE-SET CONTENTION'), true);
  assert.notEqual(resultNormal.whyExecutionBlocked?.includes('UNPROMOTED EXECUTION POLICY'), true);
});

test('Pass 60 Test 5: Master Pipeline ViewModel Projection, Telemetry Strip & Lifecycle Stage Invariants (Sections 5, 6, 7, XX, XXII, XXIII)', async () => {
  const engine = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(engine);

  const mint = 'MintViewModelPass601111111111111111111111111';
  const now = Date.now();
  const event = {
    eventId: 'evt_pass60_vm_01',
    eventType: 'TRADE',
    mint,
    slot: 160_000,
    sourceTimestampMs: now - 400,
    receivedTimestampMs: now - 390,
    payload: {
      amountSol: 1.5,
      isBuy: true,
    },
  };

  const context = {
    tokenAgeSec: 75,
    liquiditySol: 50.0,
    marketCapSol: 180.0,
    txCount: 95,
    programOwner: 'owner_vm_pass60',
    rawWallets: [],
  };

  const result = await engine.processEvent(event, context);
  const vm = result.viewModel;

  // 1. Verify MasterPipelineResult fields
  assert.ok(result.flightRecord);
  assert.equal(result.flightRecord.stage, 'DECISION_CREATED');
  assert.equal(result.flightRecord.revision, 2);
  assert.ok(result.flightRecord.recordHash.length === 64);
  assert.ok(result.feeRecommendation);
  assert.ok(result.executionPolicy);
  assert.equal(result.executionPolicy.tier, 'CHAMPION');

  // 2. Verify ViewModel projected fields for UI Telemetry Strip
  assert.ok(vm.flightRecord);
  assert.equal(vm.flightStage, 'DECISION_CREATED');
  assert.equal(vm.flightRecordHash, result.flightRecord.recordHash);
  assert.ok(vm.feeRecommendation);
  assert.ok(vm.feeHierarchyTier);
  assert.ok(typeof vm.observedContentionRatio === 'number');
  assert.ok(vm.executionPolicy);
  assert.equal(vm.policyTier, 'CHAMPION');
  assert.ok(vm.policyHash.length === 64);

  // 3. Verify public helper methods on MasterIntelligenceEngine
  assert.ok(engine.getEconomicFlightRecorder() instanceof EconomicFlightRecorder);
  assert.ok(engine.getFeeSurface() instanceof WritableSetFeeSurface);
  assert.ok(engine.getExecutionPolicy().policyId.startsWith('pol_champion_'));

  // 4. Verify fee observation updates fee surface dynamically
  engine.recordFeeObservation([mint, 'AccountA'], 'program_test', 180_000n, 45_000n);
  const updatedRec = engine.getFeeSurface().getRecommendation([mint, 'AccountA'], 'program_test');
  assert.ok(updatedRec);
  assert.ok(updatedRec.recommendedPriorityFeeMicroLamports >= 50_000n);
});
