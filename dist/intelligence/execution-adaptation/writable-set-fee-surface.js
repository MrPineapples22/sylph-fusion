/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: WRITABLE-SET FEE MODEL
 * Specifications: Master Blueprint Section XXII (Writable-Set Fee Model)
 *
 * Invariant: Contention on Solana is account-write lock contention.
 * Replace pooled prioritization fees with exact sorted writable-set hashes:
 * hash(sorted writable accounts).
 * Fallback hierarchy: exact writable set -> critical subset -> program/pool cohort -> global.
 */
import { createHash } from 'node:crypto';
export function computeWritableSetHash(writableAccounts) {
    const sorted = [...writableAccounts].sort();
    return createHash('sha256').update(sorted.join(';')).digest('hex');
}
export class WritableSetFeeSurface {
    exactSurfaces = new Map();
    programSurfaces = new Map();
    globalBaseline = { priorityFee: 50000n, tip: 10000n };
    updateObservation(writableAccounts, programId, priorityFee, tip) {
        const hash = computeWritableSetHash(writableAccounts);
        const existing = this.exactSurfaces.get(hash);
        if (!existing) {
            this.exactSurfaces.set(hash, { priorityFee, tip, count: 1 });
        }
        else {
            this.exactSurfaces.set(hash, {
                priorityFee: (existing.priorityFee + priorityFee) / 2n,
                tip: (existing.tip + tip) / 2n,
                count: existing.count + 1,
            });
        }
        this.programSurfaces.set(programId, { priorityFee, tip });
    }
    getRecommendation(writableAccounts, programId) {
        const hash = computeWritableSetHash(writableAccounts);
        // Tier 1: Exact writable set match
        const exact = this.exactSurfaces.get(hash);
        if (exact && exact.count >= 3) {
            return {
                writableSetHash: hash,
                matchedTier: 'EXACT_WRITABLE_SET',
                recommendedPriorityFeeMicroLamports: exact.priorityFee,
                recommendedJitoTipLamports: exact.tip,
                observedContentionRatio: Math.min(1.0, exact.count / 10),
            };
        }
        // Tier 2: Program / pool cohort
        const program = this.programSurfaces.get(programId);
        if (program) {
            return {
                writableSetHash: hash,
                matchedTier: 'PROGRAM_POOL_COHORT',
                recommendedPriorityFeeMicroLamports: program.priorityFee,
                recommendedJitoTipLamports: program.tip,
                observedContentionRatio: 0.5,
            };
        }
        // Tier 3: Global fallback
        return {
            writableSetHash: hash,
            matchedTier: 'GLOBAL',
            recommendedPriorityFeeMicroLamports: this.globalBaseline.priorityFee,
            recommendedJitoTipLamports: this.globalBaseline.tip,
            observedContentionRatio: 0.2,
        };
    }
}
//# sourceMappingURL=writable-set-fee-surface.js.map