import test from 'node:test';
import assert from 'node:assert/strict';
import { NoLandProofAuthority } from '../../dist/platform/execution/no-land-proof.js';

function createValidBaseInput(overrides = {}) {
  const startSlot = 1000n;
  const lastValidSlot = 1150n;
  const lastValidBlockHeight = 1100n;

  return {
    signature: '5M78SignatureXYZ1234567890abcdef',
    cluster: 'mainnet-beta',
    transactionLifetime: {
      blockhash: 'BlockhashAtSlot1000XYZ',
      startSlot,
      lastValidBlockHeight,
      lastValidSlot,
    },
    searchRange: {
      searchStartSlot: 990n,
      searchEndSlot: 1200n, // At or beyond lastValidSlot
    },
    commitmentLevel: 'finalized',
    providerResults: [
      {
        providerEndpoint: 'https://archive-rpc1.solana.com',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 900n,
        archiveCoverageEndSlot: 1500n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 15,
      },
      {
        providerEndpoint: 'https://archive-rpc2.triton.one',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 800n,
        archiveCoverageEndSlot: 1600n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 22,
      },
    ],
    ...overrides,
  };
}

test('NOLAND RED-TEAM 1: Valid multi-provider archive quorum produces ProvenNoLandCertificate', () => {
  const input = createValidBaseInput();
  const evaluation = NoLandProofAuthority.evaluateProof(input);

  assert.equal(evaluation.certified, true);
  if (evaluation.certified) {
    assert.equal(evaluation.certificate.certificateType, 'PROVEN_NO_LAND_CERTIFICATE');
    assert.equal(evaluation.certificate.verifiedNonLanding, true);
    assert.equal(evaluation.certificate.providersQueriedCount, 2);
    assert.equal(typeof evaluation.certificate.certificateHash, 'string');
    assert.equal(evaluation.certificate.certificateHash.length, 64);
  }
});

test('NOLAND RED-TEAM 2: Transaction lands after local timeout -> rejects NoLand, sets DISPUTED', () => {
  const input = createValidBaseInput({
    providerResults: [
      {
        providerEndpoint: 'https://archive-rpc1.solana.com',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 900n,
        archiveCoverageEndSlot: 1500n,
        signatureFound: true, // Landed late after client timed out!
        signatureStatus: 'finalized',
        queriedAt: '2026-10-03T20:00:01.000Z',
        latencyMs: 20,
      },
      {
        providerEndpoint: 'https://archive-rpc2.triton.one',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 800n,
        archiveCoverageEndSlot: 1600n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 22,
      },
    ],
  });

  const evaluation = NoLandProofAuthority.evaluateProof(input);
  assert.equal(evaluation.certified, false);
  if (!evaluation.certified) {
    assert.match(evaluation.failureReason, /TRANSACTION_OBSERVED/);
    assert.equal(evaluation.recommendedState, 'DISPUTED');
  }
});

test('NOLAND RED-TEAM 3: Search range terminates before lastValidSlot -> rejects NoLand', () => {
  const input = createValidBaseInput({
    searchRange: {
      searchStartSlot: 990n,
      searchEndSlot: 1140n, // 1140 < 1150 (lastValidSlot)
    },
  });

  const evaluation = NoLandProofAuthority.evaluateProof(input);
  assert.equal(evaluation.certified, false);
  if (!evaluation.certified) {
    assert.match(evaluation.failureReason, /INCOMPLETE_RANGE/);
    assert.equal(evaluation.recommendedState, 'EXPIRED_UNRESOLVED');
  }
});

test('NOLAND RED-TEAM 4: Incomplete archive history coverage gap -> rejects NoLand', () => {
  const input = createValidBaseInput({
    providerResults: [
      {
        providerEndpoint: 'https://archive-rpc1.solana.com',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 1050n, // Gap: does not cover 990 to 1050!
        archiveCoverageEndSlot: 1500n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 15,
      },
      {
        providerEndpoint: 'https://archive-rpc2.triton.one',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 800n,
        archiveCoverageEndSlot: 1600n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 22,
      },
    ],
  });

  const evaluation = NoLandProofAuthority.evaluateProof(input);
  assert.equal(evaluation.certified, false);
  if (!evaluation.certified) {
    assert.match(evaluation.failureReason, /ARCHIVE_COVERAGE_GAP/);
    assert.equal(evaluation.recommendedState, 'EXPIRED_UNRESOLVED');
  }
});

test('NOLAND RED-TEAM 5: Single RPC or insufficient archive quorum -> rejects NoLand', () => {
  const input = createValidBaseInput({
    providerResults: [
      {
        providerEndpoint: 'https://archive-rpc1.solana.com',
        providerType: 'ARCHIVE_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 900n,
        archiveCoverageEndSlot: 1500n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 15,
      },
      // Only 1 archive RPC, second is non-archive or unhealthy
      {
        providerEndpoint: 'https://standard-rpc.solana.com',
        providerType: 'VALIDATOR_RPC',
        isHealthy: true,
        archiveCoverageStartSlot: 900n,
        archiveCoverageEndSlot: 1500n,
        signatureFound: false,
        signatureStatus: null,
        queriedAt: '2026-10-03T20:00:00.000Z',
        latencyMs: 12,
      },
    ],
  });

  const evaluation = NoLandProofAuthority.evaluateProof(input);
  assert.equal(evaluation.certified, false);
  if (!evaluation.certified) {
    assert.match(evaluation.failureReason, /INSUFFICIENT_ARCHIVE_QUORUM/);
    assert.equal(evaluation.recommendedState, 'EXPIRED_UNRESOLVED');
  }
});

test('NOLAND RED-TEAM 6: Unfinalized commitment queried -> rejects NoLand', () => {
  const input = createValidBaseInput({
    // @ts-ignore
    commitmentLevel: 'confirmed',
  });

  const evaluation = NoLandProofAuthority.evaluateProof(input);
  assert.equal(evaluation.certified, false);
  if (!evaluation.certified) {
    assert.match(evaluation.failureReason, /UNFINALIZED_SEARCH/);
    assert.equal(evaluation.recommendedState, 'EXPIRED_UNRESOLVED');
  }
});
