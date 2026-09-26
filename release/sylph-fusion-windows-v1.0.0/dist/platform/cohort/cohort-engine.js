export class CohortEngine {
    /**
     * Groups vault requests into a deterministic trade cohort and applies fair pro-rata allocation.
     */
    createCohort(cohortId, mint, requests, approvedMarketCapacityLamports) {
        if (requests.length === 0) {
            throw new Error('Cannot create cohort with zero vault requests');
        }
        const totalRequested = requests.reduce((sum, r) => sum + r.authorizedAmountLamports, 0n);
        let totalAllocated = 0n;
        const allocations = [];
        if (totalRequested <= approvedMarketCapacityLamports) {
            // Full allocation possible for all participating vaults
            for (const req of requests) {
                allocations.push({
                    vaultId: req.vaultId,
                    allocatedCapitalLamports: req.authorizedAmountLamports,
                    allocationPct: totalRequested > 0n
                        ? Number((req.authorizedAmountLamports * 10000n) / totalRequested) / 100
                        : 0,
                });
                totalAllocated += req.authorizedAmountLamports;
            }
        }
        else {
            // Scaled pro-rata allocation capped by approved market exit capacity
            let remainingDust = approvedMarketCapacityLamports;
            for (let i = 0; i < requests.length; i++) {
                const req = requests[i];
                let share = (req.authorizedAmountLamports * approvedMarketCapacityLamports) / totalRequested;
                // Last element gets exact remainder to guarantee zero dust loss
                if (i === requests.length - 1) {
                    share = remainingDust;
                }
                else {
                    remainingDust -= share;
                }
                allocations.push({
                    vaultId: req.vaultId,
                    allocatedCapitalLamports: share,
                    allocationPct: approvedMarketCapacityLamports > 0n
                        ? Number((share * 10000n) / approvedMarketCapacityLamports) / 100
                        : 0,
                });
                totalAllocated += share;
            }
        }
        return {
            cohortId,
            mint,
            totalRequestedCapitalLamports: totalRequested,
            approvedMarketCapacityLamports,
            totalAllocatedCapitalLamports: totalAllocated,
            allocations,
            executed: false,
            createdAt: Date.now(),
        };
    }
    /**
     * Distributes actual aggregate trade execution fill proportionally across cohort vaults.
     * Enforces exact integer conservation: Sum(Distributed Tokens) == Total Tokens Filled.
     */
    distributeExecutionFill(cohort, actualTotalTokensFilled, actualTotalLamportsSpent) {
        if (cohort.executed) {
            throw new Error(`Cohort ${cohort.cohortId} has already been executed`);
        }
        if (cohort.totalAllocatedCapitalLamports <= 0n) {
            throw new Error('Cannot distribute fill on cohort with zero allocated capital');
        }
        let remainingTokens = actualTotalTokensFilled;
        let remainingLamports = actualTotalLamportsSpent;
        const vwap = actualTotalTokensFilled > 0n
            ? Number(actualTotalLamportsSpent) / Number(actualTotalTokensFilled)
            : 0;
        for (let i = 0; i < cohort.allocations.length; i++) {
            const alloc = cohort.allocations[i];
            let vaultTokens = (actualTotalTokensFilled * alloc.allocatedCapitalLamports) / cohort.totalAllocatedCapitalLamports;
            let vaultLamports = (actualTotalLamportsSpent * alloc.allocatedCapitalLamports) / cohort.totalAllocatedCapitalLamports;
            if (i === cohort.allocations.length - 1) {
                vaultTokens = remainingTokens;
                vaultLamports = remainingLamports;
            }
            else {
                remainingTokens -= vaultTokens;
                remainingLamports -= vaultLamports;
            }
            alloc.tokensFilled = vaultTokens;
            alloc.netLamportsSpent = vaultLamports;
            alloc.vwapPriceSolPerToken = vwap;
        }
        cohort.executed = true;
        cohort.actualTotalTokensFilled = actualTotalTokensFilled;
        cohort.actualTotalLamportsSpent = actualTotalLamportsSpent;
        cohort.aggregateVwap = vwap;
        return cohort;
    }
}
//# sourceMappingURL=cohort-engine.js.map