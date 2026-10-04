import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  hashCanonical,
  FusionPipeline,
  FusionJournal,
  CertificateChain,
  isValidTransition,
  isAuthorizedForState,
  assertIdentityInvariant,
  computeJournalEntryHash,
  computeCertificateHash,
} from '../../dist/platform/pipeline/index.js';

function createGenesisEnvelope(overrides = {}) {
  return {
    envelopeId: 'env_test_001',
    economicFactId: 'fact_test_001',
    traceId: 'trace_test_001',
    cluster: 'mainnet-beta',
    observedSlot: 1000n,
    bankFingerprint: 'bank_fingerprint_hash_abc123',
    observedAt: '2026-10-03T20:00:00.000Z',
    knownAt: '2026-10-03T20:00:00.000Z',
    evidenceRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    transportAttempts: [],
    certificateChain: [],
    state: 'OBSERVED',
    ...overrides,
  };
}

test('HASHING: canonicalJson and hashCanonical sort keys lexicographically and support BigInt', () => {
  const obj1 = { b: 2n, a: 1 };
  const obj2 = { a: 1, b: 2n };

  assert.equal(canonicalJson(obj1), canonicalJson(obj2));
  assert.equal(hashCanonical(obj1), hashCanonical(obj2));
  assert.equal(typeof hashCanonical(obj1), 'string');
  assert.equal(hashCanonical(obj1).length, 64);
});

test('IDENTITY: identity invariants strictly reject identity drift', () => {
  const base = createGenesisEnvelope();

  // Valid: no drift
  assert.doesNotThrow(() => {
    assertIdentityInvariant(base, { envelopeId: 'env_test_001' });
  });

  // Invalid: envelopeId drift
  assert.throws(() => {
    assertIdentityInvariant(base, { envelopeId: 'env_drifted' });
  }, /IDENTITY_DRIFT_ERROR/);

  // Invalid: economicFactId drift
  assert.throws(() => {
    assertIdentityInvariant(base, { economicFactId: 'fact_drifted' });
  }, /IDENTITY_DRIFT_ERROR/);

  // Invalid: traceId drift
  assert.throws(() => {
    assertIdentityInvariant(base, { traceId: 'trace_drifted' });
  }, /IDENTITY_DRIFT_ERROR/);
});

test('STATE MACHINE: legal transitions succeed while illegal transitions and skipping are rejected', () => {
  assert.equal(isValidTransition('OBSERVED', 'EVIDENCE_CERTIFIED'), true);
  assert.equal(isValidTransition('EVIDENCE_CERTIFIED', 'TEMPORALLY_VALID'), true);

  // Skipping state: OBSERVED -> CAPITAL_RESERVED
  assert.equal(isValidTransition('OBSERVED', 'CAPITAL_RESERVED'), false);

  // Backwards state: CAPITAL_RESERVED -> OBSERVED
  assert.equal(isValidTransition('CAPITAL_RESERVED', 'OBSERVED'), false);

  // EXPIRED_UNRESOLVED can transition to terminal outcomes
  assert.equal(isValidTransition('EXPIRED_UNRESOLVED', 'CERTIFIED_NOLAND'), true);
  assert.equal(isValidTransition('EXPIRED_UNRESOLVED', 'LANDED_SUCCESS'), true);

  // Terminal branch from LEARNING_READY has no successors
  assert.equal(isValidTransition('LEARNING_READY', 'OBSERVED'), false);
});

test('AUTHORITY: models cannot authorize, reserve, sign, or settle', async () => {
  // Static capability matrix tests
  assert.equal(isAuthorizedForState('INFER', 'EVIDENCE_CERTIFIED'), false);
  assert.equal(isAuthorizedForState('INFER', 'CAPITAL_RESERVED'), false);
  assert.equal(isAuthorizedForState('INFER', 'AUTHORIZED'), false);
  assert.equal(isAuthorizedForState('INFER', 'SIGNED'), false);
  assert.equal(isAuthorizedForState('RECOMMEND', 'AUTHORIZED'), false);
  assert.equal(isAuthorizedForState('RECOMMEND', 'CAPITAL_RESERVED'), false);
  assert.equal(isAuthorizedForState('RECOMMEND', 'SETTLED'), false);
  assert.equal(isAuthorizedForState('VETO', 'AUTHORIZED'), false);
  assert.equal(isAuthorizedForState('RESERVE', 'AUTHORIZED'), false);
  assert.equal(isAuthorizedForState('AUTHORIZE', 'AUTHORIZED'), true);
  assert.equal(isAuthorizedForState('SIGN', 'SIGNED'), true);
  assert.equal(isAuthorizedForState('SETTLE', 'SETTLED'), true);

  const env = createGenesisEnvelope();
  const pipeline = new FusionPipeline(env);

  // INFER cannot transition to EVIDENCE_CERTIFIED
  await assert.rejects(
    pipeline.transition({
      targetState: 'EVIDENCE_CERTIFIED',
      authority: 'INFER',
      envelopePatch: {
        coverageCertificate: 'cert_cov_001',
        evidenceRoot: '0000000000000000000000000000000000000000000000000000000000000001',
      },
    }),
    /AUTHORITY_VIOLATION/,
  );
});

