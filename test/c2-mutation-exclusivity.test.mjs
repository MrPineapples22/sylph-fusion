/**
 * SYLPH FUSION — C2 MUTATION EXCLUSIVITY ADVERSARIAL TEST SUITE
 * Specifications: Blueprint Sections 23, 24, 25 & Gate C2 Requirements
 *
 * Verifies:
 * 1. ONLY CanonicalReducer may produce the next authoritative FusionStateRootV2.
 * 2. Real Immutability: Deep freezing, rejection of mutable Maps/Sets, zero escaping mutable references.
 * 3. Reducer Determinism: Pure function of (state, envelope, reducerVersion); zero clock, zero randomness, zero cache.
 * 4. StateTransitionProof binds journalSeq, envelopeHash, stateRootBefore, stateRootAfter, reducerVersion, transitionHash.
 * 5. Fail-closed security controls: Unbranded states, corrupted roots, non-durable envelopes, stale sequences, illegal transitions, and evidence deficits are rejected.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CanonicalReducer,
  CANONICAL_REDUCER_VERSION,
  computeTransitionHash,
  deepFreeze,
} from '../dist/platform/reducer/canonical-reducer.js';
import { computeStateRootV2 } from '../dist/platform/pipeline/state-root-v2.js';
import { FSYNC_COMMITTED } from '../dist/platform/ingress/types.js';
import { createUnvalidatedObservation } from '../dist/platform/ingress/observation-factory.js';

function createMockCommittedEnvelope(seq, options = {}) {
  const obs = createUnvalidatedObservation({
    sourceId: options.sourceId ?? 'obs-src-1',
    providerId: options.providerId ?? 'prov-solana-rpc',
    transport: 'websocket.logsSubscribe',
    receivedAtMs: 1_700_000_000_000,
    slot: options.slot !== undefined ? Number(options.slot) : 310_000_000,
    commitment: 'confirmed',
    signature: options.signature ?? '5wVv5Gj2E7W3m1Q8nF5x4T7k9m2p1v011111111111111111111111111111111',
    rawPayload: options.payload ?? Buffer.from(JSON.stringify(options.directive ?? {})),
    schemaVersion: 'solana-program-logs/v1',
    processingIntent: options.intent ?? 'LIVE',
  });

  const envelopeHash = options.envelopeHash ?? createHash('sha256').update(`env-${seq}`).digest('hex');

  return {
    journalSeq: seq,
    envelopeHash,
    durability: options.durability ?? FSYNC_COMMITTED,
    committedAtMs: 1_700_000_000_000,
    validatedEnvelope: {
      envelopeId: `env-id-${seq}`,
      validatedAtMs: 1_700_000_000_000,
      truthEvidence: {
        evidenceId: envelopeHash,
        validatorVersion: 'truth-validator/v1.0.0',
        validatedAtMs: 1_700_000_000_000,
        rawPayloadHash: obs.rawPayloadHash,
        signatureVerified: true,
        schemaCompliant: true,
        verificationMethod: 'ed25519-curve25519',
      },
      compiledEnvelope: {
        observation: obs,
        compiledAtMs: 1_700_000_000_000,
        schemaVersion: 'solana-program-logs/v1',
        targetTopic: 'markets.pump',
        decodedEvents: [],
      },
    },
  };
}

test('C2-1: Genesis state creation produces authoritative, branded FusionStateRootV2', () => {
  const genesis = CanonicalReducer.createGenesisState();
  assert.ok(genesis);
  assert.equal(genesis.revision, 0n);
  assert.equal(genesis.state, 'OBSERVED');
  assert.ok(CanonicalReducer.isStateRootV2(genesis), 'Genesis state must be recognized as valid FusionStateRootV2');
  assert.equal(genesis.stateRoot, computeStateRootV2(genesis));
  assert.ok(/^[0-9a-f]{64}$/.test(genesis.stateRoot));
});

test('C2-2: CanonicalReducer.reduce produces nextState and valid StateTransitionProof', () => {
  const genesis = CanonicalReducer.createGenesisState();
  const env = createMockCommittedEnvelope(1n);

  const { nextState, proof } = CanonicalReducer.reduce(genesis, env);

  assert.ok(nextState);
  assert.ok(proof);
  assert.ok(CanonicalReducer.isStateRootV2(nextState));
  assert.ok(CanonicalReducer.isStateTransitionProof(proof));

  assert.equal(nextState.revision, 1n);
  assert.equal(nextState.stateRoot, computeStateRootV2(nextState));
  assert.equal(proof.journalSeq, 1n);
  assert.equal(proof.envelopeHash, env.envelopeHash);
  assert.equal(proof.stateRootBefore, genesis.stateRoot);
  assert.equal(proof.stateRootAfter, nextState.stateRoot);
  assert.equal(proof.reducerVersion, CANONICAL_REDUCER_VERSION);

  const expectedTransitionHash = computeTransitionHash(
    1n,
    env.envelopeHash,
    genesis.stateRoot,
    nextState.stateRoot,
    CANONICAL_REDUCER_VERSION
  );
  assert.equal(proof.transitionHash, expectedTransitionHash);
});

test('C2-2a: durable state roots and proofs restore with private authority brands', () => {
  const genesis = CanonicalReducer.createGenesisState();
  const env = createMockCommittedEnvelope(7n);
  const { nextState, proof } = CanonicalReducer.reduce(genesis, env);
  const savedRoot = JSON.parse(JSON.stringify(nextState, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  const restoredRoot = CanonicalReducer.restoreStateRoot(savedRoot);
  const savedProof = JSON.parse(JSON.stringify({ ...proof, journalSeq: proof.journalSeq.toString() }));
  const restoredProof = CanonicalReducer.restoreTransitionProof(savedProof, restoredRoot);
  assert.equal(CanonicalReducer.isStateRootV2(restoredRoot), true);
  assert.equal(CanonicalReducer.isStateTransitionProof(restoredProof), true);
  assert.equal(restoredRoot.stateRoot, nextState.stateRoot);
  assert.equal(restoredProof.transitionHash, proof.transitionHash);
  assert.throws(() => CanonicalReducer.restoreStateRoot({ ...savedRoot, stateRoot: '0'.repeat(64) }), /PERSISTED_STATE_ROOT_HASH_MISMATCH/);
  assert.throws(() => CanonicalReducer.restoreTransitionProof({ ...savedProof, envelopeHash: '0'.repeat(64) }, restoredRoot), /PERSISTED_TRANSITION_PROOF_HASH_MISMATCH/);
});

test('C2-3: Real Immutability — Authoritative state cannot be mutated, added to, or deleted from', () => {
  const genesis = CanonicalReducer.createGenesisState();
  const env = createMockCommittedEnvelope(1n);
  const { nextState, proof } = CanonicalReducer.reduce(genesis, env);

  assert.throws(() => {
    nextState.observedSlot = 999_999n;
  }, /Cannot assign to read only property|read-only/i);

  assert.throws(() => {
    nextState.stateRoot = 'bad-root';
  }, /Cannot assign to read only property|read-only/i);

  assert.throws(() => {
    nextState.newField = 'injected';
  }, /Cannot add property|not extensible/i);

  assert.throws(() => {
    delete nextState.observedSlot;
  }, /Cannot delete property/i);

  assert.throws(() => {
    proof.journalSeq = 999n;
  }, /Cannot assign to read only property|read-only/i);
});

test('C2-4: Real Immutability — Mutable Maps and Sets are strictly forbidden in authoritative state', () => {
  const mapAttempt = new Map();
  mapAttempt.set('key', 'value');

  assert.throws(() => {
    deepFreeze(mapAttempt);
  }, /MUTABLE_MAP_FORBIDDEN/);

  const setAttempt = new Set([1, 2, 3]);
  assert.throws(() => {
    deepFreeze(setAttempt);
  }, /MUTABLE_SET_FORBIDDEN/);
});

test('C2-5: Reducer Determinism — 1,000 reductions yield bit-for-bit identical stateRoot and transitionHash', () => {
  const genesis = CanonicalReducer.createGenesisState();
  const env = createMockCommittedEnvelope(1n);

  const baseline = CanonicalReducer.reduce(genesis, env);

  const reducerInstanceA = new CanonicalReducer();
  const reducerInstanceB = new CanonicalReducer();

  for (let i = 0; i < 1000; i++) {
    const resA = reducerInstanceA.reduce(genesis, env);
    const resB = reducerInstanceB.reduce(genesis, env);

    assert.equal(resA.nextState.stateRoot, baseline.nextState.stateRoot);
    assert.equal(resA.proof.transitionHash, baseline.proof.transitionHash);
    assert.equal(resB.nextState.stateRoot, baseline.nextState.stateRoot);
    assert.equal(resB.proof.transitionHash, baseline.proof.transitionHash);
  }
});

test('C2-6: Fail-Closed Security — Plain/forged caller objects are rejected by CanonicalReducer', () => {
  const genesis = CanonicalReducer.createGenesisState();
  const fakeState = {};
  for (const [k, v] of Object.entries(genesis)) {
    fakeState[k] = v;
  }
  const env = createMockCommittedEnvelope(1n);

  assert.throws(() => {
    CanonicalReducer.reduce(fakeState, env);
  }, /REDUCER_UNAUTHORIZED_STATE/);
});

test('C2-7: Fail-Closed Security — Corrupted stateRoot is rejected by CanonicalReducer', () => {
  const genesis = CanonicalReducer.createGenesisState();
  // Attempt to clone with mismatched stateRoot
  const corrupted = Object.assign(Object.create(Object.getPrototypeOf(genesis)), genesis, {
    stateRoot: '1111111111111111111111111111111111111111111111111111111111111111',
  });

  const env = createMockCommittedEnvelope(1n);

  assert.throws(() => {
    CanonicalReducer.reduce(corrupted, env);
  }, /REDUCER_CORRUPT_STATE_ROOT|REDUCER_UNAUTHORIZED_STATE/);
});

test('C2-8: Fail-Closed Security — Non-FSYNC_COMMITTED envelopes violate durability barrier', () => {
  const genesis = CanonicalReducer.createGenesisState();

  const nonDurableEnvelopes = ['QUEUED', 'BUFFERED', 'WRITE_COMPLETE', 'FSYNC_DATA'];

  for (const durability of nonDurableEnvelopes) {
    const badEnv = createMockCommittedEnvelope(1n, { durability });
    assert.throws(() => {
      CanonicalReducer.reduce(genesis, badEnv);
    }, /DURABILITY_BARRIER_VIOLATION/);
  }
});

test('C2-9: Fail-Closed Security — Retrograde or stale journal sequences are rejected', () => {
  const genesis = CanonicalReducer.createGenesisState();
  const env1 = createMockCommittedEnvelope(1n);
  const { nextState: state1 } = CanonicalReducer.reduce(genesis, env1);

  // Attempt to replay sequence 1n against state with revision 1n
  const staleEnv = createMockCommittedEnvelope(1n);
  assert.throws(() => {
    CanonicalReducer.reduce(state1, staleEnv);
  }, /STALE_JOURNAL_SEQUENCE/);

  // Attempt sequence 0n
  const zeroSeqEnv = createMockCommittedEnvelope(0n);
  assert.throws(() => {
    CanonicalReducer.reduce(genesis, zeroSeqEnv);
  }, /INVALID_JOURNAL_SEQUENCE/);
});

test('C2-10: Fail-Closed Security — Illegal state transitions are rejected', () => {
  const genesis = CanonicalReducer.createGenesisState();
  // OBSERVED cannot jump directly to SETTLED
  const illegalEnv = createMockCommittedEnvelope(1n, {
    directive: { targetState: 'SETTLED' },
  });

  assert.throws(() => {
    CanonicalReducer.reduce(genesis, illegalEnv);
  }, /ILLEGAL_STATE_TRANSITION/);
});

test('C2-11: Fail-Closed Security — Missing evidence prerequisites block state advancement', () => {
  const genesis = CanonicalReducer.createGenesisState();
  // EVIDENCE_CERTIFIED requires coverageCertificateRoot and evidenceRoot
  const deficitEnv = createMockCommittedEnvelope(1n, {
    directive: {
      targetState: 'EVIDENCE_CERTIFIED',
      coverageCertificateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    },
  });

  assert.throws(() => {
    CanonicalReducer.reduce(genesis, deficitEnv);
  }, /EVIDENCE_DEFICIT/);
});

test('C2-12: Complete multi-step state progression with valid evidence works deterministically', () => {
  let state = CanonicalReducer.createGenesisState();

  // Step 1: OBSERVED -> EVIDENCE_CERTIFIED
  const env1 = createMockCommittedEnvelope(1n, {
    directive: {
      targetState: 'EVIDENCE_CERTIFIED',
      coverageCertificateRoot: 'cov_cert_root_123',
      evidenceRoot: 'evidence_root_123',
    },
  });
  const step1 = CanonicalReducer.reduce(state, env1);
  assert.equal(step1.nextState.state, 'EVIDENCE_CERTIFIED');
  assert.equal(step1.nextState.revision, 1n);

  // Step 2: EVIDENCE_CERTIFIED -> TEMPORALLY_VALID
  const env2 = createMockCommittedEnvelope(2n, {
    slot: 310_000_100n,
    directive: {
      targetState: 'TEMPORALLY_VALID',
      bankFingerprint: 'bank_fp_123',
    },
  });
  const step2 = CanonicalReducer.reduce(step1.nextState, env2);
  assert.equal(step2.nextState.state, 'TEMPORALLY_VALID');
  assert.equal(step2.nextState.revision, 2n);
  assert.equal(step2.nextState.observedSlot, 310_000_100n);
});
