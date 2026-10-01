/**
 * SYLPH FUSION — EXACT EXECUTION WITNESS, CAPITAL ENVELOPE & ALT CERTIFICATION
 * Specifications: Sections 26 (Capital Envelope), 31 (StateLease Freshness),
 * 32 (Exact Execution Witness), 33 (ALT Certification), 103 (Invariants 6, 7)
 *
 * Non-negotiable invariants:
 * 1. NO LIVE SIGNATURE WITHOUT AN EXECUTION WITNESS (Invariant 6).
 * 2. NO EXECUTION WITNESS WITHOUT EXACT SIMULATION (Invariant 7).
 * 3. The exact final transaction message must follow:
 *    BUILT -> SIMULATED -> HASHED -> AUTHORIZED -> SIGNED -> BROADCAST
 * 4. Modifying CU limit, priority fee, tip, or accounts after simulation invalidates the witness.
 * 5. ALT change invalidates the build.
 */
import { createHash } from 'node:crypto';
export class WitnessInvariantViolationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WitnessInvariantViolationError';
    }
}
export function createAltCertificate(params) {
    const payload = `${params.lookupTableAddress}:${params.lastExtendedSlot}:${params.tableAccountHash}:${params.resolvedAddresses.join(',')}`;
    const digest = createHash('sha256').update(payload).digest('hex');
    return { ...params, digest };
}
export function createCapitalEnvelope(params) {
    const totalReservedLamports = params.inputPrincipalLamports +
        params.exactNetworkFeeLamports +
        params.priorityFeeLamports +
        params.jitoTipLamports +
        params.protocolFeeLamports +
        params.creatorFeeLamports +
        params.rentReservationLamports +
        params.protocolMaintenanceLamports;
    const payload = `${params.economicIntentId}:${totalReservedLamports.toString()}:${params.exactNetworkFeeLamports}:${params.priorityFeeLamports}:${params.jitoTipLamports}`;
    const digest = createHash('sha256').update(payload).digest('hex');
    const envelopeId = `ENVELOPE-${digest.slice(0, 16)}`;
    return {
        envelopeId,
        economicIntentId: params.economicIntentId,
        inputPrincipalLamports: params.inputPrincipalLamports,
        exactNetworkFeeLamports: params.exactNetworkFeeLamports,
        priorityFeeLamports: params.priorityFeeLamports,
        jitoTipLamports: params.jitoTipLamports,
        protocolFeeLamports: params.protocolFeeLamports,
        creatorFeeLamports: params.creatorFeeLamports,
        rentReservationLamports: params.rentReservationLamports,
        protocolMaintenanceLamports: params.protocolMaintenanceLamports,
        totalReservedLamports,
        isIrreversible: params.isIrreversible ?? false,
        digest
    };
}
export class ExecutionWitnessAuthority {
    activeWitnesses = new Map();
    /**
     * Registers a freshly built transaction message and returns a BUILT witness.
     */
    registerBuiltTransaction(params) {
        const payload = `${params.economicIntentId}:${params.exactMessageHash}:${params.blockhash}:${params.computeUnitsLimit}:${params.capitalEnvelope.digest}`;
        const witnessDigest = createHash('sha256').update(payload).digest('hex');
        const witnessId = `WITNESS-${witnessDigest.slice(0, 16)}`;
        const witness = {
            witnessId,
            stage: 'BUILT',
            economicIntentId: params.economicIntentId,
            exactMessageHash: params.exactMessageHash,
            blockhash: params.blockhash,
            lastValidBlockHeight: params.lastValidBlockHeight,
            accountKeys: [...params.accountKeys],
            programIds: [...params.programIds],
            computeUnitsLimit: params.computeUnitsLimit,
            computeUnitsSimulated: 0,
            altCertificates: [...params.altCertificates],
            capitalEnvelope: params.capitalEnvelope,
            stateLease: params.stateLease,
            modelEpoch: params.modelEpoch,
            simulationResult: {
                success: false,
                unitsConsumed: 0,
                simulatedAtSlot: 0,
                logs: [],
                simulatedStateHash: ''
            },
            witnessDigest
        };
        this.activeWitnesses.set(witnessId, witness);
        return witness;
    }
    /**
     * Attaches exact simulation evidence to the witness. Transitions stage BUILT -> SIMULATED.
     */
    certifyExactSimulation(witnessId, simulation) {
        const witness = this.activeWitnesses.get(witnessId);
        if (!witness) {
            throw new WitnessInvariantViolationError(`Witness ${witnessId} not found`);
        }
        if (witness.stage !== 'BUILT') {
            throw new WitnessInvariantViolationError(`Cannot certify simulation: witness ${witnessId} is in stage ${witness.stage}, expected BUILT`);
        }
        if (!simulation.success) {
            throw new WitnessInvariantViolationError(`Cannot certify failing simulation for witness ${witnessId}: simulation did not succeed`);
        }
        if (simulation.unitsConsumed > witness.computeUnitsLimit) {
            throw new WitnessInvariantViolationError(`Simulation consumed ${simulation.unitsConsumed} CU exceeding configured limit ${witness.computeUnitsLimit}`);
        }
        // Attach simulation and re-seal witnessDigest
        witness.simulationResult = simulation;
        witness.computeUnitsSimulated = simulation.unitsConsumed;
        witness.stage = 'SIMULATED';
        const updatedPayload = `${witness.witnessDigest}:${simulation.unitsConsumed}:${simulation.simulatedStateHash}`;
        witness.witnessDigest = createHash('sha256').update(updatedPayload).digest('hex');
        return witness;
    }
    /**
     * Hashes and validates state lease freshness before authorizing for signing.
     * Transitions stage SIMULATED -> AUTHORIZED.
     */
    authorizeForSigning(witnessId, currentSlot, nowMs, observedAccountHashes, observedAltHashes) {
        const witness = this.activeWitnesses.get(witnessId);
        if (!witness) {
            throw new WitnessInvariantViolationError(`Witness ${witnessId} not found`);
        }
        if (witness.stage !== 'SIMULATED') {
            throw new WitnessInvariantViolationError(`Invariant 7 Violation: Cannot authorize witness ${witnessId} in stage ${witness.stage}. Must be SIMULATED.`);
        }
        // 1. Verify StateLease Freshness (Section 31)
        const lease = witness.stateLease;
        if (nowMs - lease.leasedAtMs > lease.maxAgeMs) {
            throw new WitnessInvariantViolationError(`ExecutionStateLease expired for witness ${witnessId}: age ${nowMs - lease.leasedAtMs}ms exceeds max ${lease.maxAgeMs}ms`);
        }
        // Verify slot boundary
        if (currentSlot < lease.snapshotSlot || currentSlot > lease.snapshotSlot + 300) {
            throw new WitnessInvariantViolationError(`Slot boundary violation for witness ${witnessId}: currentSlot ${currentSlot} outside allowed window [${lease.snapshotSlot}, ${lease.snapshotSlot + 300}]`);
        }
        // Verify critical account hashes have not drifted (fail closed on missing observation)
        for (const [acc, expectedHash] of Object.entries(lease.criticalAccountHashes)) {
            const observed = observedAccountHashes[acc];
            if (!observed || observed !== expectedHash) {
                throw new WitnessInvariantViolationError(`State drift on account ${acc} for witness ${witnessId}: expected ${expectedHash}, observed ${observed ?? 'MISSING'}`);
            }
        }
        // 2. Verify ALT Certification (Section 33) (fail closed on missing observation)
        for (const alt of witness.altCertificates) {
            const observedAltHash = observedAltHashes[alt.lookupTableAddress];
            if (!observedAltHash || observedAltHash !== alt.tableAccountHash) {
                throw new WitnessInvariantViolationError(`ALT Integrity Violation on table ${alt.lookupTableAddress}: expected hash ${alt.tableAccountHash}, observed ${observedAltHash ?? 'MISSING'}`);
            }
        }
        witness.stage = 'AUTHORIZED';
        witness.authorizedAtMs = nowMs;
        return witness;
    }
    /**
     * Confirms signature application. Transitions stage AUTHORIZED -> SIGNED.
     * Invariant 6: Cannot sign without stage AUTHORIZED.
     */
    markSigned(witnessId, nowMs) {
        const witness = this.activeWitnesses.get(witnessId);
        if (!witness) {
            throw new WitnessInvariantViolationError(`Witness ${witnessId} not found`);
        }
        if (witness.stage !== 'AUTHORIZED') {
            throw new WitnessInvariantViolationError(`Invariant 6 Violation: Cannot mark SIGNED for witness ${witnessId} in stage ${witness.stage}. Must be AUTHORIZED.`);
        }
        witness.stage = 'SIGNED';
        witness.signedAtMs = nowMs;
        return witness;
    }
    /**
     * Confirms broadcast signature. Transitions stage SIGNED -> BROADCAST.
     */
    markBroadcast(witnessId, transactionSignature) {
        const witness = this.activeWitnesses.get(witnessId);
        if (!witness) {
            throw new WitnessInvariantViolationError(`Witness ${witnessId} not found`);
        }
        if (witness.stage !== 'SIGNED') {
            throw new WitnessInvariantViolationError(`Cannot mark BROADCAST for witness ${witnessId} in stage ${witness.stage}. Must be SIGNED.`);
        }
        witness.stage = 'BROADCAST';
        witness.broadcastSignature = transactionSignature;
        return witness;
    }
}
//# sourceMappingURL=execution-witness.js.map