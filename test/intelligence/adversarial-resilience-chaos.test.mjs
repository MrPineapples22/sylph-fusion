import test from 'node:test';
import assert from 'node:assert/strict';

import { ChainTruthEngine } from '../../dist/intelligence/truth/chain-truth.js';
import { FundingAncestryEngine } from '../../dist/intelligence/graph/funding-ancestry.js';
import { TemporalEvidenceGraph } from '../../dist/intelligence/graph/temporal-evidence-graph.js';
import { MetaIntelligenceController } from '../../dist/intelligence/runtime/meta-intelligence.js';
import { ConnectionAuditor } from '../../dist/intelligence/governance/connection-auditor.js';

test('Event Idempotency: Repeated processing of the identical event produces identical state', () => {
  const truth = new ChainTruthEngine();

  const event = {
    eventId: 'evt_idem_100',
    eventType: 'SWAP',
    mint: 'So11111111111111111111111111111111111111112',
    signature: 'sig_idempotent_test',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: 1_000_000,
    receivedTimestampMs: 1_000_050,
    monotonicTimestamp: 10050,
    slot: 280_000,
    parentSlot: 279_999,
    blockhash: 'BhashIdem123',
    commitment: 'confirmed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'CONFIRMED',
    payload: { amountSol: 10.0 },
    sourceConfidence: 1.0,
    freshnessMs: 50,
    provenance: ['PUMP_PORTAL_WS'],
  };

  // Register once
  const first = truth.registerEvent(event);
  const count1 = truth.getCommitmentSummary().totalTrackedEvents;

  // Register again (E o E)
  const second = truth.registerEvent(event);
  const count2 = truth.getCommitmentSummary().totalTrackedEvents;

  // Register third time (E o E o E)
  const third = truth.registerEvent(event);
  const count3 = truth.getCommitmentSummary().totalTrackedEvents;

  assert.equal(first, true, 'First event registration must return true');
  assert.equal(second, false, 'Duplicate event registration must return false (idempotent skip)');
  assert.equal(third, false, 'Triplicate event registration must return false (idempotent skip)');
  assert.equal(count1, 1);
  assert.equal(count2, 1, 'Event count must not increment on duplicate delivery');
  assert.equal(count3, 1, 'Event count must remain 1 across 3 identical event deliveries');
});

test('Fork Reconciliation: Replaced fork rolls back processed state and invokes forensic listeners', () => {
  const truth = new ChainTruthEngine();
  let rollbackActionTriggered = null;

  truth.registerRollbackListener((action) => {
    rollbackActionTriggered = action;
  });

  const eventOnFork = {
    eventId: 'evt_fork_001',
    eventType: 'SWAP',
    mint: 'So11111111111111111111111111111111111111112',
    signature: 'sig_fork_test',
    instructionIndex: 0,
    source: 'PUMP_PORTAL',
    sourceTimestampMs: 1_000_000,
    receivedTimestampMs: 1_000_050,
    monotonicTimestamp: 10050,
    slot: 280_050,
    parentSlot: 280_049,
    blockhash: 'BhashFork123',
    commitment: 'processed',
    transactionVersion: 'legacy',
    sequenceId: 1,
    chainState: 'PROCESSED',
    payload: { amountSol: 10.0 },
    sourceConfidence: 1.0,
    freshnessMs: 50,
    provenance: ['PUMP_PORTAL_WS'],
  };

  truth.registerEvent(eventOnFork);

  // Fork dropped at slot 280_050 in favor of canonical slot 280_051
  truth.handleForkDetected([280_050], 280_051);

  assert.ok(rollbackActionTriggered, 'Must notify rollback listeners with dropped event action');
  assert.equal(rollbackActionTriggered.orphanedEvent.eventId, 'evt_fork_001');
  assert.equal(rollbackActionTriggered.orphanedEvent.chainState, 'ORPHANED');
});

test('FundingAncestryEngine detects STAR_FUNDING and flags synthetic Sybil clusters', () => {
  const ancestry = new FundingAncestryEngine();

  // Star funding: Single parent funding 10 distinct buyer wallets
  const starWallets = Array.from({ length: 10 }, (_, i) => ({
    walletAddress: `buyer_${i}`,
    fundingParentAddress: 'master_funder_whale',
    fundingAmountSol: 2.0,
    hopsFromExchange: 1,
  }));

  const report = ancestry.analyzeAncestry(starWallets, 'creator_wallet');
  assert.ok(report.sharedFunderRatio >= 0.8, 'Star funding must have high shared funder ratio');
  assert.ok(report.isSyntheticSybilCluster, 'Must detect synthetic Sybil cluster');
  assert.ok(report.detectedMotifs.includes('STAR_FUNDING'), 'Must classify motif as STAR_FUNDING');
});

test('MetaIntelligenceController: Non-compensatory operational safety halts system on critical fault', () => {
  const meta = new MetaIntelligenceController();

  // Scenario A: Clean healthy infrastructure
  const healthy = meta.evaluateSystemTrust({
    rpcHealthy: true,
    feedFreshnessMs: 50,
    queueDepth: 10,
    activeViolationsCount: 0,
    calibrationBrierScore: 0.12,
    oodScore: 0.05,
    failedExecutionsCount: 0,
    unreconciledEventsCount: 0,
  });

  assert.equal(healthy.state, 'HEALTHY');
  const assuranceClean = meta.generateAssuranceCase({
    decisionId: 'dec_001',
    mint: 'mint_clean',
    operationalState: healthy.state,
    trustVector: healthy.vector,
    provenanceChain: ['evt_1'],
  });
  assert.equal(assuranceClean.isAuthorizedForExecution, true);

  // Scenario B: Risk invariant violation (Critical non-compensatory fault)
  const faulted = meta.evaluateSystemTrust({
    rpcHealthy: true,
    feedFreshnessMs: 50,
    queueDepth: 10,
    activeViolationsCount: 1, // 1 critical violation
    calibrationBrierScore: 0.08, // Model score is excellent
    oodScore: 0.02,
    failedExecutionsCount: 0,
    unreconciledEventsCount: 0,
  });

  assert.equal(faulted.state, 'HALTED', 'Critical invariant violation must trigger HALTED regardless of model competence');
  const assuranceHalted = meta.generateAssuranceCase({
    decisionId: 'dec_002',
    mint: 'mint_faulted',
    operationalState: faulted.state,
    trustVector: faulted.vector,
    provenanceChain: ['evt_2'],
  });
  assert.equal(assuranceHalted.isAuthorizedForExecution, false, 'Runtime assurance must refuse execution authorization when HALTED');
  assert.ok(assuranceHalted.blockingInvariants.length > 0, 'Must record blocking invariant explanation');
});

test('ConnectionAuditor detects missing risk authorization and execution bypasses', () => {
  const auditor = new ConnectionAuditor();

  // Audit with a bypassed execution route lacking risk authorization
  const auditResult = auditor.audit([
    { producer: 'PumpPortal', consumer: 'EventFabric', isHealthy: true, lastSeenAgeMs: 100, hasRiskAuthorization: true, hasDecisionProvenance: true },
    { producer: 'RogueSignal', consumer: 'DirectExecution', isHealthy: true, lastSeenAgeMs: 100, hasRiskAuthorization: false, hasDecisionProvenance: true },
  ]);

  assert.equal(auditResult.passed, false, 'Auditor must fail when risk bypass exists');
  assert.ok(auditResult.riskBypasses.length > 0, 'Must report the specific critical bypass');
  assert.ok(auditResult.riskBypasses[0].includes('lacks independent risk authorization'));
});