test('EVIDENCE DEFICIT: missing evidence blocks transition fail-closed', async () => {
  const env = createGenesisEnvelope();
  const pipeline = new FusionPipeline(env);

  // Missing coverageCertificate when advancing to EVIDENCE_CERTIFIED
  await assert.rejects(
    pipeline.transition({
      targetState: 'EVIDENCE_CERTIFIED',
      authority: 'OBSERVE',
      envelopePatch: { coverageCertificate: '' },
    }),
    /EVIDENCE_DEFICIT/,
  );

  // Advance legally to EVIDENCE_CERTIFIED
  await pipeline.transition({
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cert_cov_ok',
      evidenceRoot: '0000000000000000000000000000000000000000000000000000000000000002',
    },
  });

  // Attempt to transition to TEMPORALLY_VALID without bankFingerprint
  await assert.rejects(
    pipeline.transition({
      targetState: 'TEMPORALLY_VALID',
      authority: 'OBSERVE',
      envelopePatch: { bankFingerprint: '' },
    }),
    /EVIDENCE_DEFICIT/,
  );
});

test('JOURNAL & CERTIFICATES: end-to-end full lifecycle transition with cryptographic verification', async () => {
  const env = createGenesisEnvelope();
  const pipeline = new FusionPipeline(env);

  // 1. EVIDENCE_CERTIFIED
  await pipeline.transition({
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cert_cov_001',
      evidenceRoot: 'root_ev_001',
    },
  });

  // 2. TEMPORALLY_VALID
  await pipeline.transition({
    targetState: 'TEMPORALLY_VALID',
    authority: 'OBSERVE',
    envelopePatch: {
      observedSlot: 1001n,
      bankFingerprint: 'bank_fp_1001',
    },
  });

  // 3. SEMANTICALLY_RESOLVED
  await pipeline.transition({
    targetState: 'SEMANTICALLY_RESOLVED',
    authority: 'OBSERVE',
    envelopePatch: {
      semanticStateRoot: 'sem_root_001',
    },
  });

  // 4. AUTHENTICATED_MARKET
  await pipeline.transition({
    targetState: 'AUTHENTICATED_MARKET',
    authority: 'OBSERVE',
    envelopePatch: {
      authenticityRoot: 'auth_root_001',
    },
  });

  // 5. FEATURED
  await pipeline.transition({
    targetState: 'FEATURED',
    authority: 'OBSERVE',
    envelopePatch: {
      featureSnapshotRoot: 'feat_root_001',
    },
  });

  // 6. HYPOTHESIS_READY
  await pipeline.transition({
    targetState: 'HYPOTHESIS_READY',
    authority: 'INFER',
    envelopePatch: {
      hypothesisRoot: 'hypo_root_001',
    },
  });

  // 7. DECIDED
  await pipeline.transition({
    targetState: 'DECIDED',
    authority: 'RECOMMEND',
    envelopePatch: {
      decisionAt: '2026-10-03T20:00:01.000Z',
      predictedEdgeLamports: 150_000n,
    },
  });

  // 8. RISK_APPROVED
  await pipeline.transition({
    targetState: 'RISK_APPROVED',
    authority: 'VETO',
    envelopePatch: {
      portfolioRiskRoot: 'risk_root_001',
    },
  });

  // 9. RESOURCE_ADMITTED
  await pipeline.transition({
    targetState: 'RESOURCE_ADMITTED',
    authority: 'RESERVE',
    envelopePatch: {
      safetyCapacityRoot: 'safety_root_001',
      resourceReservationId: 'res_rec_001',
    },
  });

  // 10. CAPITAL_RESERVED
  await pipeline.transition({
    targetState: 'CAPITAL_RESERVED',
    authority: 'RESERVE',
    envelopePatch: {
      capitalStateRoot: 'cap_state_root_001',
      capitalReservationId: 'cap_res_001',
    },
    economicJournalRoot: 'econ_root_001',
  });

  // 11. AUTHORIZED
  await pipeline.transition({
    targetState: 'AUTHORIZED',
    authority: 'AUTHORIZE',
    envelopePatch: {
      executionPermitId: 'permit_001',
    },
  });

  // 12. TRANSACTION_VERIFIED
  await pipeline.transition({
    targetState: 'TRANSACTION_VERIFIED',
    authority: 'AUTHORIZE',
    envelopePatch: {
      effectSpecHash: 'effect_spec_hash_001',
      messageHash: 'msg_hash_001',
    },
  });

  // 13. PROOF_READY
  await pipeline.transition({
    targetState: 'PROOF_READY',
    authority: 'AUTHORIZE',
    envelopePatch: {},
  });

  // 14. SIGNED
  await pipeline.transition({
    targetState: 'SIGNED',
    authority: 'SIGN',
    envelopePatch: {
      transactionSignature: '5M78...signature',
    },
  });

  // 15. SUBMITTED
  await pipeline.transition({
    targetState: 'SUBMITTED',
    authority: 'AUTHORIZE',
    envelopePatch: {
      transportAttempts: [
        {
          transport: 'JITO_BUNDLE',
          attemptedAt: '2026-10-03T20:00:02.000Z',
          status: 'ACCEPTED',
          bundleId: 'bundle_001',
        },
      ],
    },
  });

  // 16. OUTCOME_PENDING
  await pipeline.transition({
    targetState: 'OUTCOME_PENDING',
    authority: 'OBSERVE',
    envelopePatch: {},
  });

  // 17. LANDED_SUCCESS
  await pipeline.transition({
    targetState: 'LANDED_SUCCESS',
    authority: 'OBSERVE',
    envelopePatch: {
      chainOutcome: {
        outcome: 'LANDED_SUCCESS',
        slot: 1005n,
        signature: '5M78...signature',
        reconciledAt: '2026-10-03T20:00:03.000Z',
      },
    },
  });

  // 18. ECONOMIC_RECONCILED
  await pipeline.transition({
    targetState: 'ECONOMIC_RECONCILED',
    authority: 'SETTLE',
    envelopePatch: {
      economicOutcome: {
        deltaCashLamports: -50_000_000n,
        deltaTokensRaw: 10_000_000n,
        mint: 'TokenMintAddress',
        feeLamports: 5000n,
        tipLamports: 100_000n,
        rentLamports: 2_039_280n,
        reconciledAt: '2026-10-03T20:00:04.000Z',
        economicJournalRoot: 'econ_journal_root_settled',
      },
    },
  });

  // 19. SETTLED
  await pipeline.transition({
    targetState: 'SETTLED',
    authority: 'SETTLE',
    envelopePatch: {},
  });

  // 20. OUTCOME_MATURE
  await pipeline.transition({
    targetState: 'OUTCOME_MATURE',
    authority: 'OBSERVE',
    envelopePatch: {},
  });

  // 21. LEARNING_READY
  await pipeline.transition({
    targetState: 'LEARNING_READY',
    authority: 'OBSERVE',
    envelopePatch: {},
  });

  // Verify end-to-end pipeline integrity
  const verification = pipeline.verify();
  assert.equal(verification.valid, true);

  const snapshot = pipeline.snapshot();
  assert.equal(snapshot.state, 'LEARNING_READY');
  assert.equal(snapshot.revision, 21n);
  assert.equal(pipeline.getJournal().length(), 22); // genesis + 21 transitions
  assert.equal(pipeline.getCertificateChain().count(), 21);
});

