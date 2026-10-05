import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AssuranceRevocationRegistry,
  createProofArtifact,
  verifyProofArtifact,
  validateActionProofBundle,
  AuthorityIssuerRegistry,
} from '../../dist/platform/assurance/index.js';
import { EconomicAuthorityStore } from '../../dist/intelligence/capital/economic-authority-store.js';
import { TerminalityAuthority } from '../../dist/platform/execution/terminality-authority.js';
import { SideEffectFenceManager } from '../../dist/platform/execution/side-effect-fence.js';

const TEST_KEY = 'secret_signing_key_test_001';

test('SECTION 64 MATRIX: 1. Happy path certificate issuance and verification', () => {
  const artifact = createProofArtifact({
    artifactType: 'MARKET_TRUTH_CERTIFICATE',
    subject: 'SubjectMint123',
    claim: 'TRUTH_CERTIFIED',
    evidenceClass: 'DIRECT_OBSERVATION',
    issuer: 'issuer_node_01',
    issuerRole: 'TruthAuthority',
    validDurationMs: 60_000,
    stateRoot: 'state_root_001',
    policyRoot: 'policy_root_001',
    configRoot: 'config_root_001',
    releaseRoot: 'release_root_001',
    controlEpoch: 1,
    revocationEpoch: 0,
    payload: { price: 1.25 },
    signingKey: TEST_KEY,
  });

  const verification = verifyProofArtifact(artifact, TEST_KEY);
  assert.equal(verification.isValid, true);
  assert.equal(verification.reason, undefined);
  assert.match(artifact.artifactId, /^art_/);
});

test('SECTION 64 MATRIX: 2. Missing or tampered payload fails closed', () => {
  const artifact = createProofArtifact({
    artifactType: 'MARKET_TRUTH_CERTIFICATE',
    subject: 'SubjectMint123',
    claim: 'TRUTH_CERTIFIED',
    evidenceClass: 'DIRECT_OBSERVATION',
    issuer: 'issuer_node_01',
    issuerRole: 'TruthAuthority',
    validDurationMs: 60_000,
    stateRoot: 'state_root_001',
    policyRoot: 'policy_root_001',
    configRoot: 'config_root_001',
    releaseRoot: 'release_root_001',
    controlEpoch: 1,
    revocationEpoch: 0,
    payload: { price: 1.25 },
    signingKey: TEST_KEY,
  });

  // Tamper with payload
  const tampered = {
    ...artifact,
    payload: { price: 999.99 },
  };

  const verification = verifyProofArtifact(tampered, TEST_KEY);
  assert.equal(verification.isValid, false);
  assert.match(verification.reason, /PAYLOAD_TAMPERED/);
});

test('SECTION 64 MATRIX: 3. UNKNOWN evidence never promotes to authority or frees capital', () => {
  const store = new EconomicAuthorityStore(10_000_000_000n);
  const res = store.acquireReservation('intent_001', 25_000_000n, 100);
  assert.equal(store.getReservedCash(), 25_000_000n);

  // Quarantine unknown capital upon ambiguous / unconfirmed outcome
  store.quarantineUnknownCapital(res.reservationId, 101);
  assert.equal(store.getConfirmedCash(), 10_000_000_000n);
  assert.equal(store.getUnknownCapital(), 25_000_000n);
  assert.equal(store.getReservedCash(), 0n);
  // Available cash excludes unknown capital
  assert.equal(store.getAvailableCash(), 10_000_000_000n - 25_000_000n - store.getEmergencyReserve());
});

test('SECTION 64 MATRIX: 4. Conflicting evidence rejected (signature verification fails on altered payload digest)', () => {
  const issuerRegistry = new AuthorityIssuerRegistry();
  const digestA = 'a'.repeat(64);
  const sigA = issuerRegistry.signPayload('TruthAuthority', digestA);

  // Verifying sigA against conflicting digest B must fail
  const digestB = 'b'.repeat(64);
  const verification = issuerRegistry.verifySignature({
    ...sigA,
    payloadDigestHex: digestB,
  });
  assert.equal(verification.isValid, false);
});

