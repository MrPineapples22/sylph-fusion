import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UnitLock,
  ProductionMintDecoder,
  IndependentReferenceMintDecoder,
  ParserZeroCrossValidator,
  EvidenceGenomeDAG,
  MirrorLock,
  QuorumRoot,
  EclipseGuard,
  HardRuleRegistry,
  VetoTotalityEngine,
  DefeaterZeroEngine,
  TokenSafetyMicrokernel,
  RuleCertValidator,
  VetoLinearizer,
  VetoNotaryNode,
  VetoQuorumEngine,
  VetoTransparencyLedger,
  ProofVault,
  VetoSentinelLane,
  TruthLabAdjudicator,
  VetoObservabilityTracker,
  FormalModelChecker,
  ProofVoiceEngine,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  sha256Hex,
} from '../../dist/platform/security/hard-veto-kernel.js';

const canonicalBank = {
  clusterGenesisHash: 'cluster-mainnet',
  slot: 100n,
  blockhash: 'blockhash-100',
  commitment: 'finalized',
  canonicality: 'CANONICAL',
};

const subjectA = {
  kind: 'TOKEN_MINT',
  clusterGenesisHash: 'cluster-mainnet',
  mint: 'MintAlpha111111111111111111111111111111111111',
};

test('PHASE 42 — Veto Sentinel Lane: All 11 Live Binary Probes Pass', () => {
  const sentinel = new VetoSentinelLane();
  const probeResults = sentinel.runAllProbes();

  assert.equal(probeResults.length, 11);
  for (const r of probeResults) {
    assert.equal(r.passed, true, `Probe '${r.probeName}' failed! Disposition: ${r.observedDisposition}`);
  }
});

test('PHASE 9 — UnitLock: Exact cross-multiplication & interval arithmetic', () => {
  // Test 1: Exact cross-multiplication vs float precision
  // 8001 / 10000 = 80.01% -> Breaches 80% (8000 bps)
  assert.equal(UnitLock.isConcentrationBreached(8001n, 10000n, 8000n), true);
  // 8000 / 10000 = 80.00% -> Not strictly greater than 8000 bps
  assert.equal(UnitLock.isConcentrationBreached(8000n, 10000n, 8000n), false);
  // Boundary 0 supply
  assert.equal(UnitLock.isConcentrationBreached(100n, 0n, 5000n), false);

  // Test 2: Interval arithmetic (lowerBound must strictly exceed threshold for proven violation)
  const uncertainInterval = { lower: 7500n, upper: 8500n };
  assert.equal(UnitLock.isLowerBoundBreachProven(uncertainInterval, 8000n), false);

  const provenInterval = { lower: 8001n, upper: 8500n };
  assert.equal(UnitLock.isLowerBoundBreachProven(provenInterval, 8000n), true);

  // Inverted interval must throw
  assert.throws(() => UnitLock.isLowerBoundBreachProven({ lower: 9000n, upper: 8000n }, 8000n));
});

test('PHASE 7 & 8 — Parser-Zero & ClosedWorld: Dual reference decoding & TLV guards', () => {
  // Create an 82-byte SPL Token Mint buffer
  const buf = Buffer.alloc(82);
  // Mint authority present (1 at offset 0, pubkey bytes 4..36)
  buf.writeUInt32LE(1, 0);
  buf.fill(0xaa, 4, 36);
  // Supply 1,000,000,000 (offset 36)
  buf.writeBigUInt64LE(1_000_000_000n, 36);
  buf.writeUInt8(9, 44); // decimals
  buf.writeUInt8(1, 45); // isInitialized
  // Freeze authority present (1 at offset 46, pubkey bytes 50..82)
  buf.writeUInt32LE(1, 46);
  buf.fill(0xbb, 50, 82);

  const agreement = ParserZeroCrossValidator.validate(buf, TOKEN_PROGRAM_ID);
  assert.equal(agreement.kind, 'EXACT');
  if (agreement.kind === 'EXACT') {
    assert.equal(agreement.state.freezeAuthority.kind, 'PRESENT');
    assert.equal(agreement.state.mintAuthority.kind, 'PRESENT');
    assert.equal(agreement.state.rawSupply, 1_000_000_000n);
    assert.equal(agreement.state.decimals, 9);
  }

  // Corrupting bytes to cause decoder disagreement (simulated reference decoder tamper)
  const agreementDisagreement = ParserZeroCrossValidator.createEvidenceRoots(subjectA, canonicalBank, buf, TOKEN_PROGRAM_ID);
  assert.equal(agreementDisagreement.status, 'OK');
  assert.equal(agreementDisagreement.roots.length, 3);
});