test('JOURNAL & CERTIFICATE TAMPERING: modifying any entry fails verification', () => {
  const journal = new FusionJournal();
  journal.append({
    journalEntryId: 'entry_1',
    envelopeId: 'env_1',
    economicFactId: 'fact_1',
    fromState: 'OBSERVED',
    toState: 'EVIDENCE_CERTIFIED',
    previousStateRoot: '0000',
    nextStateRoot: '1111',
    envelopeRoot: 'env_root_1',
    certificateHash: 'cert_1',
    observedAt: '2026-10-03T20:00:00.000Z',
  });

  assert.equal(journal.verify().valid, true);

  // Tamper with entry in internal array
  const entries = journal.all();
  journal['entries'][0] = Object.freeze({
    ...entries[0],
    envelopeRoot: 'tampered_root',
  });
  const check = journal.verify();
  assert.equal(check.valid, false);
  assert.match(check.error, /TAMPER_DETECTED/);

  // Certificate chain tampering
  const chain = new CertificateChain();
  chain.append({
    certificateId: 'cert_1',
    kind: 'TRANSITION',
    authority: 'OBSERVE',
    envelopeId: 'env_1',
    economicFactId: 'fact_1',
    fromState: 'OBSERVED',
    toState: 'EVIDENCE_CERTIFIED',
    envelopeRoot: 'root_1',
    previousStateRoot: '0000',
    nextStateRoot: '1111',
    evidenceRoot: 'ev_1',
    issuedAt: '2026-10-03T20:00:00.000Z',
  });
  assert.equal(chain.verify().valid, true);
  chain['certificates'][0] = Object.freeze({
    ...chain.all()[0],
    envelopeRoot: 'tampered_cert_root',
  });
  const certCheck = chain.verify();
  assert.equal(certCheck.valid, false);
  assert.match(certCheck.error, /TAMPER_DETECTED/);
});

test('REPLAY DETERMINISM: replaying the same sequence produces identical state roots', async () => {
  const env1 = createGenesisEnvelope();
  const pipeline1 = new FusionPipeline(env1);

  const env2 = createGenesisEnvelope();
  const pipeline2 = new FusionPipeline(env2);

  const transitionParams = {
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cert_cov_fixed',
      evidenceRoot: 'ev_root_fixed',
    },
    observedAt: '2026-10-03T20:00:00.000Z',
  };

  const res1 = await pipeline1.transition(transitionParams);
  const res2 = await pipeline2.transition(transitionParams);

  assert.equal(res1.state.stateRoot, res2.state.stateRoot);
  assert.equal(res1.certificate.certificateHash, res2.certificate.certificateHash);
  assert.equal(res1.journalEntry.entryHash, res2.journalEntry.entryHash);
});