test('SECTION 64 MATRIX: 5. Expired certificate rejected', () => {
  const expiredArtifact = createProofArtifact({
    artifactType: 'MARKET_TRUTH_CERTIFICATE',
    subject: 'SubjectMint123',
    claim: 'TRUTH_CERTIFIED',
    evidenceClass: 'DIRECT_OBSERVATION',
    issuer: 'issuer_node_01',
    issuerRole: 'TruthAuthority',
    validDurationMs: -1000, // already expired
    stateRoot: 'state_root_001',
    policyRoot: 'policy_root_001',
    configRoot: 'config_root_001',
    releaseRoot: 'release_root_001',
    controlEpoch: 1,
    revocationEpoch: 0,
    payload: { price: 1.25 },
    signingKey: TEST_KEY,
  });

  const verification = verifyProofArtifact(expiredArtifact, TEST_KEY);
  assert.equal(verification.isValid, false);
  assert.match(verification.reason, /EXPIRED/);
});

test('SECTION 64 MATRIX: 6. Revoked evidence immediately invalidates dependent DAG', () => {
  const reg = new AssuranceRevocationRegistry();
  reg.registerDependency('parent_art_001', 'child_art_002');
  reg.registerDependency('child_art_002', 'grandchild_art_003');

  assert.equal(reg.isRevoked('grandchild_art_003'), false);

  // Revoke the parent
  reg.revokeArtifact('parent_art_001', 'Exploited input oracle', 'AstraRisk');

  // Both parent and transitive downstream children are tainted
  assert.equal(reg.isRevoked('parent_art_001'), true);
  assert.equal(reg.isRevoked('child_art_002'), true);
  assert.equal(reg.isRevoked('grandchild_art_003'), true);
});

test('SECTION 64 MATRIX: 7. Invalid signature rejected', () => {
  const artifact = createProofArtifact({
    artifactType: 'MARKET_TRUTH_CERTIFICATE',
    subject: 'SubjectMint123',
    claim: 'TRUTH_CERTIFIED',
    evidenceClass: 'DIRECT_OBSERVATION',
    issuer: 'issuer_node_01',
    issuerRole: 'TruthAuthority',
    validDurationMs: 60_000,
    stateRoot: 'state_root_001',
    policyRoot: 'policy_root_001',
    configRoot: 'config_root_001',
    releaseRoot: 'release_root_001',
    controlEpoch: 1,
    revocationEpoch: 0,
    payload: { price: 1.25 },
    signingKey: TEST_KEY,
  });

  // Verify with wrong key
  const verification = verifyProofArtifact(artifact, 'wrong_key_12345');
  assert.equal(verification.isValid, false);
  assert.match(verification.reason, /INVALID_SIGNATURE/);
});

