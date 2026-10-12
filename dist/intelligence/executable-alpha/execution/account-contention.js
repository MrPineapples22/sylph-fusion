/**
 * SYLPH FUSION — ACCOUNT CONTENTION ENGINE & WRITE-LOCK HEATMAP
 * Study 40: ACCOUNT-CONTENTION-X (Section XVIII)
 *
 * Models write-lock contention across critical accounts in the transaction instruction set.
 * In Solana Sealevel runtime, parallel execution is serialized when transactions compete
 * for the same writable accounts (pool vault, bonding curve state, market authority).
 *
 * Provides granular account-level write contention heatmaps, Sealevel scheduler conflict
 * probabilities, and fee preemption thresholds to ensure transactions are scheduled ahead
 * of toxic sandwich bots and contending swarms.
 */
export class AccountContentionEngine {
    static analyzeContention(params) {
        const { writableAccountPubkeys, poolOpsPerSec, globalCongestionLevel } = params;
        const count = writableAccountPubkeys.length;
        // Poisson collision probability: P(collision) = 1 - exp(-\lambda * t)
        const slotDurationSec = 0.4;
        const lambda = (poolOpsPerSec / 100.0) * count;
        const collisionProb = Math.min(0.95, 1.0 - Math.exp(-lambda * slotDurationSec * (1 + globalCongestionLevel)));
        const waitSlots = collisionProb > 0.60 ? 2 : (collisionProb > 0.25 ? 1 : 0);
        const heatmap = AccountContentionEngine.generateHeatmap({
            writableAccountPubkeys,
            basePoolOpsPerSec: poolOpsPerSec,
            globalCongestionLevel,
        });
        return {
            contestedAccountCount: count,
            maxContentionPerAccountOpsPerSec: poolOpsPerSec,
            lockCollisionProbability: collisionProb,
            estimatedWaitSlots: waitSlots,
            requiresContentionMitigation: collisionProb > 0.40,
            heatmap,
        };
    }
    static generateHeatmap(params) {
        const { writableAccountPubkeys, basePoolOpsPerSec, globalCongestionLevel = 0.2, accountRoleOverrides = {}, } = params;
        const metrics = writableAccountPubkeys.map((pubkey, idx) => {
            // Determine role: default 0=POOL_STATE, 1=BASE_VAULT, 2=FEE_PAYER
            let role = 'PROGRAM_STATE';
            if (accountRoleOverrides[pubkey]) {
                role = accountRoleOverrides[pubkey];
            }
            else if (idx === 0) {
                role = 'POOL_STATE';
            }
            else if (idx === 1) {
                role = 'BASE_VAULT';
            }
            else if (idx === writableAccountPubkeys.length - 1) {
                role = 'FEE_PAYER';
            }
            // Weight ops per sec by role
            let roleMultiplier = 0.3;
            if (role === 'POOL_STATE')
                roleMultiplier = 1.0;
            else if (role === 'BASE_VAULT' || role === 'QUOTE_VAULT')
                roleMultiplier = 0.85;
            else if (role === 'FEE_PAYER')
                roleMultiplier = 0.10;
            const accountOps = Math.max(0, basePoolOpsPerSec * roleMultiplier * (1 + globalCongestionLevel * 0.5));
            let tier = 'COLD';
            let preemptionFee = 10_000;
            let estWaitMs = 5;
            if (accountOps >= 150) {
                tier = 'CRITICAL_SATURATED';
                preemptionFee = 2_500_000;
                estWaitMs = 1200;
            }
            else if (accountOps >= 50) {
                tier = 'HOT';
                preemptionFee = 850_000;
                estWaitMs = 450;
            }
            else if (accountOps >= 15) {
                tier = 'WARM';
                preemptionFee = 150_000;
                estWaitMs = 120;
            }
            // Conflict probability for single account
            const pConflict = Math.min(0.99, 1.0 - Math.exp(-(accountOps / 100.0) * 0.4));
            return {
                pubkey,
                role,
                opsPerSec: Math.round(accountOps * 10) / 10,
                contentionTier: tier,
                lockWaitTimeEstMs: estWaitMs,
                conflictProbability: pConflict,
                preemptionFeeMicroLamports: preemptionFee,
            };
        });
        // Find hottest account
        let hottest = metrics[0] || {
            pubkey: 'unknown',
            role: 'POOL_STATE',
            opsPerSec: 0,
            contentionTier: 'COLD',
            lockWaitTimeEstMs: 0,
            conflictProbability: 0,
            preemptionFeeMicroLamports: 0,
        };
        let maxOps = 0;
        let saturatedCount = 0;
        for (const m of metrics) {
            if (m.opsPerSec > maxOps) {
                maxOps = m.opsPerSec;
                hottest = m;
            }
            if (m.contentionTier === 'HOT' || m.contentionTier === 'CRITICAL_SATURATED') {
                saturatedCount++;
            }
        }
        const saturationRatio = metrics.length > 0 ? saturatedCount / metrics.length : 0;
        const highestTier = hottest.contentionTier;
        // Combined scheduler conflict: 1 - \prod (1 - P(conflict_i))
        let nonConflictProduct = 1.0;
        for (const m of metrics) {
            nonConflictProduct *= (1.0 - m.conflictProbability);
        }
        const parallelSchedulerConflictProb = Math.min(0.99, Math.max(0, 1.0 - nonConflictProduct));
        const recFee = Math.max(50_000, hottest.preemptionFeeMicroLamports);
        const isSchedulerSaturated = highestTier === 'CRITICAL_SATURATED' || parallelSchedulerConflictProb > 0.80;
        return {
            accounts: metrics,
            hottestAccount: hottest,
            highestContentionTier: highestTier,
            maxOpsPerSec: maxOps,
            saturationRatio,
            parallelSchedulerConflictProb,
            recommendedPreemptionFeeMicroLamports: recFee,
            isSchedulerSaturated,
        };
    }
}
//# sourceMappingURL=account-contention.js.map