/**
 * SYLPH FUSION — DURABILITY & CROSS-PROOF VERIFICATION TEST
 * Specifications: Blueprint Section 7, 8, 11
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFusionJournalStore } from '../../dist/platform/pipeline/fusion-journal-store.js';
import { verifyFusionProof } from '../../dist/platform/pipeline/fusion-proof-verifier.js';

test('FusionJournalStore — Atomic CAS and STALE_PROPOSAL rejection', async () => {
  const store = new InMemoryFusionJournalStore();

  // Commit revision 0 -> 1
  const entry1 = await store.appendTransitionAtomic({
    economicFactId: 'fact_solana_901',
    expectedRevision: 0n,
    newRevision: 1n,
    fromState: 'OBSERVED',
    toState: 'EVIDENCE_CERTIFIED',
    previousStateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
    nextStateRoot: 'state_root_rev_1',
    transitionPayloadRoot: 'payload_root_1',
    certificate: 'cert_1',
    certificateHash: 'cert_hash_1',
    journalEntryId: 'j_entry_1',
    envelopeId: 'env_1',
    envelopeRoot: 'env_root_1',
    observedAt: new Date().toISOString(),
  });

  assert.equal(entry1.sequence, 1n);
  assert.equal(entry1.economicFactId, 'fact_solana_901');

  // Competing writer attempting to commit with old expectedRevision 0n MUST fail with STALE_PROPOSAL
  await assert.rejects(
    async () => {
      await store.appendTransitionAtomic({
        economicFactId: 'fact_solana_901',
        expectedRevision: 0n,
        newRevision: 1n,
        fromState: 'OBSERVED',
        toState: 'EVIDENCE_CERTIFIED',
        previousStateRoot: '0000000000000000000000000000000000000000000000000000000000000000',
        nextStateRoot: 'competing_root',
        transitionPayloadRoot: 'competing_payload',
        certificate: 'competing_cert',
        certificateHash: 'competing_cert_hash',
        journalEntryId: 'j_entry_competing',
        envelopeId: 'env_1',
        envelopeRoot: 'env_root_1',
        observedAt: new Date().toISOString(),
      });
    },
    /STALE_PROPOSAL/
  );

  // Valid next step 1 -> 2
  const entry2 = await store.appendTransitionAtomic({
    economicFactId: 'fact_solana_901',
    expectedRevision: 1n,
    newRevision: 2n,
    fromState: 'EVIDENCE_CERTIFIED',
    toState: 'TEMPORALLY_VALID',
    previousStateRoot: 'state_root_rev_1',
    nextStateRoot: 'state_root_rev_2',
    transitionPayloadRoot: 'payload_root_2',
    certificate: 'cert_2',
    certificateHash: 'cert_hash_2',
    journalEntryId: 'j_entry_2',
    envelopeId: 'env_1',
    envelopeRoot: 'env_root_1',
    observedAt: new Date().toISOString(),
  });

  assert.equal(entry2.sequence, 2n);
  assert.equal(entry2.toState, 'TEMPORALLY_VALID');
});

test('verifyFusionProof — Detects mismatched state roots or certificate hashes', () => {
  const mockJournal = [
    {
      sequence: 1n,
      journalEntryId: 'j1',
      envelopeId: 'env1',
      economicFactId: 'fact1',
      fromState: 'OBSERVED',
      toState: 'EVIDENCE_CERTIFIED',
      previousStateRoot: 'prev_root',
      nextStateRoot: 'next_root',
      envelopeRoot: 'env_root',
      certificateHash: 'cert_hash',
      observedAt: '2026-10-04T00:00:00Z',
      previousEntryHash: '0000',
      entryHash: 'entry_hash_1',
    },
  ];

  const matchingCert = [
    {
      certificateId: 'c1',
      kind: 'EVIDENCE_PROOF',
      authority: 'SOL_INGESTION',
      envelopeId: 'env1',
      economicFactId: 'fact1',
      fromState: 'OBSERVED',
      toState: 'EVIDENCE_CERTIFIED',
      predecessorCertificateHash: '0000',
      envelopeRoot: 'env_root',
      previousStateRoot: 'prev_root',
      nextStateRoot: 'next_root',
      evidenceRoot: 'ev_root',
      issuedAt: '2026-10-04T00:00:00Z',
      certificateHash: 'cert_hash',
    },
  ];

  const resultOk = verifyFusionProof(mockJournal, matchingCert);
  assert.equal(resultOk.isValid, true);
  assert.equal(resultOk.errors.length, 0);

  // Corrupt state root in certificate
  const corruptedCert = [
    {
      ...matchingCert[0],
      nextStateRoot: 'corrupted_state_root',
    },
  ];

  const resultCorrupt = verifyFusionProof(mockJournal, corruptedCert);
  assert.equal(resultCorrupt.isValid, false);
  assert.ok(resultCorrupt.errors.some((e) => e.includes('NEXT_STATE_ROOT_MISMATCH')));
});