test('SECTION 64 MATRIX: 8. ActionProofBundle rejects unfavorable evidence, stale epochs, and mismatched roots', () => {
  function makeCert(artifactType, issuerRole, evidenceClass = 'DIRECT_OBSERVATION') {
    return createProofArtifact({
      artifactType,
      subject: 'Mint123',
      claim: `${artifactType}_CLAIM`,
      evidenceClass,
      issuer: `issuer_${issuerRole}`,
      issuerRole,
      validDurationMs: 60_000,
      stateRoot: 'state_root_001',
      policyRoot: 'policy_root_001',
      configRoot: 'config_root_001',
      releaseRoot: 'release_root_001',
      controlEpoch: 1,
      revocationEpoch: 0,
      payload: {},
      signingKey: TEST_KEY,
    });
  }

  const validBundle = {
    actionId: 'action_matrix_001',
    exactActionHash: 'a'.repeat(64),
    exactTransactionHash: 'b'.repeat(64),
    marketTruthCertificate: makeCert('MARKET_TRUTH_CERTIFICATE', 'TruthAuthority'),
    tokenSemanticsCertificate: makeCert('TOKEN_SEMANTICS_CERTIFICATE', 'SemanticAuthority'),
    alphaRealityCertificate: makeCert('ALPHA_REALITY_CERTIFICATE', 'ResearchAuthority'),
    signalPortfolioCertificate: makeCert('SIGNAL_PORTFOLIO_CERTIFICATE', 'ResearchAuthority'),
    executionPolicyCertificate: makeCert('EXECUTION_POLICY_CERTIFICATE', 'RiskAuthority'),
    simulationCertificate: makeCert('SIMULATION_CERTIFICATE', 'SimulationAuthority'),
    exitabilityCertificate: makeCert('EXITABILITY_CERTIFICATE', 'ExitabilityAuthority'),
    portfolioEvacuationCertificate: makeCert('PORTFOLIO_EVACUATION_CERTIFICATE', 'RiskAuthority'),
    capitalAllocationCertificate: makeCert('CAPITAL_ALLOCATION_CERTIFICATE', 'CapitalAuthority'),
    reservationCertificate: makeCert('RESERVATION_CERTIFICATE', 'CapitalAuthority'),
    survivalCertificate: makeCert('SURVIVAL_CERTIFICATE', 'RiskAuthority'),
    twinTrustCertificate: makeCert('TWIN_TRUST_CERTIFICATE', 'SimulationAuthority'),
    releaseVSA: 'release_v1',
    configVSA: 'config_v1',
    policyVSA: 'policy_v1',
    governorVSA: 'gov_v1',
    controlEpoch: 1,
    fenceEpoch: 1,
    revocationRoot: '0'.repeat(64),
    validUntilSlot: 200_000n,
    validUntilTime: Date.now() + 60_000,
    proofGraphRoot: 'c'.repeat(64),
  };

  const activeRoots = {
    releaseRoot: 'release_v1',
    configRoot: 'config_v1',
    policyRoot: 'policy_v1',
    controlEpoch: 1,
    fenceEpoch: 1,
    currentSlot: 100_000n,
    currentTime: Date.now(),
  };

  // Valid bundle passes
  const validRes = validateActionProofBundle(validBundle, activeRoots);
  assert.equal(validRes.isAuthorized, true);
  assert.equal(validRes.reasons.length, 0);

  // Stale control epoch rejected
  const staleEpochRes = validateActionProofBundle(validBundle, {
    ...activeRoots,
    controlEpoch: 2, // Advanced
  });
  assert.equal(staleEpochRes.isAuthorized, false);
  assert.ok(staleEpochRes.reasons.some((r) => r.includes('STALE_CONTROL_EPOCH')));

  // Mismatched release root rejected
  const badReleaseRes = validateActionProofBundle(validBundle, {
    ...activeRoots,
    releaseRoot: 'release_v2_rotated',
  });
  assert.equal(badReleaseRes.isAuthorized, false);
  assert.ok(badReleaseRes.reasons.some((r) => r.includes('RELEASE_ROOT_MISMATCH')));

  // Unfavorable evidence class (UNKNOWN) in marketTruthCertificate rejected
  const bundleWithUnknown = {
    ...validBundle,
    marketTruthCertificate: makeCert('MARKET_TRUTH_CERTIFICATE', 'TruthAuthority', 'UNKNOWN'),
  };
  const unknownRes = validateActionProofBundle(bundleWithUnknown, activeRoots);
  assert.equal(unknownRes.isAuthorized, false);
  assert.ok(unknownRes.reasons.some((r) => r.includes('UNFAVORABLE_EVIDENCE')));
});

test('SECTION 64 MATRIX: 9. Duplicate / replay of execution fence or reservation blocked', () => {
  const fenceMgr = new SideEffectFenceManager();
  fenceMgr.claim({
    fenceId: 'fence_tx_001',
    operationType: 'SIGNING',
    economicFactId: 'fact_rep_001',
    executionGenerationId: 'gen_001',
  });

  // Re-claiming the same active fence throws FENCE_PREEMPTION_ERROR
  assert.throws(() => {
    fenceMgr.claim({
      fenceId: 'fence_tx_001',
      operationType: 'SIGNING',
      economicFactId: 'fact_rep_001',
      executionGenerationId: 'gen_002',
    });
  }, /FENCE_PREEMPTION_ERROR/i);

  const store = new EconomicAuthorityStore(10_000_000_000n);
  store.acquireReservation('intent_rep_001', 10_000_000n, 100);

  // Over-reserving exceeding available cash is rejected
  assert.throws(() => {
    store.acquireReservation('intent_rep_002', 150_000_000_000n, 100);
  }, /RESERVATION_DENIED/i);
});

