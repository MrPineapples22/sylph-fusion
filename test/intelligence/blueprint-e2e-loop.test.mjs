import test from 'node:test';
import assert from 'node:assert/strict';

import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Part XCVI - SOL-SYLPH End-to-End Unified Intelligence Blueprint Loop', async () => {
  const master = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(master);

  // 1. New launch detected & canonical event created
  const now = Date.now();
  const mint = 'SoL111111111111111111111111111111111111112';
  const canonicalEvent = {
    eventId: 'evt_e2e_launch_001',
    canonicalKey: `290000:sig_e2e_launch_tx:0:0:TOKEN_CREATE`,
    eventType: 'TOKEN_CREATE',
    mint,
    signature: 'sig_e2e_launch_tx',
    instructionIndex: 0,
    innerInstructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceSequence: 1,
    commitment: 'confirmed',
    chainTime: now - 30,
    sourceTimestampMs: now - 30,
    observedAt: now - 25,
    receivedAt: now - 20,
    receivedTimestampMs: now - 20,
    decodedAt: now - 15,
    monotonicTimestamp: now,
    slot: 290_000,
    parentSlot: 289_999,
    blockhash: 'BlockhashAlpha1111111111111111111111111111111',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: {
      amountSol: 15.0,
      priceSol: 0.000025,
    },
    sourceConfidence: 0.98,
    freshnessMs: 20,
    provenance: ['PUMP_PORTAL_WS'],
    schemaVersion: '1.0.0',
    decoderVersion: 'pump_v2',
    rawHash: 'hash_e2e_launch_raw',
  };

  // 2. Process through complete Master Orchestrator Pipeline
  const e2eResult = await master.processEvent(canonicalEvent, {
    tokenAgeSec: 35,
    rawWallets: [
      { address: 'w_founder', solFundedAmount: 5.0, parentFundingAddress: 'binance_hot', buyVolumeSol: 2.0 },
      { address: 'w_buyer_a', solFundedAmount: 2.5, parentFundingAddress: 'coinbase_hot', buyVolumeSol: 1.5 },
      { address: 'w_buyer_b', solFundedAmount: 3.0, parentFundingAddress: 'kraken_hot', buyVolumeSol: 2.2 },
      { address: 'w_buyer_c', solFundedAmount: 1.2, parentFundingAddress: 'okx_hot', buyVolumeSol: 0.8 },
      { address: 'w_buyer_d', solFundedAmount: 4.0, parentFundingAddress: 'bybit_hot', buyVolumeSol: 3.1 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 150,
    liquiditySol: 60,
    txCount: 38,
  });

  // 3. Verify Decision and Unified Status
  assert.equal(e2eResult.decision, 'AUTHORIZED_BUY');
  assert.ok(e2eResult.allocatedSol > 0);

  // 4. Verify Aether Flux View Model enriched with Blueprint Telemetry
  const vm = e2eResult.viewModel;
  assert.ok(vm.blueprintTelemetry !== undefined, 'Aether Flux View Model must include blueprintTelemetry');
  
  const telemetry = vm.blueprintTelemetry;

  // Phase
  assert.ok(['EXPANSION', 'MOMENTUM', 'ACCUM', 'DISCOVERY'].includes(telemetry.phase.compactPhaseCode));
  assert.ok(telemetry.phase.confidence > 0);

  // Proof (3 independent certificates)
  assert.equal(telemetry.proof.proofState, '3/3');
  assert.equal(telemetry.proof.validCount, 3);
  assert.equal(telemetry.proof.structuralValid, true);
  assert.equal(telemetry.proof.marketValid, true);
  assert.equal(telemetry.proof.executionValid, true);

  // Capital Flow
  assert.ok(telemetry.flow.capitalNoveltyRatio > 0.4);
  assert.ok(telemetry.flow.netIndependentCapitalFlowSol > 0);
  assert.ok(['INFLOW', 'ROTATION', 'RELATED'].includes(telemetry.flow.flowCode));

  // Live Thesis
  assert.ok(['INTACT', 'STRENGTHENING'].includes(telemetry.thesis.state));

  // Forensics (WHY, WHY NOT, WHAT CHANGED, WHY STILL VALID)
  assert.ok(telemetry.forensics.why.length >= 3);
  assert.equal(telemetry.forensics.whyNot.length, 0);
  assert.ok(telemetry.forensics.whatChanged.length > 0);
  assert.ok(telemetry.forensics.whyStillValid.length > 0);

  // Digital Twin DTF & Exit Capacity
  assert.ok(telemetry.twin.robustExitCapacitySol > 1.0);
  assert.ok(telemetry.twin.distanceToFailure > 0.5);

  // System Integrity
  assert.equal(telemetry.system.status, 'OK');
  assert.equal(telemetry.system.mode, 'NORMAL');

  // 5. Verify Connection Audit Graph
  const auditReport = master.runConnectionAudit();
  assert.equal(auditReport.passed, true);
  assert.equal(auditReport.brokenEdges.length, 0, 'No broken edges allowed in blueprint connection audit');
  assert.equal(auditReport.riskBypasses.length, 0, 'No risk bypasses allowed');
  assert.ok(auditReport.totalConnectionsChecked >= 10);

  // 6. Test Outcome Logging and Thesis Autopsy Loop (Parts LII, LIV, LV)
  master.groundTruthLedger.registerCandidate({
    mint,
    decision: 'APPROVED',
    priceSol: 0.000025,
    mcapSol: 150,
    liquiditySol: 60,
  });

  master.groundTruthLedger.recordCheckpoint(mint, {
    horizon: '+1m',
    priceSol: 0.000035,
    chartReturnPct: 40.0,
    executableDepthSol: 5.0,
    independentActorsCount: 14,
  });

  const record = master.groundTruthLedger.getRecord(mint);
  assert.ok(record !== undefined);
  assert.equal(record?.checkpoints['+1m']?.chartReturnPct, 40.0);
  assert.ok(record?.simulations.length === 5);

  const autopsy = master.thesisAutopsy.conductAutopsy({
    mint,
    thesisCreatedMs: now - 30_000,
    actualOutcome: 'PROFITABLE_EXIT',
    wasThesisInvalidated: false,
  });

  assert.equal(autopsy.actualOutcome, 'PROFITABLE_EXIT');
  assert.equal(autopsy.classification, 'HEALTHY_THESIS_CONFIRMED');
  assert.equal(autopsy.invalidationLatencyMs, 0);
});
