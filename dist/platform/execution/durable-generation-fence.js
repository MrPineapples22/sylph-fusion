/**
 * SYLPH FUSION - DURABLE GENERATION FENCE AUTHORITY
 * Specifications: Sections 37 (Execution Generations), 103 (Invariants 1, 2).
 *
 * Enforces the core distributed systems invariant:
 *   ONE ECONOMIC INTENT -> AT MOST ONE ACTIVE EXECUTION GENERATION
 *
 * Durable across process restarts, unhandled exceptions, and async cancellations.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { NoLandVerificationAuthority, } from './no-land-certificate.js';
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
     * Registers Generation 1 for a new intent. Throws if active generation already exists.
     */
    async acquireInitialGeneration(intentId, signature, lastValidBlockHeight) {
        const state = await this.load();
        const existing = state.entries[intentId];
        if (existing && existing.state === 'ACTIVE') {
            throw new Error("GENERATION_ALREADY_ACTIVE: Intent " + intentId + " is active at Gen " + existing.generation);
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
        state.entries[intentId] = entry;
        await this.save(state);
        return entry;
    }
    /**
     * Advances generation to N+1 only if previous generation is proven terminated
     * via a verified NoLandCertificate or FinalizedSettlementCertificate.
     * Advancing on block height alone without proof of non-landing is strictly forbidden.
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
        if (terminalProof.intentId !== intentId) {
            throw new Error(`TERMINAL_PROOF_INTENT_MISMATCH: Proof intent ${terminalProof.intentId} !== ${intentId}`);
        }
        if (terminalProof.generation !== current.generation) {
            throw new Error(`TERMINAL_PROOF_GENERATION_MISMATCH: Proof generation ${terminalProof.generation} !== current ${current.generation}`);
        }
        if (!NoLandVerificationAuthority.validateCertificateDigest(terminalProof)) {
            throw new Error("TERMINAL_PROOF_DIGEST_INVALID: Certificate digest validation failed");
        }
        // Safety Invariant: cannot advance if previous generation may still land
        if (terminalProof.certificateType === 'NO_LAND_CERTIFICATE') {
            if (terminalProof.observedBlockHeight <= current.lastValidBlockHeight) {
                throw new Error("FENCE_BREACH_PREVENTED: Generation " + current.generation + " is still in flight (current " + terminalProof.observedBlockHeight + " <= max " + current.lastValidBlockHeight + ")");
            }
        }
        const now = Date.now();
        const nextGen = current.generation + 1;
        const entry = {
            intentId,
            generation: nextGen,
            signature: newSignature,
            lastValidBlockHeight: newLastValidBlockHeight,
            state: 'ACTIVE',
            createdAt: current.createdAt,
            updatedAt: now,
        };
        state.entries[intentId] = entry;
        await this.save(state);
        return entry;
    }
    async confirmGeneration(intentId, generation) {
        const state = await this.load();
        const current = state.entries[intentId];
        if (current && current.generation === generation) {
            state.entries[intentId] = { ...current, state: 'CONFIRMED', updatedAt: Date.now() };
            await this.save(state);
        }
    }
    async getActiveGeneration(intentId) {
        const state = await this.load();
        const entry = state.entries[intentId];
        return entry?.state === 'ACTIVE' ? entry : undefined;
    }
}
//# sourceMappingURL=durable-generation-fence.js.map