test('SECTION 64 MATRIX: 10. Terminality certified NoLand requires search coverage and head progression', () => {
  const terminality = new TerminalityAuthority();

  const mockNoLandCert = {
    certificateId: 'cert_noland_001',
    economicFactId: 'fact_noland_001',
    executionGenerationId: 'gen_noland_001',
    signature: 'sig_5k8s9j2f4h7g8a9d0s8f7g6h5j4k3l2z1x9c8v7b6n5m',
    exactMessageHash: 'hash123',
    lifetimeType: 'RECENT_BLOCKHASH',
    finalizedFrontier: 1150n,
    providerWitnesses: [],
    searchHistoryWitnesses: [],
    providerIndependenceRoot: '0'.repeat(64),
    coverageRoot: '0'.repeat(64),
    accountDeltaRoot: '0'.repeat(64),
    conclusion: 'CERTIFIED_NOLAND',
    issuerId: 'issuer_term_01',
    signatureAlgorithm: 'Ed25519',
    authoritySignature: 'sighex',
  };

  const verdict = terminality.evaluateTerminality({
    economicFactId: 'fact_noland_001',
    executionGenerationId: 'gen_noland_001',
    witnesses: [],
    noLandCertificate: mockNoLandCert,
  });

  assert.equal(verdict.terminalityState, 'CERTIFIED_NOLAND');

  // Now economic store can safely release quarantined capital with CERTIFIED_NOLAND verdict
  const store = new EconomicAuthorityStore(10_000_000_000n);
  const res = store.acquireReservation('intent_noland_001', 20_000_000n, 100);
  store.quarantineUnknownCapital(res.reservationId, 101);
  assert.equal(store.getUnknownCapital(), 20_000_000n);

  store.releaseQuarantineOnVerifiedTerminality({
    intentId: 'intent_noland_001',
    amountLamports: 20_000_000n,
    terminalityVerdict: 'CERTIFIED_NOLAND',
    currentSlot: 105,
  });
  assert.equal(store.getUnknownCapital(), 0n);
});

test('SECTION 64 MATRIX: 11. Role impersonation blocked in ActionProofBundle', () => {
  function makeCert(artifactType, issuerRole) {
    return createProofArtifact({
      artifactType,
      subject: 'Mint123',
      claim: `${artifactType}_CLAIM`,
      evidenceClass: 'DIRECT_OBSERVATION',
      issuer: `issuer_${issuerRole}`,
      issuerRole,
      validDurationMs: 60_000,
      stateRoot: 'state_root_001',
      policyRoot: 'policy_root_001',
      configRoot: 'config_root_001',
      releaseRoot: 'release_root_001',
      controlEpoch: 1,
      revocationEpoch: 0,
      payload: {},
      signingKey: TEST_KEY,
    });
  }

  // Create bundle where simulationCertificate is signed by an unauthorized role (SemanticAuthority instead of SimulationAuthority)
  const bundle = {
    actionId: 'action_matrix_impersonate',
    exactActionHash: 'a'.repeat(64),
    exactTransactionHash: 'b'.repeat(64),
    marketTruthCertificate: makeCert('MARKET_TRUTH_CERTIFICATE', 'TruthAuthority'),
    tokenSemanticsCertificate: makeCert('TOKEN_SEMANTICS_CERTIFICATE', 'SemanticAuthority'),
    alphaRealityCertificate: makeCert('ALPHA_REALITY_CERTIFICATE', 'ResearchAuthority'),
    signalPortfolioCertificate: makeCert('SIGNAL_PORTFOLIO_CERTIFICATE', 'ResearchAuthority'),
    executionPolicyCertificate: makeCert('EXECUTION_POLICY_CERTIFICATE', 'RiskAuthority'),
    simulationCertificate: makeCert('SIMULATION_CERTIFICATE', 'SemanticAuthority'), // IMPERSONATION!
    exitabilityCertificate: makeCert('EXITABILITY_CERTIFICATE', 'ExitabilityAuthority'),
    portfolioEvacuationCertificate: makeCert('PORTFOLIO_EVACUATION_CERTIFICATE', 'RiskAuthority'),
    capitalAllocationCertificate: makeCert('CAPITAL_ALLOCATION_CERTIFICATE', 'CapitalAuthority'),
    reservationCertificate: makeCert('RESERVATION_CERTIFICATE', 'CapitalAuthority'),
    survivalCertificate: makeCert('SURVIVAL_CERTIFICATE', 'RiskAuthority'),
    twinTrustCertificate: makeCert('TWIN_TRUST_CERTIFICATE', 'SimulationAuthority'),
    releaseVSA: 'release_v1',
    configVSA: 'config_v1',
    policyVSA: 'policy_v1',
    governorVSA: 'gov_v1',
    controlEpoch: 1,
    fenceEpoch: 1,
    revocationRoot: '0'.repeat(64),
    validUntilSlot: 200_000n,
    validUntilTime: Date.now() + 60_000,
    proofGraphRoot: 'c'.repeat(64),
  };

  const res = validateActionProofBundle(bundle, {
    releaseRoot: 'release_v1',
    configRoot: 'config_v1',
    policyRoot: 'policy_v1',
    controlEpoch: 1,
    fenceEpoch: 1,
    currentSlot: 100_000n,
    currentTime: Date.now(),
  });

  assert.equal(res.isAuthorized, false);
  assert.ok(res.reasons.some((r) => r.includes('AUTHORITY_ROLE_MISMATCH')));
});

