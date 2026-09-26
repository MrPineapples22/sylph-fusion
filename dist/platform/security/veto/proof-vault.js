/**
 * PHASE 34, 30 & 36 — PROOFVAULT, PROOF-DEATH & CAUSAL TRANSITION DELTA-CERT
 *
 * Implements:
 * - Content-addressed immutable storage for HardVetoProofs and evidence dependencies
 * - ProofDeathCertificate generation (kills dead proofs permanently)
 * - CausalTransitionCertificate (VETO Δ-CERT) ensuring no spontaneous state transitions
 */
import { sha256Hex, } from './types.js';
export class ProofVault {
    proofsByHash = new Map();
    evidenceByHash = new Map();
    deathCertificates = new Map();
    transitionCertificates = [];
    storeProof(proof, dependencies) {
        this.proofsByHash.set(proof.proofHash, proof);
        for (const root of dependencies) {
            this.evidenceByHash.set(root.rawBytesHash, root);
        }
    }
    getProof(proofHash) {
        return this.proofsByHash.get(proofHash);
    }
    getAllActiveProofs() {
        return Array.from(this.proofsByHash.values()).filter((p) => p.status === 'ACTIVE');
    }
    getProofCount() {
        return this.proofsByHash.size;
    }
    verifyProofReconstructability(proofHash) {
        const proof = this.proofsByHash.get(proofHash);
        if (!proof)
            return { isReconstructable: false, missingDependencyCount: 1 };
        let missing = 0;
        for (const evId of proof.evidenceIds) {
            let found = false;
            for (const root of this.evidenceByHash.values()) {
                if (root.evidenceId === evId) {
                    found = true;
                    break;
                }
            }
            if (!found)
                missing++;
        }
        return {
            isReconstructable: missing === 0,
            missingDependencyCount: missing,
        };
    }
    /**
     * Produces an irreversible ProofDeathCertificate.
     */
    killProof(proof, reason, killedAtSlot, causalEvidenceId) {
        const deathCertificateId = `pdc_${proof.proofId}_${killedAtSlot}`;
        const unsigned = {
            deathCertificateId,
            deadProofId: proof.proofId,
            deadProofHash: proof.proofHash,
            subject: proof.subject,
            deathReason: reason,
            causalWitnessEvidenceId: causalEvidenceId,
            killedAtSlot,
        };
        const deathCert = Object.freeze({
            ...unsigned,
            certificateHash: sha256Hex(unsigned),
        });
        this.deathCertificates.set(proof.proofId, deathCert);
        // Update in-memory proof status to DEAD
        const updatedProof = {
            ...proof,
            status: 'DEAD',
        };
        this.proofsByHash.set(proof.proofHash, updatedProof);
        return deathCert;
    }
    getDeathCertificate(proofId) {
        return this.deathCertificates.get(proofId);
    }
    /**
     * Records a CausalTransitionCertificate (VETO Δ-CERT).
     */
    recordTransition(subject, previousState, nextState, trigger, slot, causalEvidenceId) {
        const deltaCertId = `dtc_${subject.mint}_${slot}_${Date.now()}`;
        const unsigned = {
            deltaCertId,
            subject,
            previousState,
            nextState,
            trigger,
            causalEvidenceId,
            slot,
        };
        const cert = Object.freeze({
            ...unsigned,
            certHash: sha256Hex(unsigned),
        });
        this.transitionCertificates.push(cert);
        return cert;
    }
}
//# sourceMappingURL=proof-vault.js.map