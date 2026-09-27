import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExecutionWitnessAuthority,
  WitnessInvariantViolationError,
  createCapitalEnvelope,
  createAltCertificate
} from '../../dist/platform/execution/execution-witness.js';

describe('EXECUTION WITNESS & STATE LEASE: Deterministic Signing Pipeline (Sections 26, 31, 32, 33)', () => {
  it('enforces strict lifecycle progression: BUILT -> SIMULATED -> AUTHORIZED -> SIGNED -> BROADCAST', () => {
    const authority = new ExecutionWitnessAuthority();
    const intentId = 'INTENT-2026-09-26-001';

    const envelope = createCapitalEnvelope({
      economicIntentId: intentId,
      inputPrincipalLamports: 100000000n, // 0.1 SOL
      exactNetworkFeeLamports: 5000n,
      priorityFeeLamports: 50000n,
      jitoTipLamports: 100000n,
      protocolFeeLamports: 1000000n,
      creatorFeeLamports: 0n,
      rentReservationLamports: 2039280n,
      protocolMaintenanceLamports: 0n
    });

    const altCert = createAltCertificate({
      lookupTableAddress: 'AltAddress11111111111111111111111111111111',
      authority: null,
      lastExtendedSlot: 289450000,
      tableAccountHash: 'table_hash_abc123',
      resolvedAddresses: ['Addr1', 'Addr2'],
      certifiedAtSlot: 289450010
    });

    const now = Date.now();
    const stateLease = {
      leaseId: 'LEASE-001',
      snapshotSlot: 289450010,
      simulationSlot: 289450010,
      criticalAccountHashes: {
        'BondingCurve11111111111111111111111111111111': 'curve_hash_1'
      },
      leasedAtMs: now,
      maxAgeMs: 5000
    };

    // 1. BUILT
    const witness = authority.registerBuiltTransaction({
      economicIntentId: intentId,
      exactMessageHash: 'message_hash_987654',
      blockhash: 'blockhash_54321',
      lastValidBlockHeight: 289450500,
      accountKeys: ['Key1', 'Key2'],
      programIds: ['6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'],
      computeUnitsLimit: 200000,
      altCertificates: [altCert],
      capitalEnvelope: envelope,
      stateLease,
      modelEpoch: 'EPOCH-2026.09.26-1'
    });

    assert.equal(witness.stage, 'BUILT');

    // Invariant 7 Violation: Cannot jump to AUTHORIZED or SIGNED without SIMULATED
    assert.throws(
      () => authority.markSigned(witness.witnessId, now),
      WitnessInvariantViolationError,
      'Cannot mark SIGNED directly from BUILT stage'
    );

    // 2. SIMULATED
    authority.certifyExactSimulation(witness.witnessId, {
      success: true,
      unitsConsumed: 125000,
      simulatedAtSlot: 289450012,
      logs: ['Program 6EF8... success'],
      simulatedStateHash: 'sim_hash_1'
    });
    assert.equal(witness.stage, 'SIMULATED');

    // 3. AUTHORIZED
    authority.authorizeForSigning(
      witness.witnessId,
      289450015,
      now + 200,
      { 'BondingCurve11111111111111111111111111111111': 'curve_hash_1' },
      { 'AltAddress11111111111111111111111111111111': 'table_hash_abc123' }
    );
    assert.equal(witness.stage, 'AUTHORIZED');

    // 4. SIGNED
    authority.markSigned(witness.witnessId, now + 300);
    assert.equal(witness.stage, 'SIGNED');

    // 5. BROADCAST
    authority.markBroadcast(witness.witnessId, '5XwSignature11111111111111111111111111111111111111111111111111111111');
    assert.equal(witness.stage, 'BROADCAST');
    assert.ok(witness.broadcastSignature?.startsWith('5Xw'));
  });

  it('fails closed when state lease expires or account hash drifts (Section 31)', () => {
    const authority = new ExecutionWitnessAuthority();
    const intentId = 'INTENT-DRIFT-001';
    const now = Date.now();

    const envelope = createCapitalEnvelope({
      economicIntentId: intentId,
      inputPrincipalLamports: 50000000n,
      exactNetworkFeeLamports: 5000n,
      priorityFeeLamports: 5000n,
      jitoTipLamports: 10000n,
      protocolFeeLamports: 500000n,
      creatorFeeLamports: 0n,
      rentReservationLamports: 0n,
      protocolMaintenanceLamports: 0n
    });

    const stateLease = {
      leaseId: 'LEASE-DRIFT',
      snapshotSlot: 289450010,
      simulationSlot: 289450010,
      criticalAccountHashes: {
        'Curve111111111111111111111111111111111111': 'hash_v1'
      },
      leasedAtMs: now - 6000, // 6 seconds ago (expired)
      maxAgeMs: 5000
    };

    const witness = authority.registerBuiltTransaction({
      economicIntentId: intentId,
      exactMessageHash: 'msg_drift',
      blockhash: 'bh_drift',
      lastValidBlockHeight: 289450500,
      accountKeys: ['K1'],
      programIds: ['P1'],
      computeUnitsLimit: 200000,
      altCertificates: [],
      capitalEnvelope: envelope,
      stateLease,
      modelEpoch: 'EPOCH-1'
    });

    authority.certifyExactSimulation(witness.witnessId, {
      success: true,
      unitsConsumed: 50000,
      simulatedAtSlot: 289450010,
      logs: [],
      simulatedStateHash: 's1'
    });

    // Authorizing with expired lease throws WitnessInvariantViolationError
    assert.throws(
      () =>
        authority.authorizeForSigning(
          witness.witnessId,
          289450015,
          now,
          { 'Curve111111111111111111111111111111111111': 'hash_v1' },
          {}
        ),
      WitnessInvariantViolationError,
      'Expired state lease must block authorization'
    );
  });

  it('fails closed when ALT account content hash changes (Section 33)', () => {
    const authority = new ExecutionWitnessAuthority();
    const intentId = 'INTENT-ALT-001';
    const now = Date.now();

    const envelope = createCapitalEnvelope({
      economicIntentId: intentId,
      inputPrincipalLamports: 50000000n,
      exactNetworkFeeLamports: 5000n,
      priorityFeeLamports: 5000n,
      jitoTipLamports: 10000n,
      protocolFeeLamports: 500000n,
      creatorFeeLamports: 0n,
      rentReservationLamports: 0n,
      protocolMaintenanceLamports: 0n
    });

    const altCert = createAltCertificate({
      lookupTableAddress: 'AltAddressModified11111111111111111111111',
      authority: null,
      lastExtendedSlot: 289450000,
      tableAccountHash: 'expected_alt_hash',
      resolvedAddresses: ['Addr1'],
      certifiedAtSlot: 289450005
    });

    const stateLease = {
      leaseId: 'LEASE-ALT',
      snapshotSlot: 289450010,
      simulationSlot: 289450010,
      criticalAccountHashes: {},
      leasedAtMs: now,
      maxAgeMs: 5000
    };

    const witness = authority.registerBuiltTransaction({
      economicIntentId: intentId,
      exactMessageHash: 'msg_alt',
      blockhash: 'bh_alt',
      lastValidBlockHeight: 289450500,
      accountKeys: ['K1'],
      programIds: ['P1'],
      computeUnitsLimit: 200000,
      altCertificates: [altCert],
      capitalEnvelope: envelope,
      stateLease,
      modelEpoch: 'EPOCH-1'
    });

    authority.certifyExactSimulation(witness.witnessId, {
      success: true,
      unitsConsumed: 50000,
      simulatedAtSlot: 289450010,
      logs: [],
      simulatedStateHash: 's1'
    });

    // Authorizing when observed ALT hash has mutated must fail closed
    assert.throws(
      () =>
        authority.authorizeForSigning(
          witness.witnessId,
          289450015,
          now + 100,
          {},
          { 'AltAddressModified11111111111111111111111': 'tampered_alt_hash' }
        ),
      WitnessInvariantViolationError,
      'Mutated ALT hash must trigger ALT Integrity Violation'
    );
  });
});
