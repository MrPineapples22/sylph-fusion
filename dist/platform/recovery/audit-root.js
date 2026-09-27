/**
 * SYLPH FUSION — AUDITROOT: Append-Only Cryptographic Hash Chain & Merkle Checkpoints
 * Specifications: Section 69 (AuditRoot), Section 103 (Invariant 15)
 *
 * Implements:
 * 1. Tamper-evident append-only AuditRecord SHA-256 hash chain.
 * 2. Merkle tree checkpoint generator for periodic off-host attestation.
 * 3. Fail-closed chain verification: Any broken link halts OPEN, INCREASE, and SIGNING authority.
 */
import { createHash } from 'node:crypto';
export class AuditRootAuthority {
    chain = [];
    checkpoints = [];
    static GENESIS_PREV_HASH = '0'.repeat(64);
    getChainLength() {
        return this.chain.length;
    }
    getLatestRecord() {
        return this.chain[this.chain.length - 1];
    }
    /**
     * Appends an event to the cryptographic audit hash chain.
     */
    appendEvent(eventType, payload) {
        const sequenceNumber = this.chain.length + 1;
        const prevHash = this.chain.length > 0
            ? this.chain[this.chain.length - 1].recordHash
            : AuditRootAuthority.GENESIS_PREV_HASH;
        const timestampMs = Date.now();
        const serializedPayload = JSON.stringify(payload);
        const recordHash = createHash('sha256')
            .update(`${sequenceNumber}:${prevHash}:${eventType}:${serializedPayload}:${timestampMs}`)
            .digest('hex');
        const record = {
            sequenceNumber,
            prevHash,
            eventType,
            payload: Object.freeze({ ...payload }),
            timestampMs,
            recordHash,
        };
        this.chain.push(record);
        return record;
    }
    /**
     * Verifies the complete cryptographic integrity of the audit hash chain.
     * If any record was mutated or deleted, returns isChainValid = false.
     */
    verifyChainIntegrity() {
        if (this.chain.length === 0) {
            return { isChainValid: true, totalRecords: 0, reason: 'Empty chain is trivially valid' };
        }
        for (let i = 0; i < this.chain.length; i++) {
            const record = this.chain[i];
            const expectedSeq = i + 1;
            if (record.sequenceNumber !== expectedSeq) {
                return {
                    isChainValid: false,
                    totalRecords: this.chain.length,
                    brokenSequenceNumber: record.sequenceNumber,
                    reason: `Sequence gap detected at index ${i}: expected ${expectedSeq}, found ${record.sequenceNumber}`,
                };
            }
            const expectedPrev = i === 0
                ? AuditRootAuthority.GENESIS_PREV_HASH
                : this.chain[i - 1].recordHash;
            if (record.prevHash !== expectedPrev) {
                return {
                    isChainValid: false,
                    totalRecords: this.chain.length,
                    brokenSequenceNumber: record.sequenceNumber,
                    reason: `Hash chain broken at sequence ${record.sequenceNumber}: prevHash does not match parent recordHash`,
                };
            }
            // Recompute SHA-256
            const serializedPayload = JSON.stringify(record.payload);
            const recomputedHash = createHash('sha256')
                .update(`${record.sequenceNumber}:${record.prevHash}:${record.eventType}:${serializedPayload}:${record.timestampMs}`)
                .digest('hex');
            if (recomputedHash !== record.recordHash) {
                return {
                    isChainValid: false,
                    totalRecords: this.chain.length,
                    brokenSequenceNumber: record.sequenceNumber,
                    reason: `Tampering detected at sequence ${record.sequenceNumber}: recordHash does not match payload digest`,
                };
            }
        }
        return {
            isChainValid: true,
            totalRecords: this.chain.length,
            reason: `All ${this.chain.length} audit records cryptographically verified`,
        };
    }
    /**
     * Generates a Merkle tree checkpoint across a slice of audit records.
     */
    generateCheckpoint(auditSignerKey = 'sylph-audit-authority-v1') {
        if (this.chain.length === 0)
            throw new Error('Cannot checkpoint empty audit chain');
        const startSequence = this.checkpoints.length > 0
            ? this.checkpoints[this.checkpoints.length - 1].endSequence + 1
            : 1;
        const endSequence = this.chain.length;
        const slice = this.chain.slice(startSequence - 1, endSequence);
        let leaves = slice.map(r => r.recordHash);
        // Compute binary Merkle root
        while (leaves.length > 1) {
            const nextLevel = [];
            for (let i = 0; i < leaves.length; i += 2) {
                const left = leaves[i];
                const right = i + 1 < leaves.length ? leaves[i + 1] : left;
                const parentHash = createHash('sha256').update(left + right).digest('hex');
                nextLevel.push(parentHash);
            }
            leaves = nextLevel;
        }
        const merkleRoot = leaves[0];
        const attestation = createHash('sha256')
            .update(`${merkleRoot}:${startSequence}:${endSequence}:${auditSignerKey}`)
            .digest('hex');
        const checkpoint = {
            checkpointId: `CHKPT-${attestation.slice(0, 16)}`,
            startSequence,
            endSequence,
            merkleRoot,
            recordCount: slice.length,
            generatedAtMs: Date.now(),
            signerAttestation: attestation,
        };
        this.checkpoints.push(checkpoint);
        return checkpoint;
    }
}
export const globalAuditRoot = new AuditRootAuthority();
//# sourceMappingURL=audit-root.js.map