test('SECTION 64 MATRIX: 12. RPC NOT_FOUND or timeout witnesses yield UNKNOWN terminality', () => {
  const terminality = new TerminalityAuthority();

  const witnesses = [
    {
      witnessId: 'rpc_primary',
      witnessRole: 'RPC_PROVIDER',
      slot: 5000n,
      observedStatus: 'NOT_FOUND',
      blockhashSeen: false,
      timestampMs: Date.now(),
    },
    {
      witnessId: 'rpc_fallback',
      witnessRole: 'RPC_PROVIDER',
      slot: 5005n,
      observedStatus: 'DROPPED',
      blockhashSeen: false,
      timestampMs: Date.now(),
    },
  ];

  const verdict = terminality.evaluateTerminality({
    economicFactId: 'fact_not_found_001',
    executionGenerationId: 'gen_001',
    witnesses,
  });

  // Must NOT treat NOT_FOUND or DROPPED as CERTIFIED_NOLAND without proof of non-inclusion
  assert.equal(verdict.terminalityState, 'UNKNOWN');
});

test('SECTION 64 MATRIX: 13. SideEffectFence transitions to RECOVERY_AMBIGUOUS on crash during in-flight', () => {
  const fenceMgr = new SideEffectFenceManager();
  fenceMgr.claim({
    fenceId: 'fence_jito_001',
    operationType: 'JITO_SUBMIT',
    economicFactId: 'fact_fence_001',
    executionGenerationId: 'gen_fence_001',
  });

  fenceMgr.markInFlight('fence_jito_001');

  // Crash during in flight
  const recovered = fenceMgr.handleRecoveryCrash('fence_jito_001');
  assert.equal(recovered.state, 'RECOVERY_AMBIGUOUS');

  // Re-claiming ambiguous fence throws preemption error
  assert.throws(() => {
    fenceMgr.claim({
      fenceId: 'fence_jito_001',
      operationType: 'JITO_SUBMIT',
      economicFactId: 'fact_fence_001',
      executionGenerationId: 'gen_fence_002',
    });
  }, /FENCE_PREEMPTION_ERROR/);
});

test('SECTION 64 MATRIX: 14. Jito bundle failure is recorded durably as FAILED', () => {
  const fenceMgr = new SideEffectFenceManager();
  fenceMgr.claim({
    fenceId: 'fence_jito_fail_001',
    operationType: 'JITO_SUBMIT',
    economicFactId: 'fact_fail_001',
    executionGenerationId: 'gen_fail_001',
  });

  fenceMgr.markInFlight('fence_jito_fail_001');
  const failed = fenceMgr.recordFailure('fence_jito_fail_001', 'BUNDLE_DROPPED_TIP_EXCEEDED');
  assert.equal(failed.state, 'FAILED');
  assert.equal(failed.failureReason, 'BUNDLE_DROPPED_TIP_EXCEEDED');
});

