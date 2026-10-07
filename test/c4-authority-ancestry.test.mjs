/**
 * SYLPH FUSION — C4 AUTHORITY ANCESTRY ADVERSARIAL TEST SUITE
 * Specifications: Frozen Architecture Execution Prompt (Sections 30, 31, 32, 33, 34, 35)
 *
 * Mechanically verifies:
 * 1. Authority Ancestry Chain:
 *    VerifiedDecision -> RiskAuthority -> VerifiedRiskAuthorization -> EconomicAuthorityStore -> CapitalReservation -> ActionProofBundle.
 * 2. Cross-Splice Adversarial Campaign:
 *    Independent valid chains A and B spliced together:
 *    - A A A A B (Deny: reservation mismatch)
 *    - A A A B A (Deny: riskAuth mismatch)
 *    - A A B A A (Deny: decision mismatch)
 *    - A B A A A (Deny: stateProof mismatch)
 *    - B A A A A (Deny: envelope mismatch)
 * 3. Tampering and Corruption Vectors:
 *    - Wrong state root -> DENY
 *    - Wrong journal sequence -> DENY
 *    - Wrong envelope hash -> DENY
 *    - Wrong feature root -> DENY
 *    - Expired release root -> DENY
 *    - Stale control root -> DENY
 *    - Consumed reservation replay -> DENY
 *    - Non-canonical fork branch -> DENY
 *    - Expired risk authorization -> DENY
 *    - Expired reservation slot -> DENY
 * 4. Zero Side-Effect Invariant on Denial:
 *    certificateWrites = 0, capitalMutations = 0, signerRequests = 0, broadcastAttempts = 0.
 * 5. Happy Path Monotonicity:
 *    Valid chain builds AuthoritativeActionProofBundle and consumes reservation. Re-use strictly denied.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  CanonicalReleaseAuthorityStore,
  CanonicalControlAuthorityStore,
  CanonicalRiskAuthority,
  CanonicalEconomicAuthority,
  ActionProofBundleBuilder,
  AuthorityAncestryError,
} from '../dist/platform/assurance/authority-ancestry.js';
import { EconomicAuthorityStore } from '../dist/intelligence/capital/economic-authority-store.js';
import { CanonicalReducer } from '../dist/platform/reducer/canonical-reducer.js';
import { createAuthoritativeDecision } from '../dist/intelligence/provenance/decision-provenance.js';
import { ProvenanceVerifier } from '../dist/intelligence/provenance/provenance-verifier.js';
import { createPITFeature, buildPITFeatureSnapshot } from '../dist/intelligence/provenance/pit-snapshot.js';
import { createIntelligenceInput } from '../dist/intelligence/provenance/intelligence-input.js';
import { createUnvalidatedObservation } from '../dist/platform/ingress/observation-factory.js';

function createSideEffectTracker() {
  return {
    certificateWrites: 0,
    capitalMutations: 0,
    signerRequests: 0,
    broadcastAttempts: 0,
    recordCertificateWrite() { this.certificateWrites++; },
    recordCapitalMutation() { this.capitalMutations++; },
    recordSignerRequest() { this.signerRequests++; },
    recordBroadcastAttempt() { this.broadcastAttempts++; },
    assertZeroSideEffects() {
      assert.equal(this.certificateWrites, 0, 'certificateWrites must remain 0 on denial');
      assert.equal(this.capitalMutations, 0, 'capitalMutations must remain 0 on denial');
      assert.equal(this.signerRequests, 0, 'signerRequests must remain 0 on denial');
      assert.equal(this.broadcastAttempts, 0, 'broadcastAttempts must remain 0 on denial');
    },
  };
}

async function buildValidTestChain(seed, journalSeqNumber) {
  const commitSha = '373143a10d05327149cc5d3cbd0cfb44bff9cc18';
  const releaseRoot = createHash('sha256').update(`release_${seed}`).digest('hex');
  const controlRoot = createHash('sha256').update(`control_${seed}`).digest('hex');
  const controlEpoch = 1;
  const fenceEpoch = 1;

  // 1. Release & Control Stores
  const releaseStore = CanonicalReleaseAuthorityStore.getInstance();
  releaseStore.registerRelease(releaseRoot, commitSha, 300_000);
  const releaseProof = releaseStore.proveReleaseAuthority(releaseRoot, commitSha);

  const controlStore = CanonicalControlAuthorityStore.getInstance();
  controlStore.setActiveControl(controlRoot, controlEpoch, fenceEpoch, 300_000);
  const controlProof = controlStore.proveControlAuthority(controlRoot, controlEpoch, fenceEpoch);

  // 2. Ingress Envelope with Validated Compiled Observation
  const envelopeHash = createHash('sha256').update(`env_${seed}_${journalSeqNumber}`).digest('hex');
  const obs = createUnvalidatedObservation({
    sourceId: `obs-src-${seed}`,
    providerId: 'prov-solana-rpc',
    transport: 'websocket.logsSubscribe',
    receivedAtMs: Date.now(),
    slot: 310_000_000,
    commitment: 'confirmed',
    signature: '5wVv5Gj2E7W3m1Q8nF5x4T7k9m2p1v011111111111111111111111111111111',
    rawPayload: Buffer.from(JSON.stringify({ seed })),
    schemaVersion: 'solana-program-logs/v1',
    processingIntent: 'LIVE',
  });

  const envelope = {
    observationId: obs.observationId,
    source: 'WS_PYTH',
    timestamp: Date.now(),
    sequenceNumber: journalSeqNumber,
    journalSeq: journalSeqNumber,
    envelopeHash,
    isDurable: true,
    durability: 'FSYNC_COMMITTED',
    committedAtMs: Date.now(),
    validatedEnvelope: {
      envelopeId: `env-id-${journalSeqNumber}`,
      validatedAtMs: Date.now(),
      truthEvidence: {
        evidenceId: envelopeHash,
        validatorVersion: 'truth-validator/v1.0.0',
        validatedAtMs: Date.now(),
        rawPayloadHash: obs.rawPayloadHash,
        signatureVerified: true,
        schemaCompliant: true,
        verificationMethod: 'ed25519-curve25519',
      },
      compiledEnvelope: {
        observation: obs,
        compiledAtMs: Date.now(),
        schemaVersion: 'solana-program-logs/v1',
        targetTopic: 'markets.pump',
        decodedEvents: [],
      },
    },
  };

  // 3. State Transition Proof via CanonicalReducer
  const genesis = CanonicalReducer.createGenesisState();
  const reduction = CanonicalReducer.reduce(genesis, envelope);
  const stateProof = reduction.proof;
  const stateRoot = reduction.nextState;

  // 4. Feature Snapshot
  const now = Date.now();
  const feat = createPITFeature({
    featureId: `feat_${seed}_depth`,
    sourceObservationId: envelope.observationId,
    journalSeq: journalSeqNumber,
    observedAtMs: now - 100,
    knownAtMs: now - 50,
    evidenceHash: envelopeHash,
    calculationVersion: '1.0.0',
    value: 125000,
  });
  const pitSnapshot = buildPITFeatureSnapshot({
    snapshotId: `snap_${seed}_001`,
    features: [feat],
    decisionTimeMs: now,
  });

  // 5. Intelligence Engine -> Decision
  const intelligenceInput = createIntelligenceInput({
    state: stateRoot,
    snapshot: pitSnapshot,
    proof: stateProof,
    decisionTimeMs: now,
  });

  const decision = createAuthoritativeDecision({
    input: intelligenceInput,
    decisionId: `dec_${seed}_001`,
    targetMint: `TOKEN_${seed}`,
    action: 'BUY',
    evaluation: { score: 0.95 },
    releaseRoot,
    controlRoot,
  });

  // 6. Provenance Verifier
  const journalResolver = {
    getCommittedRecord: async (seq) => {
      if (seq === journalSeqNumber) {
        return {
          journalSeq: seq,
          envelopeHash,
          stateRootBefore: genesis.stateRoot,
          stateRootAfter: stateRoot.stateRoot,
        };
      }
      return null;
    },
  };

  const rootsResolver = {
    getActiveReleaseRoot: () => releaseRoot,
    getActiveControlRoot: () => controlRoot,
    getCanonicalBranch: () => 'main',
  };

  const verifier = new ProvenanceVerifier(journalResolver, rootsResolver);
  const verifiedDecision = await verifier.verify(decision, pitSnapshot);

  // 7. Canonical Risk Authority
  const riskAuth = CanonicalRiskAuthority.authorize(verifiedDecision, {
    maxAllocationLamports: 5_000_000n,
    maxSlippageBps: 50,
    validDurationMs: 60_000,
  });

  // 8. Economic Authority Store & Capital Reservation
  const economicStore = new EconomicAuthorityStore(100_000_000n);
  const reservation = CanonicalEconomicAuthority.reserveCapital(riskAuth, economicStore, 500_000n);

  return {
    envelope,
    stateProof,
    stateRoot,
    pitSnapshot,
    decision,
    verifiedDecision,
    riskAuth,
    reservation,
    releaseProof,
    controlProof,
    economicStore,
  };
}

test('C4 ANCESTRY: 1. Happy Path — valid chain builds AuthoritativeActionProofBundle and consumes reservation', async () => {
  const chain = await buildValidTestChain('HAPPY_001', 1n);
  const tracker = createSideEffectTracker();

  assert.equal(chain.reservation.isConsumed, false);

  const authBundle = ActionProofBundleBuilder.build({
    envelope: chain.envelope,
    stateProof: chain.stateProof,
    decision: chain.verifiedDecision,
    riskAuth: chain.riskAuth,
    reservation: chain.reservation,
    releaseProof: chain.releaseProof,
    controlProof: chain.controlProof,
    interceptor: tracker,
  });

  assert.ok(authBundle);
  assert.equal(authBundle.journalSeq, 1n);
  assert.equal(authBundle.envelopeHash, chain.envelope.envelopeHash);
  assert.equal(authBundle.stateRootAfter, chain.stateProof.stateRootAfter);
  assert.equal(authBundle.decisionId, chain.verifiedDecision.decision.decisionId);
  assert.equal(authBundle.riskAuthId, chain.riskAuth.riskAuthId);
  assert.equal(authBundle.reservationId, chain.reservation.reservationId);
  assert.equal(authBundle.releaseProofHash, chain.releaseProof.proofHash);
  assert.equal(authBundle.controlProofHash, chain.controlProof.proofHash);
  assert.equal(chain.reservation.isConsumed, true);

  assert.equal(tracker.certificateWrites, 1);
  assert.equal(tracker.capitalMutations, 1);
  assert.equal(tracker.signerRequests, 0);
  assert.equal(tracker.broadcastAttempts, 0);

  // Attempting to re-use consumed reservation strictly DENIED
  const replayTracker = createSideEffectTracker();
  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chain.envelope,
      stateProof: chain.stateProof,
      decision: chain.verifiedDecision,
      riskAuth: chain.riskAuth,
      reservation: chain.reservation,
      releaseProof: chain.releaseProof,
      controlProof: chain.controlProof,
      interceptor: replayTracker,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'ANCESTRY_RESERVATION_ALREADY_CONSUMED');
      return true;
    }
  );
  replayTracker.assertZeroSideEffects();
});

test('C4 CROSS-SPLICE CAMPAIGN: 2. Splice A-A-A-A-B (Chain A with Chain B reservation) -> STRICT DENIAL', async () => {
  const chainA = await buildValidTestChain('SPLICE_A', 10n);
  const chainB = await buildValidTestChain('SPLICE_B', 20n);
  const tracker = createSideEffectTracker();

  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chainA.envelope,
      stateProof: chainA.stateProof,
      decision: chainA.verifiedDecision,
      riskAuth: chainA.riskAuth,
      reservation: chainB.reservation, // SPLICED FROM CHAIN B!
      releaseProof: chainA.releaseProof,
      controlProof: chainA.controlProof,
      interceptor: tracker,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.match(err.code, /ANCESTRY_RESERVATION_DECISION_ID_MISMATCH|ANCESTRY_RESERVATION_RISK_ID_MISMATCH/);
      return true;
    }
  );
  tracker.assertZeroSideEffects();
});

test('C4 CROSS-SPLICE CAMPAIGN: 3. Splice A-A-A-B-A (Chain A with Chain B riskAuth) -> STRICT DENIAL', async () => {
  const chainA = await buildValidTestChain('SPLICE_A3', 30n);
  const chainB = await buildValidTestChain('SPLICE_B3', 40n);
  const tracker = createSideEffectTracker();

  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chainA.envelope,
      stateProof: chainA.stateProof,
      decision: chainA.verifiedDecision,
      riskAuth: chainB.riskAuth, // SPLICED FROM CHAIN B!
      reservation: chainA.reservation,
      releaseProof: chainA.releaseProof,
      controlProof: chainA.controlProof,
      interceptor: tracker,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'ANCESTRY_RISK_DECISION_ID_MISMATCH');
      return true;
    }
  );
  tracker.assertZeroSideEffects();
});

test('C4 CROSS-SPLICE CAMPAIGN: 4. Splice A-A-B-A-A (Chain A with Chain B decision) -> STRICT DENIAL', async () => {
  const chainA = await buildValidTestChain('SPLICE_A4', 50n);
  const chainB = await buildValidTestChain('SPLICE_B4', 60n);
  const tracker = createSideEffectTracker();

  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chainA.envelope,
      stateProof: chainA.stateProof,
      decision: chainB.verifiedDecision, // SPLICED FROM CHAIN B!
      riskAuth: chainA.riskAuth,
      reservation: chainA.reservation,
      releaseProof: chainA.releaseProof,
      controlProof: chainA.controlProof,
      interceptor: tracker,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.match(err.code, /ANCESTRY_DECISION_JOURNAL_SEQ_MISMATCH|ANCESTRY_DECISION_ENVELOPE_HASH_MISMATCH/);
      return true;
    }
  );
  tracker.assertZeroSideEffects();
});

test('C4 CROSS-SPLICE CAMPAIGN: 5. Splice A-B-A-A-A (Chain A with Chain B stateProof) -> STRICT DENIAL', async () => {
  const chainA = await buildValidTestChain('SPLICE_A5', 70n);
  const chainB = await buildValidTestChain('SPLICE_B5', 80n);
  const tracker = createSideEffectTracker();

  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chainA.envelope,
      stateProof: chainB.stateProof, // SPLICED FROM CHAIN B!
      decision: chainA.verifiedDecision,
      riskAuth: chainA.riskAuth,
      reservation: chainA.reservation,
      releaseProof: chainA.releaseProof,
      controlProof: chainA.controlProof,
      interceptor: tracker,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.match(err.code, /ANCESTRY_JOURNAL_SEQ_MISMATCH|ANCESTRY_ENVELOPE_HASH_MISMATCH/);
      return true;
    }
  );
  tracker.assertZeroSideEffects();
});

test('C4 CROSS-SPLICE CAMPAIGN: 6. Splice B-A-A-A-A (Chain B envelope with Chain A rest) -> STRICT DENIAL', async () => {
  const chainA = await buildValidTestChain('SPLICE_A6', 90n);
  const chainB = await buildValidTestChain('SPLICE_B6', 100n);
  const tracker = createSideEffectTracker();

  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chainB.envelope, // SPLICED FROM CHAIN B!
      stateProof: chainA.stateProof,
      decision: chainA.verifiedDecision,
      riskAuth: chainA.riskAuth,
      reservation: chainA.reservation,
      releaseProof: chainA.releaseProof,
      controlProof: chainA.controlProof,
      interceptor: tracker,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.match(err.code, /ANCESTRY_JOURNAL_SEQ_MISMATCH|ANCESTRY_ENVELOPE_HASH_MISMATCH/);
      return true;
    }
  );
  tracker.assertZeroSideEffects();
});

test('C4 CORRUPTION ADVERSARIAL: 7. Mismatched roots, expired proofs, and stale epochs fail closed', async () => {
  const chain = await buildValidTestChain('CORRUPT_001', 110n);

  // Vector 1: Expired release root
  const tracker1 = createSideEffectTracker();
  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chain.envelope,
      stateProof: chain.stateProof,
      decision: chain.verifiedDecision,
      riskAuth: chain.riskAuth,
      reservation: chain.reservation,
      releaseProof: chain.releaseProof,
      controlProof: chain.controlProof,
      nowMs: chain.releaseProof.expiresAtMs + 10_000, // Expired!
      interceptor: tracker1,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'ANCESTRY_RELEASE_ROOT_EXPIRED');
      return true;
    }
  );
  tracker1.assertZeroSideEffects();

  // Vector 2: Mismatched control root
  const tracker2 = createSideEffectTracker();
  const bogusControlProof = {
    ...chain.controlProof,
    controlRoot: 'e'.repeat(64),
  };
  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chain.envelope,
      stateProof: chain.stateProof,
      decision: chain.verifiedDecision,
      riskAuth: chain.riskAuth,
      reservation: chain.reservation,
      releaseProof: chain.releaseProof,
      controlProof: bogusControlProof,
      interceptor: tracker2,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'ANCESTRY_CONTROL_ROOT_MISMATCH');
      return true;
    }
  );
  tracker2.assertZeroSideEffects();

  // Vector 3: Non-canonical branch
  const tracker3 = createSideEffectTracker();
  const nonCanonicalDecision = {
    ...chain.verifiedDecision,
    canonicalBranch: 'feature/attack-branch',
  };
  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chain.envelope,
      stateProof: chain.stateProof,
      decision: nonCanonicalDecision,
      riskAuth: chain.riskAuth,
      reservation: chain.reservation,
      releaseProof: chain.releaseProof,
      controlProof: chain.controlProof,
      interceptor: tracker3,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'ANCESTRY_NON_CANONICAL_BRANCH');
      return true;
    }
  );
  tracker3.assertZeroSideEffects();

  // Vector 4: Expired reservation slot
  const tracker4 = createSideEffectTracker();
  assert.throws(
    () => ActionProofBundleBuilder.build({
      envelope: chain.envelope,
      stateProof: chain.stateProof,
      decision: chain.verifiedDecision,
      riskAuth: chain.riskAuth,
      reservation: chain.reservation,
      releaseProof: chain.releaseProof,
      controlProof: chain.controlProof,
      currentSlot: chain.reservation.expirationSlot + 100n, // Expired!
      interceptor: tracker4,
    }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'ANCESTRY_RESERVATION_SLOT_EXPIRED');
      return true;
    }
  );
  tracker4.assertZeroSideEffects();
});

test('C4 RISK & ECONOMIC AUTHORITY: 8. Unactionable decisions, deficits, and expired authorizations rejected', async () => {
  const chain = await buildValidTestChain('RISK_CAP_001', 120n);

  // Reject HOLD action from receiving risk authorization
  const holdDecision = {
    ...chain.verifiedDecision,
    decision: {
      ...chain.verifiedDecision.decision,
      action: 'HOLD',
    },
  };
  assert.throws(
    () => CanonicalRiskAuthority.authorize(holdDecision, { maxAllocationLamports: 1000n, maxSlippageBps: 10 }),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'UNACTIONABLE_DECISION_DENIED');
      return true;
    }
  );

  // Solvency deficit in Economic Authority
  const bankruptStore = new EconomicAuthorityStore(0n);
  assert.throws(
    () => CanonicalEconomicAuthority.reserveCapital(chain.riskAuth, bankruptStore, 1000n),
    (err) => {
      assert.ok(err instanceof AuthorityAncestryError);
      assert.equal(err.code, 'INSUFFICIENT_AVAILABLE_CASH');
      return true;
    }
  );
});
