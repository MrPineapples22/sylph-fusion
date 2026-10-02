/**
 * SYLPH FUSION - DURABLE GENERATION FENCE AUTHORITY
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2).
 *
 * Prototype JSON registry. Terminal transitions are quarantined because no
 * trusted chain-evidence authority is implemented. Existing intent IDs cannot
 * be reinitialized. Fresh allocation still lacks multi-process exclusion and
 * must not be treated as a production distributed generation authority.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
export class DurableGenerationFenceAuthority {
    storagePath;
    constructor(storagePath = resolve('data', 'generation-fences.json')) {
        this.storagePath = storagePath;
    }
    async load() {
        try {
            const data = await readFile(this.storagePath, 'utf8');
            return JSON.parse(data);
        }
        catch (e) {
            if (e.code === 'ENOENT') {
                return { entries: {} };
            }
            throw e;
        }
    }
    async save(state) {
        const folder = dirname(this.storagePath);
        await mkdir(folder, { recursive: true });
        const tmp = this.storagePath + '.' + randomUUID() + '.tmp';
        await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
        await rename(tmp, this.storagePath);
    }
    /**
     * Registers Generation 1 only for a never-seen intent. Historical terminal
     * records are tombstones, not permission to reuse an economic intent ID.
     */
    async acquireInitialGeneration(intentId, signature, lastValidBlockHeight) {
        // Persist only bounded, unambiguous own-property identities. In particular,
        // __proto__ assignment on a plain object can disappear during JSON encoding,
        // losing the tombstone and allowing the same economic intent to be reused.
        if (typeof intentId !== 'string' ||
            intentId.length < 1 || intentId.length > 256 ||
            !/^[A-Za-z0-9]/.test(intentId) || /[^A-Za-z0-9._:-]/.test(intentId) ||
            ['__proto__', 'constructor', 'prototype'].includes(intentId.toLowerCase())) {
            throw new Error('INVALID_INTENT_ID: Expected a bounded non-reserved ASCII economic intent identity');
        }
        const state = await this.load();
        const existing = state.entries[intentId];
        if (existing && existing.state === 'ACTIVE') {
            throw new Error("GENERATION_ALREADY_ACTIVE: Intent " + intentId + " is active at Gen " + existing.generation);
        }
        if (Object.hasOwn(state.entries, intentId)) {
            throw new Error('INTENT_ALREADY_REGISTERED: Existing economic intent cannot be reinitialized');
        }
        const now = Date.now();
        const entry = {
            intentId,
            generation: 1,
            signature,
            lastValidBlockHeight,
            state: 'ACTIVE',
            createdAt: now,
            updatedAt: now,
        };
        Object.defineProperty(state.entries, intentId, {
            value: entry, enumerable: true, writable: true, configurable: true,
        });
        await this.save(state);
        return entry;
    }
    /**
     * Terminal transitions are unavailable until a trusted evidence authority is
     * implemented. Legacy certificate objects and checksums grant no authority.
     */
    async advanceGeneration(intentId, newSignature, newLastValidBlockHeight, terminalProof) {
        const state = await this.load();
        const current = state.entries[intentId];
        if (!current) {
            throw new Error("INTENT_NOT_REGISTERED: Cannot advance generation for unregistered intent " + intentId);
        }
        if (!terminalProof || typeof terminalProof === 'number' || !terminalProof.certificateType) {
            throw new Error("TERMINAL_PROOF_REQUIRED: Advancing generation requires a verified NoLandCertificate or FinalizedSettlementCertificate. Raw block height is forbidden.");
        }
        // Reject even manually constructed, checksum-valid no-land records. There
        // is no trusted historical-absence verifier; an unkeyed digest is no proof.
        if (terminalProof.certificateType === 'NO_LAND_CERTIFICATE') {
            throw new Error('NO_LAND_CERTIFICATION_UNAVAILABLE: Cannot advance generation from unverified historical absence');
        }
        throw new Error('TERMINAL_TRANSITION_UNAVAILABLE: Verified settlement authority is not implemented');
    }
    async confirmGeneration(_intentId, _generation) {
        throw new Error('TERMINAL_TRANSITION_UNAVAILABLE: Raw confirmation is not verified settlement evidence');
    }
    async getActiveGeneration(intentId) {
        const state = await this.load();
        const entry = state.entries[intentId];
        return entry?.state === 'ACTIVE' ? entry : undefined;
    }
}
//# sourceMappingURL=durable-generation-fence.js.map