import test from 'node:test';
import assert from 'node:assert/strict';

import { LiveThesisEngine } from '../../dist/intelligence/thesis/live-thesis-engine.js';
import { ContradictionEngine } from '../../dist/intelligence/thesis/contradiction-engine.js';
import { ForensicExplainabilityEngine } from '../../dist/intelligence/thesis/explainability-engine.js';
import { SafetyKernel } from '../../dist/intelligence/kernel/safety-kernel.js';
import { ExecutionPermitEngine } from '../../dist/intelligence/execution/execution-permit.js';

test('Blueprint Phase 11 - Live Thesis Engine: Assumption Graph & Invalidation', () => {
  const thesisEngine = new LiveThesisEngine();
  const mint = 'ThesisToken11111111111111111111111111111111';

  // 1. Initial healthy thesis -> INTACT or STRENGTHENING
  const thesis = thesisEngine.createInitialThesis({
    mint,
    structuralValid: true,
    actorsGrowing: true,
    freshCapitalPositive: true,
    exitCapacitySufficient: true,
    phaseSupportive: true,
  });

  assert.ok(thesis.thesisId.startsWith('th_'));
  assert.ok(thesis.state === 'INTACT' || thesis.state === 'STRENGTHENING');
  assert.equal(thesis.assumptions.length, 5);

  // 2. Re-evaluate with structural violation (creator enables freeze authority) -> INVALIDATED
  const invalidatedThesis = thesisEngine.reevaluateThesis(mint, {
    hasFreezeAuthority: true,
  });

  assert.ok(invalidatedThesis !== undefined);
  assert.equal(invalidatedThesis?.state, 'INVALIDATED', 'Structural failure must immediately invalidate the thesis');
  assert.ok(invalidatedThesis?.invalidationConditionsMet.includes('STRUCTURAL_CERTIFICATE_FAIL'));
});

test('Blueprint Phase 11 - Contradiction Engine & Severity Escalation', () => {
  const contradictionEngine = new ContradictionEngine();
  const mint = 'ContraToken11111111111111111111111111111111';

  // Minor contradiction -> LOG_ONLY
  const minorEvent = contradictionEngine.recordContradiction({
    mint,
    thesisId: 'th_001',
    assumptionId: 'asm_actor_01',
    previousEvidence: '12 independent actors',
    newEvidence: '11 independent actors (-1 exit)',
    severity: 'MINOR',
  });
  assert.equal(minorEvent.severity, 'MINOR');
  assert.equal(minorEvent.downstreamActionRequired, 'LOG_ONLY');

  // Critical contradiction (Backdoor detected) -> IMMEDIATE_RISK_REVOCATION
  const criticalEvent = contradictionEngine.recordContradiction({
    mint,
    thesisId: 'th_001',
    assumptionId: 'asm_struct_01',
    previousEvidence: 'Freeze authority disabled',
    newEvidence: 'Freeze authority active on-chain',
    severity: 'CRITICAL',
  });
  assert.equal(criticalEvent.severity, 'CRITICAL');
  assert.equal(criticalEvent.downstreamActionRequired, 'IMMEDIATE_RISK_REVOCATION');
});

test('Blueprint Phase 11 & Part LI - Forensic Explainability Engine (4 Questions)', () => {
  const explainEngine = new ForensicExplainabilityEngine();
  const mint = 'ExplainToken1111111111111111111111111111111';

  const report = explainEngine.generateReport({
    mint,
    proofState: '3/3',
    structuralValid: true,
    marketValid: true,
    executionValid: true,
    priceChangePct: -12.0, // Price dipped 12%
    netIndependentFlowSol: 5.5, // But independent capital is accumulating
    topClusterSharePct: 15,
    exitCapacitySol: 6.0,
  });

  // 1. WHY?
  assert.ok(report.why.length > 0);
  assert.ok(report.why.some(w => w.includes('Structural safety invariants verified')));

  // 2. WHY NOT? (Should be empty of blockers when 3/3 proof)
  assert.equal(report.whyNot.length, 0);

  // 3. WHY STILL VALID? (Must explain why the price drop did NOT invalidate the thesis)
  assert.ok(report.whyStillValid.length > 0);
  assert.ok(report.whyStillValid.some(v => v.includes('Price fell by 12.0%')));
  assert.ok(report.whyStillValid.some(v => v.includes('Independent capital remains positive')));
});

