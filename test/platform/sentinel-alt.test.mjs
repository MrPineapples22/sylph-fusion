import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SentinelAltAuthority
} from '../../dist/platform/security/sentinel-alt.js';

describe('SENTINEL-ALT: Transaction Account Set & Resource Integrity Authority (Upgrade 7)', () => {
  const baseGraph = {
    transactionVersion: 'V0',
    feePayer: 'WalletPubkey111111111111111111111111111111',
    staticAccountKeys: ['WalletPubkey111111111111111111111111111111', 'TokenMint11111111111111111111111111111111111'],
    writableAccountKeys: ['WalletPubkey111111111111111111111111111111'],
    signerAccountKeys: ['WalletPubkey111111111111111111111111111111'],
    programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
    addressLookupTables: [
      {
        tableAddress: 'Alt111111111111111111111111111111111111111',
        tableAccountHash: 'alt_data_hash_abc',
        writableIndexes: [0],
        readonlyIndexes: [1],
        resolvedWritableAddresses: ['ResolvedWritable1'],
        resolvedReadonlyAddresses: ['ResolvedReadonly1']
      }
    ],
    resourceBudget: {
      computeUnitLimit: 200_000,
      computeUnitPriceMicroLamports: 50_000n,
      loadedAccountsDataSizeLimit: 64_000,
      totalSerializedBytes: 412
    }
  };

  it('computes 5 discrete resource fingerprints and verifies identical graphs', () => {
    const hashes = SentinelAltAuthority.computeHashes(baseGraph);

    assert.equal(hashes.accountSetHash.length, 64);
    assert.equal(hashes.writableSetHash.length, 64);
    assert.equal(hashes.signerSetHash.length, 64);
    assert.equal(hashes.resourceBudgetHash.length, 64);
    assert.equal(hashes.lookupResolutionHash.length, 64);
    assert.equal(hashes.compositeResourceDigest.length, 64);

    const check = SentinelAltAuthority.assertGraphIntegrity(baseGraph, { ...baseGraph });
    assert.equal(check.isIntact, true);
    assert.equal(check.compositeDigest, hashes.compositeResourceDigest);
  });

  it('detects TRANSACTION_IDENTITY_DRIFT when accounts or compute budgets are altered post-review', () => {
    // 1. Budget altered
    const modifiedBudget = {
      ...baseGraph,
      resourceBudget: {
        ...baseGraph.resourceBudget,
        computeUnitLimit: 250_000 // Drifts from 200k to 250k
      }
    };

    assert.throws(
      () => SentinelAltAuthority.assertGraphIntegrity(baseGraph, modifiedBudget),
      /TRANSACTION_IDENTITY_DRIFT: Candidate transaction mutated post-review! Breaches: \[RESOURCE_BUDGET_MISMATCH\]/
    );

    // 2. Writable account added
    const modifiedWritables = {
      ...baseGraph,
      writableAccountKeys: [...baseGraph.writableAccountKeys, 'UnreviewedWritableAccount11111111111111111']
    };

    assert.throws(
      () => SentinelAltAuthority.assertGraphIntegrity(baseGraph, modifiedWritables),
      /TRANSACTION_IDENTITY_DRIFT: Candidate transaction mutated post-review! Breaches: \[WRITABLE_SET_MISMATCH\]/
    );

    // 3. ALT table mutated
    const modifiedAlt = {
      ...baseGraph,
      addressLookupTables: [
        {
          ...baseGraph.addressLookupTables[0],
          tableAccountHash: 'tampered_alt_hash'
        }
      ]
    };

    assert.throws(
      () => SentinelAltAuthority.assertGraphIntegrity(baseGraph, modifiedAlt),
      /TRANSACTION_IDENTITY_DRIFT: Candidate transaction mutated post-review! Breaches: \[ALT_LOOKUP_MISMATCH\]/
    );
  });
});
