import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  QuorumRootAuthority
} from '../../dist/platform/ingestion/quorum-root.js';

describe('QUORUMROOT: Evidence Independence & Truth Quorum (Section 11)', () => {
  it('disagreement between providers produces CONFLICTED (never silently averaged)', () => {
    const authority = new QuorumRootAuthority();

    authority.registerProvider({
      providerId: 'HELIUS_EAST',
      operator: 'HELIUS',
      infrastructureRegion: 'us-east-1',
      administrativeOwner: 'Helius Corp',
      correlationGroup: 'HELIUS_GLOBAL',
      dataSource: 'GEODISTRIBUTED_RPC'
    });

    authority.registerProvider({
      providerId: 'TRITON_EU',
      operator: 'TRITON',
      infrastructureRegion: 'eu-central-1',
      administrativeOwner: 'Triton One',
      correlationGroup: 'TRITON_GLOBAL',
      dataSource: 'DIRECT_VALIDATOR_TPU'
    });

    const now = Date.now();
    // Conflicting curve reserve values
    const cert = authority.evaluateFactQuorum({
      factKey: 'CURVE_RESERVE:Token1111111111111111111111111111111111111',
      slot: 289450000,
      observations: [
        {
          factKey: 'CURVE_RESERVE:Token1111111111111111111111111111111111111',
          slot: 289450000,
          timestampMs: now,
          providerId: 'HELIUS_EAST',
          value: { virtualSolReserves: 30000000000n },
          valueDigest: 'reserve_digest_30sol'
        },
        {
          factKey: 'CURVE_RESERVE:Token1111111111111111111111111111111111111',
          slot: 289450000,
          timestampMs: now,
          providerId: 'TRITON_EU',
          value: { virtualSolReserves: 35000000000n },
          valueDigest: 'reserve_digest_35sol'
        }
      ]
    });

    // Invariant: MUST NOT average the numbers! Disagreement is CONFLICTED
    assert.equal(cert.status, 'CONFLICTED');
    assert.equal(cert.consensusValue, undefined);
    assert.ok(cert.conflictDetails?.includes('Evidence disagreement detected'));
  });

  it('detects correlated endpoints under the same operator as 1 independent group', () => {
    const authority = new QuorumRootAuthority();

    // Two different URLs, but same operator and correlation group
    authority.registerProvider({
      providerId: 'RPC_A_US_EAST',
      operator: 'SAME_OPERATOR',
      infrastructureRegion: 'us-east-1',
      administrativeOwner: 'CorpX',
      correlationGroup: 'FAIL_DOMAIN_US_EAST_1',
      dataSource: 'GEODISTRIBUTED_RPC'
    });

    authority.registerProvider({
      providerId: 'RPC_B_US_EAST',
      operator: 'SAME_OPERATOR',
      infrastructureRegion: 'us-east-1',
      administrativeOwner: 'CorpX',
      correlationGroup: 'FAIL_DOMAIN_US_EAST_1',
      dataSource: 'GEODISTRIBUTED_RPC'
    });

    const now = Date.now();
    const cert = authority.evaluateFactQuorum({
      factKey: 'TOKEN_SUPPLY:TokenX',
      slot: 289450100,
      minIndependentGroups: 2,
      observations: [
        {
          factKey: 'TOKEN_SUPPLY:TokenX',
          slot: 289450100,
          timestampMs: now,
          providerId: 'RPC_A_US_EAST',
          value: 1000000000n,
          valueDigest: 'supply_1b'
        },
        {
          factKey: 'TOKEN_SUPPLY:TokenX',
          slot: 289450100,
          timestampMs: now,
          providerId: 'RPC_B_US_EAST',
          value: 1000000000n,
          valueDigest: 'supply_1b'
        }
      ]
    });

    // Although 2 endpoints responded with identical value, they share the failure domain!
    assert.equal(cert.independentGroupCount, 1);
    assert.equal(cert.status, 'INSUFFICIENT_INDEPENDENCE');
    assert.equal(cert.consensusValue, undefined);
  });

  it('produces AGREED TruthQuorumCertificate when truly independent failure domains concur', () => {
    const authority = new QuorumRootAuthority();

    authority.registerProvider({
      providerId: 'HELIUS_EAST',
      operator: 'HELIUS',
      infrastructureRegion: 'us-east-1',
      administrativeOwner: 'Helius Corp',
      correlationGroup: 'HELIUS_AWS',
      dataSource: 'GEODISTRIBUTED_RPC'
    });

    authority.registerProvider({
      providerId: 'TRITON_EU',
      operator: 'TRITON',
      infrastructureRegion: 'eu-central-1',
      administrativeOwner: 'Triton One',
      correlationGroup: 'TRITON_BARE_METAL',
      dataSource: 'DIRECT_VALIDATOR_TPU'
    });

    const now = Date.now();
    const cert = authority.evaluateFactQuorum({
      factKey: 'BONDING_CURVE_COMPLETE:TokenY',
      slot: 289450200,
      minIndependentGroups: 2,
      observations: [
        {
          factKey: 'BONDING_CURVE_COMPLETE:TokenY',
          slot: 289450200,
          timestampMs: now,
          providerId: 'HELIUS_EAST',
          value: true,
          valueDigest: 'curve_complete_true'
        },
        {
          factKey: 'BONDING_CURVE_COMPLETE:TokenY',
          slot: 289450201, // 1 slot difference is within acceptable maxSlotLag
          timestampMs: now + 50,
          providerId: 'TRITON_EU',
          value: true,
          valueDigest: 'curve_complete_true'
        }
      ]
    });

    assert.equal(cert.status, 'AGREED');
    assert.equal(cert.independentGroupCount, 2);
    assert.equal(cert.consensusValue, true);
    assert.ok(cert.certificateId.startsWith('QUORUM-'));
  });
});