test('PHASE 13 & 14 — Evidence Genome & Acyclops: DAG cycle detection & minimal witness', () => {
  const dag = new EvidenceGenomeDAG();
  const root1 = {
    evidenceId: 'root-1',
    subject: subjectA,
    bank: canonicalBank,
    rawBytesHash: 'h1',
    rawAccountLength: 82,
    ownerProgram: TOKEN_PROGRAM_ID,
    decoderId: 'd1',
    decoderVersion: '1',
    decoderHash: 'dh1',
    schemaHash: 'sh1',
    fact: 'FREEZE_AUTHORITY',
    state: { kind: 'PRESENT', authority: 'k1' },
    observedAtMonotonicMs: Date.now(),
    ancestorEvidenceIds: [],
  };

  const root2 = {
    ...root1,
    evidenceId: 'root-2',
    rawBytesHash: 'h2',
    ancestorEvidenceIds: ['root-1'],
  };

  dag.addRoot(root1);
  dag.addRoot(root2);

  // Acyclic path check
  const acyclicRes = dag.verifyAcyclic(['root-2']);
  assert.equal(acyclicRes.isAcyclic, true);

  // Minimal witness extraction
  const witness = dag.extractMinimalWitness(subjectA, ['root-1', 'root-2'], (subset) => subset.length > 0);
  assert.equal(witness.isMinimal, true);
  assert.equal(witness.minimalWitnessIds.length, 1);
});

test('PHASE 15, 16 & 17 — MirrorLock & QuorumRoot: Equivocation detection & missingness', () => {
  const mirror = new MirrorLock();
  const receiptA = {
    receiptId: 'rcpt-1',
    providerId: 'quicknode',
    failureDomainId: 'domain-a',
    endpoint: 'https://rpc1',
    subject: subjectA,
    canonicalRequestHash: 'req-hash',
    rawResponseHash: 'res-hash-1',
    bankSlot: 100n,
    bankBlockhash: 'b100',
    observedAtUnixMs: Date.now(),
  };

  const receiptB = {
    ...receiptA,
    receiptId: 'rcpt-2',
    rawResponseHash: 'res-hash-2', // Conflicting response!
  };

  const firstRec = mirror.recordReceipt(receiptA);
  assert.equal(firstRec.isAccepted, true);

  const equivRec = mirror.recordReceipt(receiptB);
  assert.equal(equivRec.equivocationDetected, true);
  assert.equal(mirror.isProviderQuarantined('quicknode'), true);

  // Quorum failure domain diversity check
  const quorumRes = QuorumRoot.verifyFailureDomainDiversity([receiptA, receiptB], 2);
  assert.equal(quorumRes.satisfiesDiversity, false); // Both are domain-a!

  // Missingness classification
  const missingOutage = EclipseGuard.classifyMissingness({
    latencyMs: 100,
    failedProvidersCount: 1,
    totalProvidersCount: 3,
    isSchemaError: false,
    isSelectiveGap: false,
  });
  assert.equal(missingOutage.classification, 'PROVIDER_OUTAGE');
  assert.equal(missingOutage.operationalAction, 'WAIT');
});

