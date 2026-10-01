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
});
