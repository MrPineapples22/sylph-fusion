/**
 * SYLPH FUSION — PROGRAMROOT & STATECODEC PROTOCOL GENERATIONS
 * Specifications: Sections 16 (StateCodec Protocol Generations), 17 (ProgramRoot Binary Identity), 103 (Invariant 15)
 *
 * Invariants:
 * 1. Static program-ID allowlists are insufficient: track program binary hash, loader, upgrade authority, and IDL hash.
 * 2. Any program binary drift:
 *    OPEN -> BLOCK
 *    INCREASE -> BLOCK
 *    until re-certified.
 * 3. Support protocol schema generations (old vs new Pump bonding curve and PumpSwap layouts).
 * 4. AccountLayoutCertificate & ProtocolSchemaLease enforce exact account length, discriminator, and layout generation.
 */
export class ProgramRootAuthority {
    certifiedPrograms = new Map();
    layoutCertificates = new Map();
    activeLeases = new Map();
    /**
     * Registers or updates a certified program binary snapshot.
     */
    registerCertifiedProgram(cert) {
        this.certifiedPrograms.set(cert.programId, cert);
    }
    /**
     * Verifies the observed on-chain binary integrity of a program against its certified root.
     * If binary drift or unexpected upgrade is detected:
     * OPEN -> BLOCK
     * INCREASE -> BLOCK
     */
    verifyProgramIntegrity(programId, observedBinaryHash, observedSlot) {
        const cert = this.certifiedPrograms.get(programId);
        if (!cert) {
            return {
                allowed: false,
                status: 'UNVERIFIED',
                reason: `Program ${programId} has no registered ProgramBinaryCertificate in PROGRAMROOT`
            };
        }
        if (cert.status === 'REVOKED') {
            return {
                allowed: false,
                status: 'REVOKED',
                reason: `Program ${programId} has been revoked by security authority`
            };
        }
        if (cert.binarySha256 !== observedBinaryHash) {
            // Binary drift detected! Fail-closed: block OPEN and INCREASE
            return {
                allowed: false,
                status: 'DRIFTED',
                reason: `CRITICAL: Program ${programId} binary hash drifted! Expected ${cert.binarySha256}, observed ${observedBinaryHash} at slot ${observedSlot}`
            };
        }
        return {
            allowed: true,
            status: 'CERTIFIED'
        };
    }
    /**
     * Registers a certified account layout schema generation for a protocol.
     */
    registerLayoutCertificate(cert) {
        const list = this.layoutCertificates.get(cert.protocol) ?? [];
        // Replace if same accountType and layoutGeneration, or append
        const idx = list.findIndex((c) => c.accountType === cert.accountType && c.layoutGeneration === cert.layoutGeneration);
        if (idx >= 0) {
            list[idx] = cert;
        }
        else {
            list.push(cert);
        }
        this.layoutCertificates.set(cert.protocol, list);
    }
    /**
     * Returns matching layout certificate for an account's observed byte length and discriminator.
     */
    resolveAccountLayout(protocol, accountType, observedLengthBytes, observedDiscriminatorHex) {
        const list = this.layoutCertificates.get(protocol) ?? [];
        return (list.find((c) => c.accountType === accountType &&
            c.accountLengthBytes === observedLengthBytes &&
            c.discriminatorHex.toLowerCase() === observedDiscriminatorHex.toLowerCase()) ?? null);
    }
    /**
     * Issues a renewable ProtocolSchemaLease for the given protocol and slot window.
     */
    acquireSchemaLease(protocol, currentSlot, validitySlots = 300, maintenancePlan) {
        const certs = this.layoutCertificates.get(protocol) ?? [];
        if (certs.length === 0) {
            throw new Error(`Cannot issue ProtocolSchemaLease: protocol ${protocol} has no registered layout certificates`);
        }
        const leaseId = `LEASE-${protocol}-${currentSlot}-${Date.now()}`;
        const expiresAtSlot = currentSlot + validitySlots;
        const lease = {
            leaseId,
            protocol,
            layoutCertificates: [...certs],
            issuedAtSlot: currentSlot,
            expiresAtSlot,
            maintenancePlan,
            isValid: (slot) => slot >= currentSlot && slot <= expiresAtSlot
        };
        this.activeLeases.set(protocol, lease);
        return lease;
    }
}
//# sourceMappingURL=program-root.js.map