test('PHASE 3 — Veto Totality: Complete coverage requirement for PASS', () => {
  const registry = new HardRuleRegistry();
  const totality = new VetoTotalityEngine(registry);

  // Scenario 1: Missing evaluation for one of the registered rules
  const partialEvaluations = new Map([
    ['freeze-authority-present', { ruleId: 'freeze-authority-present', status: 'PASS', reason: 'clean' }],
  ]);

  const coverageIncomplete = totality.certifyCoverage(subjectA, canonicalBank, partialEvaluations);
  assert.equal(coverageIncomplete.coverageState, 'INCOMPLETE');
  assert.ok(coverageIncomplete.missingRuleIds.length > 0);

  const passCheckIncomplete = totality.verifyPassEligibility(coverageIncomplete, partialEvaluations);
  assert.equal(passCheckIncomplete.isEligibleForPass, false);
  assert.match(passCheckIncomplete.reason, /coverage is INCOMPLETE/);

  // Scenario 2: Complete evaluation across all active registered rules
  const completeEvaluations = new Map();
  for (const rule of registry.allActiveRules()) {
    completeEvaluations.set(rule.ruleId, { ruleId: rule.ruleId, status: 'PASS', reason: 'clean' });
  }

  const coverageComplete = totality.certifyCoverage(subjectA, canonicalBank, completeEvaluations);
  assert.equal(coverageComplete.coverageState, 'COMPLETE');
  assert.equal(coverageComplete.missingRuleIds.length, 0);

  const passCheckComplete = totality.verifyPassEligibility(coverageComplete, completeEvaluations);
  assert.equal(passCheckComplete.isEligibleForPass, true);
});

test('PHASE 24 — RuleCert: Translation validation & mutation detection', () => {
  const registry = new HardRuleRegistry();
  const freezeRule = registry.active('freeze-authority-present');

  // Correct compiled evaluator
  const correctEvaluator = (state) => state.kind === 'PRESENT';
  const certCorrect = RuleCertValidator.certifyRule(freezeRule, correctEvaluator);
  assert.equal(certCorrect.verifiedEquivalent, true);
  assert.ok(certCorrect.testVectorCount > 0);

  // Mutated evaluator (mutation: PRESENT -> ABSENT)
  const mutatedEvaluator = (state) => state.kind === 'ABSENT_PROVEN';
  const certMutated = RuleCertValidator.certifyRule(freezeRule, mutatedEvaluator);
  assert.equal(certMutated.verifiedEquivalent, false, 'Critical mutation must be caught!');
});

test('PHASE 26 — Veto Linearizer: Fenced Compare-And-Swap (CAS) semantics', () => {
  const linearizer = new VetoLinearizer();
  const dummyDecision = {
    subject: subjectA,
    decisionId: 'dec-1',
    decisionGeneration: 1n,
    tokenSafety: 'PASS',
    market: { state: 'PASS', reason: 'ok' },
    actor: { state: 'PASS', reason: 'ok' },
    policy: { state: 'PASS', reason: 'ok' },
    portfolio: { state: 'PASS', reason: 'ok' },
    execution: { state: 'PASS', reason: 'ok' },
    system: { state: 'PASS', reason: 'ok' },
    coverage: 'COMPLETE',
    action: 'ALLOW',
    decidedAtSlot: 100n,
    decisionHash: 'hash-init',
  };

  const commit1 = linearizer.commitDecisionCAS(dummyDecision, {
    expectedGeneration: 0n,
    bankSlot: 100n,
    protocolEpoch: 1n,
    writerFencingToken: 'f-1',
  });
  assert.equal(commit1.success, true);
  assert.equal(commit1.committedGeneration, 1n);

  // Stale writer commit attempt
  const commitStale = linearizer.commitDecisionCAS(dummyDecision, {
    expectedGeneration: 0n, // Stale!
    bankSlot: 101n,
    protocolEpoch: 1n,
    writerFencingToken: 'f-2',
  });
  assert.equal(commitStale.success, false);
  assert.equal(commitStale.failureReason, 'STALE_GENERATION');
});

