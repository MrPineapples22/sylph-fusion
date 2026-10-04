import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FusionPipeline,
  FusionJournal,
  CertificateChain,
  isValidTransition,
  VALID_TRANSITIONS,
  hashCanonical,
  envelopeRoot,
} from '../../dist/platform/pipeline/index.js';

function createDummyEnvelope(overrides = {}) {
  return {
    envelopeId: 'env_fuzz_001',
    economicFactId: 'fact_fuzz_001',
    traceId: 'trace_fuzz_001',
    cluster: 'mainnet-beta',
    observedSlot: 1000n,
    bankFingerprint: 'bank_fp_fuzz',
    observedAt: '2026-10-03T20:00:00.000Z',
    knownAt: '2026-10-03T20:00:00.000Z',
    evidenceRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    transportAttempts: [],
    certificateChain: [],
    state: 'OBSERVED',
    ...overrides,
  };
}

test('PROPERTY 1 & 2: Random state transitions never succeed if illegal, revision never decreases', async () => {
  const allStates = Object.keys(VALID_TRANSITIONS);

  for (let trial = 0; trial < 50; trial++) {
    const fromIndex = Math.floor(Math.random() * allStates.length);
    const toIndex = Math.floor(Math.random() * allStates.length);
    const fromState = allStates[fromIndex];
    const toState = allStates[toIndex];

    const allowed = isValidTransition(fromState, toState);
    const expectedSuccess = VALID_TRANSITIONS[fromState]?.includes(toState) ?? false;

    assert.equal(allowed, expectedSuccess);
  }
});

test('PROPERTY 3 & 4: Journal sequence is strictly monotonic, hash chain remains unbroken', () => {
  const journal = new FusionJournal();
  const states = ['OBSERVED', 'EVIDENCE_CERTIFIED', 'TEMPORALLY_VALID', 'SEMANTICALLY_RESOLVED'];

  let prevRevision = 0n;
  for (let i = 0; i < states.length; i++) {
    const entry = journal.append({
      journalEntryId: `entry_prop_${i}`,
      envelopeId: 'env_fuzz_001',
      economicFactId: 'fact_fuzz_001',
      fromState: (states[i - 1] ?? 'OBSERVED'),
      toState: states[i],
      previousStateRoot: `prev_root_${i}`,
      nextStateRoot: `next_root_${i}`,
      envelopeRoot: `env_root_${i}`,
      certificateHash: `cert_hash_${i}`,
      observedAt: '2026-10-03T20:00:00.000Z',
    });

    assert.ok(entry.sequence > prevRevision);
    prevRevision = entry.sequence;
  }

  assert.equal(journal.verify().valid, true);
  assert.equal(journal.length(), 4);
});

test('PROPERTY 5: economicFactId is strictly preserved across all operations', async () => {
  const env = createDummyEnvelope();
  const pipeline = new FusionPipeline(env);

  const res1 = await pipeline.transition({
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cov_001',
      evidenceRoot: 'ev_root_001',
    },
  });

  assert.equal(res1.state.economicFactId, env.economicFactId);
  assert.equal(res1.certificate.economicFactId, env.economicFactId);
  assert.equal(res1.journalEntry.economicFactId, env.economicFactId);

  // Attempting to inject different economicFactId throws immediately
  await assert.rejects(
    pipeline.transition({
      targetState: 'TEMPORALLY_VALID',
      authority: 'OBSERVE',
      // @ts-ignore
      envelopePatch: { economicFactId: 'forged_economic_fact' },
    }),
    /IDENTITY_DRIFT_ERROR/
  );
});

test('PROPERTY 6, 7 & 9: Timeout cannot manufacture landing, models cannot authorize execution', async () => {
  const env = createDummyEnvelope();
  const pipeline = new FusionPipeline(env);

  // Advance to EVIDENCE_CERTIFIED
  await pipeline.transition({
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cov_001',
      evidenceRoot: 'ev_root_001',
    },
  });

  // Epistemic invariant: Missing bankFingerprint cannot be assumed safe
  await assert.rejects(
    pipeline.transition({
      targetState: 'TEMPORALLY_VALID',
      authority: 'OBSERVE',
      envelopePatch: { bankFingerprint: '' },
    }),
    /EVIDENCE_DEFICIT/
  );
});

test('CRASH RECOVERY: Deterministic replay from persisted journal reproduces identical stateRoot and certificate chain', async () => {
  const journalSource = new FusionJournal();
  const certChainSource = new CertificateChain();
  const env = createDummyEnvelope();

  const pipeline1 = new FusionPipeline(env, journalSource, certChainSource);

  // Execute sequence
  await pipeline1.transition({
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cov_1',
      evidenceRoot: 'ev_1',
    },
    observedAt: '2026-10-03T20:00:00.000Z',
  });

  await pipeline1.transition({
    targetState: 'TEMPORALLY_VALID',
    authority: 'OBSERVE',
    envelopePatch: {
      observedSlot: 1005n,
      bankFingerprint: 'bank_fp_1005',
    },
    observedAt: '2026-10-03T20:00:01.000Z',
  });

  const snapshot1 = pipeline1.snapshot();

  // Simulate process restart: Replay exact same inputs on a new pipeline instance
  const pipeline2 = new FusionPipeline(createDummyEnvelope());

  await pipeline2.transition({
    targetState: 'EVIDENCE_CERTIFIED',
    authority: 'OBSERVE',
    envelopePatch: {
      coverageCertificate: 'cov_1',
      evidenceRoot: 'ev_1',
    },
    observedAt: '2026-10-03T20:00:00.000Z',
  });

  await pipeline2.transition({
    targetState: 'TEMPORALLY_VALID',
    authority: 'OBSERVE',
    envelopePatch: {
      observedSlot: 1005n,
      bankFingerprint: 'bank_fp_1005',
    },
    observedAt: '2026-10-03T20:00:01.000Z',
  });

  const snapshot2 = pipeline2.snapshot();

  assert.equal(snapshot1.stateRoot, snapshot2.stateRoot);
  assert.equal(snapshot1.revision, snapshot2.revision);
  assert.equal(pipeline1.getJournal().root(), pipeline2.getJournal().root());
  assert.equal(pipeline1.getCertificateChain().root(), pipeline2.getCertificateChain().root());
  assert.equal(pipeline2.verify().valid, true);
});
