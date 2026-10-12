import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExecutionWitnessAuthority,
  WitnessInvariantViolationError,
  createCapitalEnvelope,
  createAltCertificate,
} from '../../dist/platform/execution/execution-witness.js';

describe('ExecutionWitnessAuthority: Fail-Closed Drift & Slot Gating', () => {
  it('strictly rejects authorization when observed account hashes are missing', () => {
    const authority = new ExecutionWitnessAuthority();
    const intentId = 'INTENT-FAILCLOSED-01';
    const now = Date.now();

    const envelope = createCapitalEnvelope({
      economicIntentId: intentId,
      inputPrincipalLamports: 10_000_000n,
      exactNetworkFeeLamports: 5_000n,
      priorityFeeLamports: 10_000n,
      jitoTipLamports: 10_000n,
      protocolFeeLamports: 100_000n,
      creatorFeeLamports: 0n,
      rentReservationLamports: 0n,
      protocolMaintenanceLamports: 0n,
    });

    const stateLease = {
      leaseId: 'LEASE-CRITICAL',
      snapshotSlot: 1000,
      simulationSlot: 1000,
      criticalAccountHashes: {
        'RequiredAccount1111111111111111111111111111111': 'expected_hash_abc',
      },
      leasedAtMs: now,
      maxAgeMs: 5000,
    };

    const witness = authority.registerBuiltTransaction({
      economicIntentId: intentId,
      exactMessageHash: 'msg_hash_1',
      blockhash: 'bh_1',
      lastValidBlockHeight: 1500,
      accountKeys: ['Key1'],
      programIds: ['Prog1'],
      computeUnitsLimit: 200_000,
      altCertificates: [],
      capitalEnvelope: envelope,
      stateLease,
      modelEpoch: 'EPOCH-1',
    });

    const initialDigest = witness.witnessDigest;

    authority.certifyExactSimulation(witness.witnessId, {
      success: true,
      unitsConsumed: 100_000,
      simulatedAtSlot: 1005,
      logs: [],
      simulatedStateHash: 'sim_state_hash_123',
    });

    // Verification: simulation changes the cryptographic witnessDigest
    assert.notEqual(witness.witnessDigest, initialDigest);

    // 1. Missing observation (empty object) MUST FAIL CLOSED
    assert.throws(
      () =>
        authority.authorizeForSigning(
          witness.witnessId,
          1010, // slot
          now + 50,
          {}, // Missing RequiredAccount!
          {}
        ),
      /State drift on account RequiredAccount/
    );

    // 2. Slot lag > 300 MUST FAIL CLOSED
    assert.throws(
      () =>
        authority.authorizeForSigning(
          witness.witnessId,
          1350, // snapshotSlot 1000 + 350 > 300
          now + 50,
          { 'RequiredAccount1111111111111111111111111111111': 'expected_hash_abc' },
          {}
        ),
      /Slot boundary violation/
    );

    // 3. Exact valid observation passes
    const authorized = authority.authorizeForSigning(
      witness.witnessId,
      1010,
      now + 50,
      { 'RequiredAccount1111111111111111111111111111111': 'expected_hash_abc' },
      {}
    );
    assert.equal(authorized.stage, 'AUTHORIZED');
  });

  it('enforces Invariants 6 and 7 across the complete authoritative lifecycle (BUILT -> SIMULATED -> AUTHORIZED -> SIGNED -> BROADCAST)', () => {
    const authority = new ExecutionWitnessAuthority();
    const intentId = 'INTENT-LIFECYCLE-02';
    const now = Date.now();

    const envelope = createCapitalEnvelope({
      economicIntentId: intentId,
      inputPrincipalLamports: 10_000_000n,
      exactNetworkFeeLamports: 5_000n,
      priorityFeeLamports: 10_000n,
      jitoTipLamports: 10_000n,
      protocolFeeLamports: 100_000n,
      creatorFeeLamports: 0n,
      rentReservationLamports: 0n,
      protocolMaintenanceLamports: 0n,
    });

    const altCert = createAltCertificate({
      lookupTableAddress: 'AltAddress1111111111111111111111111111111',
      authority: null,
      lastExtendedSlot: 990,
      tableAccountHash: 'alt_hash_999',
      resolvedAddresses: ['Key1', 'Key2'],
      certifiedAtSlot: 995,
    });

    const stateLease = {
      leaseId: 'LEASE-LIFECYCLE',
      snapshotSlot: 1000,
      simulationSlot: 1000,
      criticalAccountHashes: {
        'AccountA': 'hash_a',
      },
      leasedAtMs: now,
      maxAgeMs: 5000,
    };

    const witness = authority.registerBuiltTransaction({
      economicIntentId: intentId,
      exactMessageHash: 'msg_hash_life',
      blockhash: 'bh_life',
      lastValidBlockHeight: 1500,
      accountKeys: ['Key1', 'Key2'],
      programIds: ['Prog1'],
      computeUnitsLimit: 200_000,
      altCertificates: [altCert],
      capitalEnvelope: envelope,
      stateLease,
      modelEpoch: 'EPOCH-1',
    });

    assert.equal(witness.stage, 'BUILT');

    // Invariant 6 & 7: Cannot sign or broadcast while BUILT
    assert.throws(
      () => authority.markSigned(witness.witnessId, now),
      /Invariant 6 Violation/
    );
    assert.throws(
      () => authority.markBroadcast(witness.witnessId, 'sig_fake'),
      /Cannot mark BROADCAST for witness/
    );
    assert.throws(
      () => authority.authorizeForSigning(witness.witnessId, 1005, now, { AccountA: 'hash_a' }, { [altCert.lookupTableAddress]: altCert.tableAccountHash }),
      /Invariant 7 Violation: Cannot authorize witness/
    );

    // Simulation validation: CU limit overrun throws
    assert.throws(
      () => authority.certifyExactSimulation(witness.witnessId, {
        success: true,
        unitsConsumed: 250_000, // Exceeds 200_000 CU limit!
        simulatedAtSlot: 1005,
        logs: [],
        simulatedStateHash: 'sim_hash',
      }),
      /Simulation consumed 250000 CU exceeding configured limit 200000/
    );

    // Simulation validation: Failing simulation throws
    assert.throws(
      () => authority.certifyExactSimulation(witness.witnessId, {
        success: false,
        unitsConsumed: 50_000,
        simulatedAtSlot: 1005,
        logs: [],
        simulatedStateHash: 'sim_hash',
      }),
      /Cannot certify failing simulation/
    );

    // Successful simulation transitions to SIMULATED
    authority.certifyExactSimulation(witness.witnessId, {
      success: true,
      unitsConsumed: 120_000,
      simulatedAtSlot: 1005,
      logs: [],
      simulatedStateHash: 'sim_hash_valid',
    });
    assert.equal(witness.stage, 'SIMULATED');

    // Still cannot mark SIGNED or BROADCAST while in SIMULATED stage
    assert.throws(
      () => authority.markSigned(witness.witnessId, now),
      /Invariant 6 Violation/
    );

    // ALT integrity violation fails closed
    assert.throws(
      () => authority.authorizeForSigning(
        witness.witnessId,
        1010,
        now + 100,
        { AccountA: 'hash_a' },
        { [altCert.lookupTableAddress]: 'tampered_alt_hash' }
      ),
      /ALT Integrity Violation/
    );

    // State lease age expiration fails closed
    assert.throws(
      () => authority.authorizeForSigning(
        witness.witnessId,
        1010,
        now + 6000, // Age 6000ms > maxAgeMs 5000ms
        { AccountA: 'hash_a' },
        { [altCert.lookupTableAddress]: altCert.tableAccountHash }
      ),
      /ExecutionStateLease expired/
    );

    // Valid authorization transitions to AUTHORIZED
    const authorized = authority.authorizeForSigning(
      witness.witnessId,
      1010,
      now + 100,
      { AccountA: 'hash_a' },
      { [altCert.lookupTableAddress]: altCert.tableAccountHash }
    );
    assert.equal(authorized.stage, 'AUTHORIZED');

    // Cannot jump to BROADCAST without SIGNED
    assert.throws(
      () => authority.markBroadcast(witness.witnessId, 'sig_fake'),
      /Cannot mark BROADCAST for witness/
    );

    // Mark signed transitions to SIGNED
    const signed = authority.markSigned(witness.witnessId, now + 150);
    assert.equal(signed.stage, 'SIGNED');

    // Mark broadcast transitions to BROADCAST with signature binding
    const broadcast = authority.markBroadcast(witness.witnessId, 'sig_confirmed_on_chain');
    assert.equal(broadcast.stage, 'BROADCAST');
    assert.equal(broadcast.broadcastSignature, 'sig_confirmed_on_chain');
  });
});
