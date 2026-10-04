import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AdversarialEvidenceCouncil,
  ResourceAdmissionController,
} from '../../dist/platform/pipeline/index.js';

function createValidProverEvidence(overrides = {}) {
  return {
    opportunityId: 'opp_valid_001',
    tokenMint: '9dSMwFfPezQ8WPcW1uZV7ns4rcviEj2LssSAg75WBLXd',
    observedSlot: 1000n,
    quotePriceLamports: 1500000n,
    liquidityLamports: 50000000000n,
    authenticityScore: 92,
    temporalValidityVerified: true,
    evidenceHash: '0000000000000000000000000000000000000000000000000000000000000001',
    ...overrides,
  };
}

test('COUNCIL: Prover evidence with all Skeptic checks passed produces SUFFICIENT approved verdict', () => {
  const council = new AdversarialEvidenceCouncil();
  const prover = createValidProverEvidence();
  const skepticChecks = [
    { checkName: 'CREATOR_CONCENTRATION', passed: true, severity: 'FATAL_VETO' },
    { checkName: 'TRANSFER_HOOK_WHITELIST', passed: true, severity: 'FATAL_VETO' },
    { checkName: 'PRICE_DRIFT_TOLERANCE', passed: true, severity: 'HIGH_UNCERTAINTY' },
  ];

  const verdict = council.evaluateDialectic(
    'fact_test_001',
    prover,
    skepticChecks,
    '2026-10-03T20:00:00.000Z'
  );

  assert.equal(verdict.status, 'SUFFICIENT');
  assert.equal(verdict.approved, true);
  assert.equal(verdict.rejectionReasons.length, 0);
  assert.equal(typeof verdict.councilVerdictHash, 'string');
  assert.equal(verdict.councilVerdictHash.length, 64);
});

test('COUNCIL: Skeptic fatal veto forces CONTRADICTORY status and blocks approval', () => {
  const council = new AdversarialEvidenceCouncil();
  const prover = createValidProverEvidence();
  const skepticChecks = [
    {
      checkName: 'TRANSFER_HOOK_WHITELIST',
      passed: false,
      severity: 'FATAL_VETO',
      reason: 'Unknown external CPI hook detected',
    },
    { checkName: 'CREATOR_CONCENTRATION', passed: true, severity: 'FATAL_VETO' },
  ];

  const verdict = council.evaluateDialectic(
    'fact_test_002',
    prover,
    skepticChecks,
    '2026-10-03T20:00:00.000Z'
  );

  assert.equal(verdict.status, 'CONTRADICTORY');
  assert.equal(verdict.approved, false);
  assert.ok(verdict.rejectionReasons.some((r) => r.includes('SKEPTIC_FATAL_VETO')));
});

test('COUNCIL: Missing or invalid Prover evidence results in INSUFFICIENT status', () => {
  const council = new AdversarialEvidenceCouncil();
  const prover = createValidProverEvidence({
    temporalValidityVerified: false, // Deficit!
  });
  const skepticChecks = [
    { checkName: 'TRANSFER_HOOK_WHITELIST', passed: true, severity: 'FATAL_VETO' },
  ];

  const verdict = council.evaluateDialectic(
    'fact_test_003',
    prover,
    skepticChecks,
    '2026-10-03T20:00:00.000Z'
  );

  assert.equal(verdict.status, 'INSUFFICIENT');
  assert.equal(verdict.approved, false);
  assert.ok(verdict.rejectionReasons.some((r) => r.includes('PROVER_EVIDENCE_DEFICIT')));
});

test('RESOURCE ADMISSION: admits workload when system capacity is healthy', () => {
  const controller = new ResourceAdmissionController(5, 20);
  const capacity = {
    rpcCapacityAvailablePct: 80,
    archiveQuorumAvailable: true,
    streamFeedHealthy: true,
    verificationQueueDepth: 2,
    activeUnresolvedLiabilities: 0,
    memoryPressurePct: 45,
  };

  const permit = controller.admitWorkload('fact_admit_001', capacity, '2026-10-03T20:00:00.000Z');

  assert.equal(permit.admitted, true);
  assert.ok(permit.resourceReservationId.startsWith('res_'));
  assert.ok(permit.economicWorkPermitId.startsWith('work_'));
  assert.equal(permit.safetyCapacityRoot.length, 64);
});

test('RESOURCE ADMISSION: deduplicates workload for identical economicFactId', () => {
  const controller = new ResourceAdmissionController(5, 20);
  const capacity = {
    rpcCapacityAvailablePct: 80,
    archiveQuorumAvailable: true,
    streamFeedHealthy: true,
    verificationQueueDepth: 2,
    activeUnresolvedLiabilities: 0,
    memoryPressurePct: 45,
  };

  const permit1 = controller.admitWorkload('fact_dedup_001', capacity, '2026-10-03T20:00:00.000Z');
  const permit2 = controller.admitWorkload('fact_dedup_001', capacity, '2026-10-03T20:00:01.000Z');

  assert.equal(permit1.resourceReservationId, permit2.resourceReservationId);
  assert.equal(permit1.economicWorkPermitId, permit2.economicWorkPermitId);
});

test('RESOURCE ADMISSION: rejects workload when active liabilities reach ceiling', () => {
  const controller = new ResourceAdmissionController(2, 20);
  const capacity = {
    rpcCapacityAvailablePct: 80,
    archiveQuorumAvailable: true,
    streamFeedHealthy: true,
    verificationQueueDepth: 2,
    activeUnresolvedLiabilities: 2, // At ceiling!
    memoryPressurePct: 45,
  };

  const permit = controller.admitWorkload('fact_ceiling_001', capacity, '2026-10-03T20:00:00.000Z');

  assert.equal(permit.admitted, false);
  assert.equal(permit.denialReason, 'ACTIVE_LIABILITIES_AT_CEILING');
});