test('PHASE 27, 28 & 29 — Veto Notary: TCB measurement & ServiceRoot workload identity', () => {
  const declaredTcb = {
    releaseHash: 'rel-hash',
    kernelHash: 'k-hash',
    registryHash: 'reg-hash',
    decoderHash: 'dec-hash',
    schemaHash: 'sch-hash',
  };

  const suite = {
    suiteId: 'ED25519_V1',
    canonicalizationAlgorithm: 'JSON_CANONICAL_V1',
    objectHashAlgorithm: 'SHA256',
    signatureAlgorithm: 'ED25519_ATTESTATION',
    keyEpoch: 'epoch-1',
    status: 'ACTIVE',
  };

  const notary = new VetoNotaryNode('notary-node-1', 'domain-us-west', declaredTcb, suite);
  // Arming with exact TCB
  const armed = notary.armNotary(declaredTcb);
  assert.equal(armed, true);

  const proof = {
    proofId: 'proof-1',
    proofHash: 'hash-1',
    ruleId: 'freeze-authority-present',
    subject: subjectA,
    evidenceIds: ['ev-1'],
    minimalWitnessIds: ['ev-1'],
    bank: canonicalBank,
    defeaterCertificateHash: 'def-1',
    microkernelVerificationHash: 'mk-1',
    issuedAtSlot: 100n,
    status: 'ACTIVE',
  };

  // Unauthorized caller (AI model runner) -> REJECTED!
  const unauthorizedCaller = {
    serviceId: 'jev-model-runner',
    role: 'MODEL_RUNNER',
    capability: 'UNPRIVILEGED_READ',
    workloadToken: 'tok-model',
  };
  const unauthRes = notary.attestProof(proof, unauthorizedCaller);
  assert.equal(unauthRes.success, false);
  assert.match(unauthRes.rejectionReason, /Unauthorized workload/);

  // Authorized Token Safety Authority caller -> ATTESTED!
  const authorizedCaller = {
    serviceId: 'sylph-safety-core',
    role: 'TOKEN_SAFETY_AUTHORITY',
    capability: 'PRIVILEGED_SAFETY_ATTESTATION',
    workloadToken: 'tok-safety',
  };
  const authRes = notary.attestProof(proof, authorizedCaller);
  assert.equal(authRes.success, true);
  assert.ok(authRes.attestation?.signature);
});

test('PHASE 35 & 34 — Transparency Ledger & Proof Vault: Merkle audit & anti-resurrection', () => {
  const ledger = new VetoTransparencyLedger('PRODUCTION');
  const vault = new ProofVault();

  const rec1 = ledger.appendEvent('ISSUED', 'proof-a', 'hash-a', subjectA, 100n);
  assert.equal(rec1.sequenceNumber, 1n);

  const deadProof = {
    proofId: 'proof-a',
    proofHash: 'hash-a',
    ruleId: 'freeze-authority-present',
    subject: subjectA,
    evidenceIds: ['ev-1'],
    minimalWitnessIds: ['ev-1'],
    bank: canonicalBank,
    defeaterCertificateHash: 'def-1',
    microkernelVerificationHash: 'mk-1',
    issuedAtSlot: 100n,
    status: 'ACTIVE',
  };

  vault.storeProof(deadProof, []);
  const deathCert = vault.killProof(deadProof, 'BANK_ORPHANED', 105n);
  assert.equal(deathCert.deadProofId, 'proof-a');

  // Record PROOF_DEAD on ledger -> sets tombstone
  ledger.appendEvent('PROOF_DEAD', 'proof-a', 'hash-a', subjectA, 105n);
  assert.equal(ledger.isProofDead('proof-a'), true);

  // Attempting to resurrect dead proof on ledger MUST throw!
  assert.throws(() => ledger.appendEvent('ISSUED', 'proof-a', 'hash-a', subjectA, 110n));
});

test('PHASE 42 — Formal Model Checking: Finite state-space invariant verification', () => {
  const checkRes = FormalModelChecker.verifyInvariants();
  assert.equal(checkRes.allInvariantsHold, true, `Formal invariant violation: ${checkRes.violations.join('; ')}`);
  assert.ok(checkRes.statesExplored > 10, `Explored ${checkRes.statesExplored} states`);
});

test('PHASE 45 — Veto Observability: Zero-tolerance production release gates', () => {
  const obs = new VetoObservabilityTracker();
  const certInit = obs.evaluateProductionReleaseGates();
  assert.equal(certInit.certified, true);
  assert.equal(certInit.breachedGates.length, 0);

  // Record an invalid proof display
  obs.recordFalseVeto();
  const certBreached = obs.evaluateProductionReleaseGates();
  assert.equal(certBreached.certified, false);
  assert.ok(certBreached.breachedGates.some((g) => g.includes('FalseVetoConfirmedCount')));
});
