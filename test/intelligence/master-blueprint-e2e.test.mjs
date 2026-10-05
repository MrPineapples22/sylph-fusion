import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MasterIntelligenceEngine } from '../../dist/intelligence/master-orchestrator.js';
import { certifySyntheticRuntimeForTestOnly } from './helpers/synthetic-system-integrity.mjs';

test('Part 81 - Master Architecture End-to-End Scenario Loop with Unbroken Provenance', async () => {
  const master = new MasterIntelligenceEngine();
  certifySyntheticRuntimeForTestOnly(master);
  const mint = 'SoL55555555555555555555555555555555555555556';

  const canonicalEvent = {
    eventId: 'evt_e2e_master_001',
    eventType: 'TOKEN_CREATE',
    mint,
    slot: 448280100,
    timestampNs: BigInt(Date.now()) * 1_000_000n,
    receivedTimestampMs: Date.now(),
    commitment: 'confirmed',
    payload: {
      mint,
      name: 'Master Blueprint Token',
      symbol: 'MSTR',
      decimals: 9,
    },
    sourceConfidence: 0.98,
    freshnessMs: 40,
    provenance: ['PUMP_PORTAL_WS'],
  };

  const result = await master.processEvent(canonicalEvent, {
    tokenAgeSec: 45,
    rawWallets: [
      { address: 'w_creator', solFundedAmount: 5.0, buyVolumeSol: 2.0 },
      { address: 'w_buyer1', solFundedAmount: 2.5, buyVolumeSol: 1.2 },
      { address: 'w_buyer2', solFundedAmount: 3.0, buyVolumeSol: 1.5 },
      { address: 'w_buyer3', solFundedAmount: 4.0, buyVolumeSol: 2.1 },
    ],
    programOwner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 180,
    liquiditySol: 65,
    txCount: 85,
  });

  // 1. Verify Pipeline Completes & Emits Valid View Model
  assert.ok(result.eventId);
  assert.ok(result.viewModel);
  assert.equal(result.viewModel.mint, mint);
  assert.equal(result.viewModel.proofReport?.proofState, '3/3');

  // 2. Verify Blueprint Telemetry contains all Subsystems
  const bt = result.viewModel.blueprintTelemetry;
  assert.ok(bt);

  // Phase & Flow
  assert.ok(bt.phase.compactPhaseCode);
  assert.ok(bt.flow.flowCode);
  assert.ok(bt.thesis.state);
  assert.equal(bt.proof.proofState, '3/3');

  // SCOUT
  assert.ok(bt.scout);
  assert.equal(bt.scout.canonicalOpportunityId.startsWith('opp_'), true);
  assert.ok(bt.scout.effectiveIndependentFamilies >= 1);
  assert.ok(bt.scout.remainingCapacitySol > 0);

  // PATHFINDER
  assert.ok(bt.pathfinder);
  assert.ok(bt.pathfinder.authorizedSizeSol > 0);
  assert.ok(bt.pathfinder.optionalityScore > 0);
  assert.ok(bt.pathfinder.trappingScore <= 1.0);

  // COMPASS & CONSTITUTION
  assert.ok(bt.compass);
  assert.equal(bt.compass.missionMode, 'NORMAL');
  assert.equal(bt.compass.hardConstraintsPassed, true);
  assert.ok(bt.constitution);
  assert.equal(bt.constitution.lineageVerified, true);

  // MIRROR
  assert.ok(bt.mirror);
  assert.ok(bt.mirror.bestCounterfactualBranch);
  assert.ok(typeof bt.mirror.decisionRegretSol === 'number');

  // GUARDIAN & PHOENIX
  assert.ok(bt.guardian);
  assert.ok(bt.guardian.overallMarginPct > 0);
  assert.ok(bt.phoenix);
  assert.equal(bt.phoenix.currentStage, 'NORMAL');
  assert.equal(bt.phoenix.newEntriesPermitted, true);

  // ARCHIMEDES & SENTINEL-X
  assert.ok(bt.archimedes);
  assert.ok(bt.archimedes.establishedKnowledgeCount >= 1);
  assert.ok(bt.sentinelX);
  assert.ok(bt.sentinelX.effectiveParticipants > 0);

  // HORIZON & SAGE
  assert.ok(bt.horizon);
  assert.ok(bt.horizon.primaryRegime);
  assert.ok(bt.sage);
  assert.ok(bt.sage.overallCapabilityScore > 75);
  assert.equal(bt.sage.newEntryState, 'AVAILABLE');
});

test('Part 82 - Failure Injection, Boundary Breach & PHOENIX Autonomous Recovery', async () => {
  const master = new MasterIntelligenceEngine();

  // 1. Initial State is Healthy
  const initialSage = master.sage.auditCapabilities({
    rpcHealthy: true,
    feedFresh: true,
    isRecovering: false,
    queueLag: 2,
    killSwitchActive: false,
  });
  assert.equal(initialSage.capabilities.NEW_ENTRY, 'AVAILABLE');

  // 2. Boundary Degradation: Feed age spikes to 4,800ms (near 5,000ms unsafe threshold)
  const boundaryEnvelope = master.guardian.evaluateBoundaries({
    execution_latency_ms: 120,
    feed_age_ms: 4800,
    liquidity_depth_sol: 25.0,
    queue_depth: 42,
    capital_drawdown_pct: 2.0,
    rpc_error_rate_pct: 0.1,
  });
  assert.ok(boundaryEnvelope.overall_margin_pct < 10);
  assert.ok(boundaryEnvelope.safety_debt_score > 0);

  // 3. Crash Incident Injection
  master.phoenix.triggerIncident('Solana Cluster Fork Desync', 448280200);
  const crashStatus = master.phoenix.getStatus();
  assert.equal(crashStatus.current_stage, 'FAILURE');
  assert.equal(crashStatus.authority_epoch, 2); // Monotonic epoch bump invalidates permits!
  assert.equal(crashStatus.new_entries_permitted, false); // Fail-closed: entries blocked

  // SAGE reflects recovery state
  const recoveringSage = master.sage.auditCapabilities({
    rpcHealthy: true,
    feedFresh: true,
    isRecovering: true,
    queueLag: 15,
    killSwitchActive: false,
  });
  assert.equal(recoveringSage.capabilities.NEW_ENTRY, 'BLOCKED');
  assert.equal(recoveringSage.capabilities.EMERGENCY_EXIT, 'AVAILABLE');

  // 4. Progress through recovery sequence
  let stage = crashStatus.current_stage;
  while (stage !== 'NORMAL') {
    stage = master.phoenix.advanceRecoveryStage();
    if (stage === 'RECERTIFICATION') {
      master.phoenix.resetToNormal(448280300);
      break;
    }
  }

  // 5. System fully recovered
  const recoveredStatus = master.phoenix.getStatus();
  assert.equal(recoveredStatus.current_stage, 'NORMAL');
  assert.equal(recoveredStatus.new_entries_permitted, true);

  const restoredSage = master.sage.auditCapabilities({
    rpcHealthy: true,
    feedFresh: true,
    isRecovering: false,
    queueLag: 1,
    killSwitchActive: false,
  });
  assert.equal(restoredSage.capabilities.NEW_ENTRY, 'AVAILABLE');
  assert.equal(restoredSage.overall_capability_score, 100);
});
