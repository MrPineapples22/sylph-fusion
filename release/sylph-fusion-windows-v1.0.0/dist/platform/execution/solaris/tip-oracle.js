/**
 * SOLARIS-NEXUS: Dynamic Tip & Contention Oracle
 * Streams real-time Jito tip floors (p25-p95) and estimates account-contention priority fees.
 */
export class DynamicTipAndContentionOracle {
    minTip;
    maxTip;
    cacheTtlMs;
    minPriorityMicroLamports;
    maxPriorityMicroLamports;
    cachedTipFloor;
    contentionHistory = new Map();
    constructor(cfg = {}) {
        this.minTip = cfg.minTipLamports ?? 10000n;
        this.maxTip = cfg.maxTipLamports ?? 20000000n;
        this.cacheTtlMs = cfg.cacheTtlMs ?? 2_500;
        this.minPriorityMicroLamports = cfg.minPriorityFeeMicroLamports ?? 50000n;
        this.maxPriorityMicroLamports = cfg.maxPriorityFeeMicroLamports ?? 2500000n;
        // Seed with baseline nominal snapshot
        this.cachedTipFloor = {
            p25Lamports: 10000n,
            p50Lamports: 25000n,
            p75Lamports: 60000n,
            p95Lamports: 250000n,
            polledAtMs: Date.now(),
            isFresh: true,
            source: 'FALLBACK_MANDATE',
        };
    }
    updateTipFloor(p25, p50, p75, p95, source = 'LIVE_API') {
        this.cachedTipFloor = {
            p25Lamports: p25 > 0n ? p25 : this.minTip,
            p50Lamports: p50 >= p25 ? p50 : p25,
            p75Lamports: p75 >= p50 ? p75 : p50,
            p95Lamports: p95 >= p75 ? p95 : p75,
            polledAtMs: Date.now(),
            isFresh: true,
            source,
        };
        return this.cachedTipFloor;
    }
    getTipFloor() {
        const age = Date.now() - this.cachedTipFloor.polledAtMs;
        const isFresh = age <= this.cacheTtlMs;
        return {
            ...this.cachedTipFloor,
            isFresh,
        };
    }
    getRecommendedTip(urgency = 'STANDARD') {
        const floor = this.getTipFloor();
        let targetTip;
        switch (urgency) {
            case 'EMERGENCY_EXIT':
                targetTip = floor.p95Lamports;
                break;
            case 'URGENT_BREAKOUT':
                targetTip = (floor.p75Lamports + floor.p95Lamports) / 2n;
                break;
            case 'STANDARD':
            default:
                targetTip = floor.p75Lamports;
                break;
        }
        if (targetTip < this.minTip)
            targetTip = this.minTip;
        if (targetTip > this.maxTip)
            targetTip = this.maxTip;
        return targetTip;
    }
    registerAccountPrioritizationSamples(accountAddress, feeSamplesMicroLamports) {
        const existing = this.contentionHistory.get(accountAddress) ?? [];
        const merged = [...existing, ...feeSamplesMicroLamports].slice(-150); // retain last 150 slots
        this.contentionHistory.set(accountAddress, merged);
    }
    estimateContention(writeLockedAccounts) {
        const allSamples = [];
        for (const acc of writeLockedAccounts) {
            const samples = this.contentionHistory.get(acc);
            if (samples && samples.length > 0) {
                allSamples.push(...samples);
            }
        }
        if (allSamples.length === 0) {
            return {
                writeLockedAccounts,
                medianFeeMicroLamports: this.minPriorityMicroLamports,
                p75FeeMicroLamports: this.minPriorityMicroLamports,
                p95FeeMicroLamports: this.minPriorityMicroLamports * 2n,
                recommendedMicroLamportsPerCu: this.minPriorityMicroLamports,
                contentionTier: 'NOMINAL',
                polledAtMs: Date.now(),
            };
        }
        allSamples.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const median = allSamples[Math.floor(allSamples.length * 0.5)];
        const p75 = allSamples[Math.floor(allSamples.length * 0.75)];
        const p95 = allSamples[Math.floor(allSamples.length * 0.95)];
        let contentionTier = 'NOMINAL';
        if (p95 > 1500000n) {
            contentionTier = 'CRITICAL';
        }
        else if (p75 > 500000n) {
            contentionTier = 'HIGH';
        }
        else if (median > 100000n) {
            contentionTier = 'ELEVATED';
        }
        let recommended = p75 > this.minPriorityMicroLamports ? p75 : this.minPriorityMicroLamports;
        if (contentionTier === 'CRITICAL') {
            recommended = p95;
        }
        if (recommended > this.maxPriorityMicroLamports) {
            recommended = this.maxPriorityMicroLamports;
        }
        return {
            writeLockedAccounts,
            medianFeeMicroLamports: median,
            p75FeeMicroLamports: p75,
            p95FeeMicroLamports: p95,
            recommendedMicroLamportsPerCu: recommended,
            contentionTier,
            polledAtMs: Date.now(),
        };
    }
    getRecommendedPriorityFee(writeLockedAccounts, urgency = 'STANDARD') {
        const estimate = this.estimateContention(writeLockedAccounts);
        let fee = estimate.recommendedMicroLamportsPerCu;
        if (urgency === 'EMERGENCY_EXIT') {
            fee = estimate.p95FeeMicroLamports * 3n / 2n;
        }
        else if (urgency === 'URGENT_BREAKOUT') {
            fee = estimate.p75FeeMicroLamports * 6n / 5n;
        }
        if (fee < this.minPriorityMicroLamports)
            fee = this.minPriorityMicroLamports;
        if (fee > this.maxPriorityMicroLamports)
            fee = this.maxPriorityMicroLamports;
        return { priorityMicroLamports: fee, contentionTier: estimate.contentionTier };
    }
}
//# sourceMappingURL=tip-oracle.js.map