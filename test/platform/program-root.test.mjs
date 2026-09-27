import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProgramRootAuthority
} from '../../dist/platform/security/program-root.js';

describe('PROGRAMROOT & STATECODEC: Program Binary Identity & Layout Generations (Sections 16, 17)', () => {
  it('detects program binary drift and blocks execution (OPEN -> BLOCK, INCREASE -> BLOCK)', () => {
    const authority = new ProgramRootAuthority();
    const pumpProgramId = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
    const certifiedHash = 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0';

    authority.registerCertifiedProgram({
      programId: pumpProgramId,
      loader: 'BPFLoaderUpgradeab1e11111111111111111111111',
      programDataAddress: '7YwD7mN1K4tC3q6X3p7X1vY8v7x9z',
      binarySha256: certifiedHash,
      upgradeAuthority: null, // Immutable
      lastUpgradeSlot: 280000000,
      idlHash: 'beefcafe12345678',
      certifiedAtMs: Date.now() - 3600000,
      certifiedSlot: 289000000,
      status: 'CERTIFIED'
    });

    // 1. Same hash -> ALLOWED
    const validCheck = authority.verifyProgramIntegrity(pumpProgramId, certifiedHash, 289450000);
    assert.equal(validCheck.allowed, true);
    assert.equal(validCheck.status, 'CERTIFIED');

    // 2. Modified binary hash (malicious or unannounced upgrade) -> FAIL CLOSED (DRIFTED)
    const driftedHash = 'f0e1d2c3b4a5968778695a4b3c2d1e0f0123456789abcdef0123456789abcdef';
    const driftedCheck = authority.verifyProgramIntegrity(pumpProgramId, driftedHash, 289450010);
    assert.equal(driftedCheck.allowed, false);
    assert.equal(driftedCheck.status, 'DRIFTED');
    assert.ok(driftedCheck.reason?.includes('binary hash drifted'));

    // 3. Unregistered program -> FAIL CLOSED (UNVERIFIED)
    const unknownCheck = authority.verifyProgramIntegrity('UnknownProgram111111111111111111111111111111', certifiedHash, 289450020);
    assert.equal(unknownCheck.allowed, false);
    assert.equal(unknownCheck.status, 'UNVERIFIED');
  });

  it('supports protocol schema generations (StateCodec) for Pump bonding curves', () => {
    const authority = new ProgramRootAuthority();

    // Gen 1: Legacy 49-byte bonding curve layout
    authority.registerLayoutCertificate({
      protocol: 'PUMP_FUN',
      accountType: 'BondingCurve',
      discriminatorHex: '17b7f83760d8ac60',
      accountLengthBytes: 49,
      layoutGeneration: 1,
      appendedFieldDefaults: {},
      decoderVersion: '1.0.0',
      sdkVersion: '1.0.0',
      rentExemptionLamports: 1500000n,
      isExpandable: false,
      certificateDigest: 'gen1_digest'
    });

    // Gen 2: Expanded layout with Token-2022 and fee recipient extensions (81 bytes)
    authority.registerLayoutCertificate({
      protocol: 'PUMP_FUN',
      accountType: 'BondingCurve',
      discriminatorHex: '17b7f83760d8ac60',
      accountLengthBytes: 81,
      layoutGeneration: 2,
      appendedFieldDefaults: { feeRecipient: '11111111111111111111111111111111' },
      decoderVersion: '2.0.0',
      sdkVersion: '2.0.0',
      rentExemptionLamports: 2100000n,
      isExpandable: true,
      certificateDigest: 'gen2_digest'
    });

    // Resolve Gen 1
    const gen1 = authority.resolveAccountLayout('PUMP_FUN', 'BondingCurve', 49, '17b7f83760d8ac60');
    assert.ok(gen1 !== null);
    assert.equal(gen1?.layoutGeneration, 1);
    assert.equal(gen1?.accountLengthBytes, 49);

    // Resolve Gen 2
    const gen2 = authority.resolveAccountLayout('PUMP_FUN', 'BondingCurve', 81, '17b7f83760d8ac60');
    assert.ok(gen2 !== null);
    assert.equal(gen2?.layoutGeneration, 2);
    assert.equal(gen2?.accountLengthBytes, 81);

    // Unknown byte length / corrupted layout -> null
    const invalid = authority.resolveAccountLayout('PUMP_FUN', 'BondingCurve', 55, '17b7f83760d8ac60');
    assert.equal(invalid, null);
  });

  it('issues and validates ProtocolSchemaLease within slot validity window', () => {
    const authority = new ProgramRootAuthority();
    authority.registerLayoutCertificate({
      protocol: 'PUMP_SWAP',
      accountType: 'PoolState',
      discriminatorHex: 'f1e2d3c4b5a69788',
      accountLengthBytes: 120,
      layoutGeneration: 1,
      appendedFieldDefaults: {},
      decoderVersion: '1.0.0',
      sdkVersion: '1.0.0',
      rentExemptionLamports: 2500000n,
      isExpandable: false,
      certificateDigest: 'pumpswap_pool_gen1'
    });

    const startSlot = 289450000;
    const lease = authority.acquireSchemaLease('PUMP_SWAP', startSlot, 100);

    assert.ok(lease.leaseId.startsWith('LEASE-PUMP_SWAP-289450000-'));
    assert.equal(lease.expiresAtSlot, 289450100);

    // Valid within window
    assert.equal(lease.isValid(289450050), true);
    // Expired past window
    assert.equal(lease.isValid(289450101), false);
    // Rejected before issue slot
    assert.equal(lease.isValid(289449999), false);
  });
});
