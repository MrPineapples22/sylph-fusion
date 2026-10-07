/**
 * SYLPH FUSION — C3 DECISION PROVENANCE & PIT CAUSALITY TEST SUITE
 * Specifications: Frozen Architecture Execution Prompt (Sections 26, 27, 28, 29)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createPITFeature,
  buildPITFeatureSnapshot,
  isPITFeature,
  isPITFeatureSnapshot,
} from '../dist/intelligence/provenance/pit-snapshot.js';
import {
  createIntelligenceInput,
  isIntelligenceInput,
} from '../dist/intelligence/provenance/intelligence-input.js';
import {
  createAuthoritativeDecision,
  isAuthoritativeDecision,
  computeDecisionHash,
} from '../dist/intelligence/provenance/decision-provenance.js';
import {
  ProvenanceVerifier,
  isVerifiedDecision,
} from '../dist/intelligence/provenance/provenance-verifier.js';
import {
  CanonicalReducer,
} from '../dist/platform/reducer/index.js';
import { Engine } from '../dist/fusion.js';
import { createCanonicalSolanaIngress, StoreIngressJournal } from '../dist/platform/ingress/canonical-ingress.js';
import { createUnvalidatedObservation } from '../dist/platform/ingress/observation-factory.js';
import { FSYNC_COMMITTED } from '../dist/platform/ingress/types.js';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../dist/store.js';

const VALID_EVIDENCE_HASH = createHash('sha256').update('evidence_sample_01').digest('hex');
const VALID_RELEASE_ROOT = 'a'.repeat(64);
const VALID_CONTROL_ROOT = 'b'.repeat(64);

async function createDummyEngine() {
  const dir = await mkdtemp(join(tmpdir(), 'c3-test-engine-'));
  const store = new Store(join(dir, 'state.sqlite'));
  const cfg = {
    rpcUrl: 'http://localhost:8899',
    wsUrl: 'ws://localhost:8900',
    privateKey: '1'.repeat(64),
    targetMints: [],
  };
  const rpc = { connection: {} };
  const market = {};
  const executor = {};
  const state = { day: '2026-10-07', dayPnl: '0' };
  const ingress = createCanonicalSolanaIngress({ journal: new StoreIngressJournal(store) });

  const engine = new Engine(
    cfg,
    rpc,
    market,
    executor,
    store,
    state,
    undefined,
    undefined,
    'deterministic_only',
    undefined,
    undefined,
    undefined,
    ingress,
  );

  return {
    engine,
    cleanup: async () => {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function createCommittedFixture(journalSeq = 1n) {
  const rawPayload = Buffer.from(JSON.stringify({}));
  const obs = createUnvalidatedObservation({
    sourceId: 'solana-rpc',
    providerId: 'quicknode-mainnet',
    transport: 'websocket.logsSubscribe',
    receivedAtMs: 1_000,
    observedAtMs: 1_000,
    slot: 100,
    commitment: 'confirmed',
    signature: '5wVv5Gj2E7W3m1Q8nF5x4T7k9m2p1v011111111111111111111111111111111',
    rawPayload,
    schemaVersion: 'solana-program-logs/v1',
    processingIntent: 'LIVE',
  });

  return {
    validatedEnvelope: {
      compiledEnvelope: {
        observation: obs,
        decodedEvents: [],
      },
      truthEvidence: {
        evidenceId: obs.rawPayloadHash,
        validatorVersion: 'truth-validator/v1.0.0',
        validatedAtMs: 1_000,
        providerCount: 1,
        sourceHash: obs.rawPayloadHash,
        rawPayloadHash: obs.rawPayloadHash,
        signatureVerified: true,
      },
    },
    journalSeq,
    envelopeHash: obs.rawPayloadHash,
    committedAtMs: 1_000,
    fsyncCommitTimestamp: 1_000,
    durability: FSYNC_COMMITTED,
  };
}

test('PIT Feature Creation & Nominal Branding', () => {
  const feature = createPITFeature({
    featureId: 'microstructure_buyers',
    sourceObservationId: 'obs_123',
    journalSeq: 1n,
    observedAtMs: 10_000,
    knownAtMs: 10_500,
    evidenceHash: VALID_EVIDENCE_HASH,
    calculationVersion: '1.0.0',
    value: { buyers: 42 },
  });

  assert.equal(isPITFeature(feature), true);
  assert.equal(feature.featureId, 'microstructure_buyers');
  assert.equal(feature.journalSeq, 1n);
  assert.equal(feature.featureHash.length, 64);
  assert.throws(() => { feature.value = {}; }, /Cannot assign to read only property/);
});

test('PIT Feature Sequence Zero is Explicitly Valid', () => {
  const feature = createPITFeature({
    featureId: 'genesis_feature',
    sourceObservationId: 'obs_genesis',
    journalSeq: 0n,
    observedAtMs: 1,
    knownAtMs: 1,
    evidenceHash: VALID_EVIDENCE_HASH,
    calculationVersion: '1.0.0',
    value: 0,
  });

  assert.equal(feature.journalSeq, 0n);
  assert.equal(isPITFeature(feature), true);
});

test('PIT Causality Enforcement: knownAtMs <= decisionTimeMs', () => {
  const feature = createPITFeature({
    featureId: 'price_momentum',
    sourceObservationId: 'obs_456',
    journalSeq: 5n,
    observedAtMs: 1_000,
    knownAtMs: 2_000,
    evidenceHash: VALID_EVIDENCE_HASH,
    calculationVersion: '1.0.0',
    value: { momentum: 1.25 },
  });

  // Valid snapshot: decisionTimeMs >= knownAtMs
  const validSnapshot = buildPITFeatureSnapshot({
    snapshotId: 'snap_01',
    features: [feature],
    decisionTimeMs: 2_000,
  });
  assert.equal(isPITFeatureSnapshot(validSnapshot), true);
  assert.equal(validSnapshot.featureRoot.length, 64);

  // PIT Causality Violation Attack: decisionTimeMs < knownAtMs
  assert.throws(() => {
    buildPITFeatureSnapshot({
      snapshotId: 'snap_future_leak',
      features: [feature],
      decisionTimeMs: 1_999, // Earlier than feature knowledge time!
    });
  }, /PIT_CAUSALITY_VIOLATION/);
});

test('IntelligenceInput creation and invariant verification', () => {
  const committed = createCommittedFixture(1n);
  const genesis = CanonicalReducer.createGenesisState();
  const reduction = CanonicalReducer.reduce(genesis, committed);

  const feature = createPITFeature({
    featureId: 'liquidity_depth',
    sourceObservationId: 'obs_789',
    journalSeq: 1n,
    observedAtMs: 1_000,
    knownAtMs: 1_000,
    evidenceHash: VALID_EVIDENCE_HASH,
    calculationVersion: '1.0.0',
    value: 1_000_000,
  });
  const snapshot = buildPITFeatureSnapshot({
    snapshotId: 'snap_02',
    features: [feature],
    decisionTimeMs: 1_500,
  });

  // Valid input
  const input = createIntelligenceInput({
    state: reduction.nextState,
    snapshot,
    proof: reduction.proof,
    decisionTimeMs: 1_500,
  });
  assert.equal(isIntelligenceInput(input), true);

  // Mismatched state and proof: proof stateRootAfter must match state
  assert.throws(() => {
    createIntelligenceInput({
      state: genesis, // Genesis state has different stateRoot than reduction.proof.stateRootAfter!
      snapshot,
      proof: reduction.proof,
      decisionTimeMs: 1_500,
    });
  }, /STATE_ROOT_PROOF_MISMATCH/);

  // Future feature leakage in input
  assert.throws(() => {
    createIntelligenceInput({
      state: reduction.nextState,
      snapshot,
      proof: reduction.proof,
      decisionTimeMs: 900, // < snapshot.maxKnownAtMs
    });
  }, /PIT_CAUSALITY_VIOLATION/);
});

test('Engine.evaluate rejects unauthenticated inputs and accepts only IntelligenceInput', async () => {
  const { engine, cleanup } = await createDummyEngine();
  try {
    // Attempting to pass plain object or raw event
    assert.throws(() => {
      engine.evaluate({ type: 'MarketEvent' });
    }, /ILLEGAL_ENGINE_EVALUATE_INPUT/);

    assert.throws(() => {
      engine.evaluate({ state: {}, snapshot: {}, proof: {} });
    }, /ILLEGAL_ENGINE_EVALUATE_INPUT/);

    // Valid evaluation
    const committed = createCommittedFixture(1n);
    const genesis = engine.getCanonicalState();
    const reduction = CanonicalReducer.reduce(genesis, committed);

    const feature = createPITFeature({
      featureId: 'f1',
      sourceObservationId: 'mint_test_01',
      journalSeq: 1n,
      observedAtMs: 1_000,
      knownAtMs: 1_000,
      evidenceHash: VALID_EVIDENCE_HASH,
      calculationVersion: '1.0.0',
      value: 100,
    });
    const snapshot = buildPITFeatureSnapshot({
      snapshotId: 'snap_03',
      features: [feature],
      decisionTimeMs: 1_500,
    });

    const input = createIntelligenceInput({
      state: reduction.nextState,
      snapshot,
      proof: reduction.proof,
      decisionTimeMs: 1_500,
    });

    const decision = engine.evaluate(input);
    assert.equal(isAuthoritativeDecision(decision), true);
    assert.equal(decision.provenance.journalSeq, 1n);
    assert.equal(decision.provenance.envelopeHash, committed.envelopeHash);
    assert.equal(decision.provenance.stateRootBefore, genesis.stateRoot);
    assert.equal(decision.provenance.stateRootAfter, reduction.nextState.stateRoot);
    assert.equal(decision.provenance.featureRoot, snapshot.featureRoot);
  } finally {
    await cleanup();
  }
});

test('ProvenanceVerifier: 10-Point Verification and Adversarial Attack Suite', async () => {
  const committed = createCommittedFixture(1n);
  const genesis = CanonicalReducer.createGenesisState();
  const reduction = CanonicalReducer.reduce(genesis, committed);

  const feature = createPITFeature({
    featureId: 'f1',
    sourceObservationId: 'mint_test_01',
    journalSeq: 1n,
    observedAtMs: 1_000,
    knownAtMs: 1_000,
    evidenceHash: VALID_EVIDENCE_HASH,
    calculationVersion: '1.0.0',
    value: 100,
  });
  const snapshot = buildPITFeatureSnapshot({
    snapshotId: 'snap_04',
    features: [feature],
    decisionTimeMs: 1_500,
  });

  const input = createIntelligenceInput({
    state: reduction.nextState,
    snapshot,
    proof: reduction.proof,
    decisionTimeMs: 1_500,
  });

  const decision = createAuthoritativeDecision({
    input,
    decisionId: 'dec_test_01',
    targetMint: 'mint_test_01',
    action: 'BUY',
    evaluation: { score: 0.99 },
    releaseRoot: VALID_RELEASE_ROOT,
    controlRoot: VALID_CONTROL_ROOT,
  });

  // Mock Journal Resolver and Canonical Roots Resolver
  const journalResolver = {
    getCommittedRecord: async (seq) => {
      if (seq === 1n) {
        return {
          journalSeq: 1n,
          envelopeHash: committed.envelopeHash,
          stateRootBefore: genesis.stateRoot,
          stateRootAfter: reduction.nextState.stateRoot,
        };
      }
      return null;
    },
  };

  const rootsResolver = {
    getActiveReleaseRoot: () => VALID_RELEASE_ROOT,
    getActiveControlRoot: () => VALID_CONTROL_ROOT,
    getCanonicalBranch: () => 'canonical',
  };

  const verifier = new ProvenanceVerifier(journalResolver, rootsResolver);

  // 1. Legitimate verification passes
  const verified = await verifier.verify(decision, snapshot);
  assert.equal(isVerifiedDecision(verified), true);
  assert.equal(verified.decision.decisionId, 'dec_test_01');
  assert.equal(verified.canonicalBranch, 'canonical');

  // 2. Adversarial Attack: Non-existent journal sequence
  const fakeSeqDecision = {
    ...decision,
    provenance: { ...decision.provenance, journalSeq: 999n },
  };
  await assert.rejects(
    async () => verifier.verify(fakeSeqDecision, snapshot),
    /PROVENANCE_VERIFICATION_FAILED/
  );

  // 3. Adversarial Attack: Envelope hash mismatch
  const tamperedEnvelopeDecision = {
    ...decision,
    provenance: { ...decision.provenance, envelopeHash: '0'.repeat(64) },
  };
  await assert.rejects(
    async () => verifier.verify(tamperedEnvelopeDecision, snapshot),
    /Envelope hash mismatch/
  );

  // 4. Adversarial Attack: State root before mismatch
  const tamperedStateBefore = {
    ...decision,
    provenance: { ...decision.provenance, stateRootBefore: '1'.repeat(64) },
  };
  await assert.rejects(
    async () => verifier.verify(tamperedStateBefore, snapshot),
    /State root before mismatch/
  );

  // 5. Adversarial Attack: Feature root mismatch
  const otherSnapshot = buildPITFeatureSnapshot({
    snapshotId: 'snap_other',
    features: [
      createPITFeature({
        featureId: 'f2',
        sourceObservationId: 'obs_2',
        journalSeq: 1n,
        observedAtMs: 1_000,
        knownAtMs: 1_000,
        evidenceHash: VALID_EVIDENCE_HASH,
        calculationVersion: '1.0.0',
        value: 200,
      }),
    ],
    decisionTimeMs: 1_500,
  });
  await assert.rejects(
    async () => verifier.verify(decision, otherSnapshot),
    /Feature root mismatch/
  );

  // 6. Adversarial Attack: Tampered decision hash
  const tamperedHashDecision = {
    ...decision,
    decisionHash: 'f'.repeat(64),
  };
  await assert.rejects(
    async () => verifier.verify(tamperedHashDecision, snapshot),
    /Decision hash mismatch/
  );

  // 7. Adversarial Attack: Stale release root
  const staleReleaseRootsResolver = {
    ...rootsResolver,
    getActiveReleaseRoot: () => '9'.repeat(64),
  };
  const staleReleaseVerifier = new ProvenanceVerifier(journalResolver, staleReleaseRootsResolver);
  await assert.rejects(
    async () => staleReleaseVerifier.verify(decision, snapshot),
    /Release root mismatch/
  );

  // 8. Adversarial Attack: Stale control root
  const staleControlRootsResolver = {
    ...rootsResolver,
    getActiveControlRoot: () => '8'.repeat(64),
  };
  const staleControlVerifier = new ProvenanceVerifier(journalResolver, staleControlRootsResolver);
  await assert.rejects(
    async () => staleControlVerifier.verify(decision, snapshot),
    /Control root mismatch/
  );

  // 9. Adversarial Attack: Non-canonical branch fork
  const forkRootsResolver = {
    ...rootsResolver,
    getCanonicalBranch: () => 'non_canonical_fork',
  };
  const forkVerifier = new ProvenanceVerifier(journalResolver, forkRootsResolver);
  await assert.rejects(
    async () => forkVerifier.verify(decision, snapshot),
    /Non-canonical branch rejected/
  );
});
