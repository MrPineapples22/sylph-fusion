/**
 * PHASE 27, 28, 29, 30 & 31 — VETO NOTARY, TCB, SERVICEROOT, QUORUM & CRYPTO-EPOCH
 *
 * Implements:
 * - Isolated Veto Notary verifying proof references and reconstructing canonical payloads
 * - VETO-TCB: Trusted Computing Base measurement (releaseHash, kernelHash, registryHash)
 * - SERVICEROOT: Cryptographic internal workload authentication (models/UI cannot sign)
 * - VETO QUORUM: M-of-N threshold notary architecture across failure domains
 * - CRYPTO-EPOCH: Cryptographic agility suite specifications
 */
import { sha256Hex } from './types.js';
export class VetoNotaryNode {
    notaryId;
    failureDomainId;
    declaredTcb;
    cryptoSuite;
    isArmed = false;
    certifiedTcbHash;
    constructor(notaryId, failureDomainId, declaredTcb, cryptoSuite) {
        this.notaryId = notaryId;
        this.failureDomainId = failureDomainId;
        this.declaredTcb = declaredTcb;
        this.cryptoSuite = cryptoSuite;
        this.certifiedTcbHash = sha256Hex(declaredTcb);
    }
    armNotary(runtimeTcb) {
        const runtimeHash = sha256Hex(runtimeTcb);
        if (runtimeHash === this.certifiedTcbHash && this.cryptoSuite.status === 'ACTIVE') {
            this.isArmed = true;
            return true;
        }
        this.isArmed = false;
        return false;
    }
    /**
     * Attests a HardVetoProof.
     * STRICT GATES:
     * 1. Notary must be ARMED (TCB matches certified release)
     * 2. Caller must have SERVICEROOT PRIVILEGED_SAFETY_ATTESTATION capability
     * 3. Proof status must be ACTIVE
     */
    attestProof(proof, caller) {
        if (!this.isArmed) {
            return { success: false, rejectionReason: 'Notary is DISARMED: TCB mismatch or suite inactive' };
        }
        if (caller.role !== 'TOKEN_SAFETY_AUTHORITY' || caller.capability !== 'PRIVILEGED_SAFETY_ATTESTATION') {
            return { success: false, rejectionReason: `Unauthorized workload: ${caller.serviceId} with role ${caller.role}` };
        }
        if (proof.status !== 'ACTIVE') {
            return { success: false, rejectionReason: `Cannot attest non-active proof (status: ${proof.status})` };
        }
        const attestationId = `att_${this.notaryId}_${proof.proofId}`;
        const payloadToSign = {
            attestationId,
            proofHash: proof.proofHash,
            notaryId: this.notaryId,
            failureDomainId: this.failureDomainId,
            suiteId: this.cryptoSuite.suiteId,
            tcbHash: this.certifiedTcbHash,
            slot: proof.bank.slot,
        };
        const signature = sha256Hex({ ...payloadToSign, keyEpoch: this.cryptoSuite.keyEpoch });
        const attestation = {
            attestationId,
            proofHash: proof.proofHash,
            notaryId: this.notaryId,
            failureDomainId: this.failureDomainId,
            cryptoSuite: this.cryptoSuite,
            tcbHash: this.certifiedTcbHash,
            attestedAtSlot: proof.bank.slot,
            signature,
        };
        return { success: true, attestation };
    }
}
export class VetoQuorumEngine {
    notaries;
    threshold;
    constructor(notaries, threshold // e.g. 3 of 5
    ) {
        this.notaries = notaries;
        this.threshold = threshold;
    }
    /**
     * Evaluates threshold notary attestations across distinct failure domains.
     */
    verifyQuorum(proof, caller) {
        const attestations = [];
        const domains = new Set();
        for (const notary of this.notaries) {
            const res = notary.attestProof(proof, caller);
            if (res.success && res.attestation) {
                attestations.push(res.attestation);
                domains.add(res.attestation.failureDomainId);
            }
        }
        const uniqueDomains = Array.from(domains);
        const quorumAchieved = attestations.length >= this.threshold && uniqueDomains.length >= this.threshold;
        if (!quorumAchieved) {
            return {
                quorumAchieved: false,
                attestations,
                uniqueDomains,
                rejectionReason: `Quorum failed: required ${this.threshold} distinct domains, got ${uniqueDomains.length}`,
            };
        }
        return {
            quorumAchieved: true,
            attestations,
            uniqueDomains,
        };
    }
}
//# sourceMappingURL=notary.js.map