test('Blueprint Phase 13 - Deterministic Safety Kernel: Execution Invariants Overriding AI', () => {
  const kernel = new SafetyKernel();

  // Test Case 1: All invariants satisfied -> Approved
  const checkApproved = kernel.verifyExecutionIntent({
    orderSizeSol: 0.5,
    currentPortfolioExposureSol: 2.0,
    quoteAgeMs: 120,
    slippageBps: 80,
    proofState: '3/3',
    hasFreezeAuthority: false,
    hasPermanentDelegate: false,
    distanceToFailure: 0.8,
    systemIntegrityValid: true,
  });
  assert.equal(checkApproved.passed, true);
  assert.equal(checkApproved.permitIssuanceAllowed, true);

  // Test Case 2: AI says buy, but freeze authority exists -> Hard block
  const checkFreezeBlocked = kernel.verifyExecutionIntent({
    orderSizeSol: 0.5,
    currentPortfolioExposureSol: 2.0,
    quoteAgeMs: 120,
    slippageBps: 80,
    proofState: '3/3',
    hasFreezeAuthority: true, // Backdoor!
    hasPermanentDelegate: false,
    distanceToFailure: 0.8,
    systemIntegrityValid: true,
  });
  assert.equal(checkFreezeBlocked.passed, false);
  assert.ok(checkFreezeBlocked.violatedInvariants.includes('ACTIVE_FREEZE_AUTHORITY_PRESENT'));

  // Test Case 3: System integrity invalid -> Hard block
  const checkSystemBlocked = kernel.verifyExecutionIntent({
    orderSizeSol: 0.5,
    currentPortfolioExposureSol: 2.0,
    quoteAgeMs: 120,
    slippageBps: 80,
    proofState: '3/3',
    hasFreezeAuthority: false,
    hasPermanentDelegate: false,
    distanceToFailure: 0.8,
    systemIntegrityValid: false, // Infrastructure degraded
  });
  assert.equal(checkSystemBlocked.passed, false);
  assert.ok(checkSystemBlocked.violatedInvariants.includes('SYSTEM_INTEGRITY_CERTIFICATE_INVALID'));
});

test('Blueprint Phase 13 - Single-Use Execution Permit & TOCTOU Epoch Protection', () => {
  const permitEngine = new ExecutionPermitEngine();
  const mint = 'PermitToken1111111111111111111111111111111';

  // 1. Reserve risk
  const reservation = permitEngine.createRiskReservation(mint, 0.5);
  assert.equal(reservation.isCommitted, false);

  // 2. Issue permit bound to state epoch 5
  const permit = permitEngine.issuePermit({
    mint,
    decisionId: 'dec_001',
    policyHash: 'pol_hash_production',
    evidenceHash: 'evi_hash_evidence',
    snapshotSlot: 280_050,
    stateEpoch: 5,
    maxNotionalSol: 0.5,
    riskReservationId: reservation.reservationId,
  });
  assert.equal(permit.isConsumed, false);

  // 3. TOCTOU Stage 1: PREPARE
  const prep = permitEngine.prepareExecution(permit.permitId);
  assert.equal(prep.stage, 'PREPARE');

  // 4. TOCTOU Stage 2: REVALIDATE with same epoch -> VALID
  const revalPass = permitEngine.revalidateExecution(permit.permitId, 5, 80);
  assert.equal(revalPass.valid, true);
  assert.equal(revalPass.stage, 'REVALIDATE');

  // TOCTOU Check: If epoch changed to 6 while preparing -> ABORT
  const revalStale = permitEngine.revalidateExecution(permit.permitId, 6, 80);
  assert.equal(revalStale.valid, false);
  assert.equal(revalStale.stage, 'ABORTED');
  assert.ok(revalStale.reason?.includes('TOCTOU_EPOCH_MISMATCH'));

  // 5. TOCTOU Stage 3: COMMIT execution consumes permit once
  const commit = permitEngine.commitExecution(permit.permitId);
  assert.equal(commit.stage, 'COMMIT');
  assert.equal(permit.isConsumed, true);
  assert.equal(reservation.isCommitted, true);

  // Re-use of consumed permit must throw
  assert.throws(
    () => permitEngine.prepareExecution(permit.permitId),
    /already consumed/,
    'Permits must be strictly single-use'
  );
});
