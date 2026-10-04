/**
 * SYLPH FUSION — OPPORTUNITY MARKET-X: PRIMAL-DUAL CLEARING ENGINE
 * Specifications: Master Blueprint Section XXX (Multi-Resource Primal-Dual Clearing)
 */
export class PrimalDualClearingEngine {
    clearMarket(bids, capacities) {
        // Sort bids by efficiency: surplus per unit of capital demanded
        const sorted = [...bids].sort((a, b) => {
            const effA = a.expectedSurplusUsd / Math.max(1, a.resourceDemands.CAPITAL);
            const effB = b.expectedSurplusUsd / Math.max(1, b.resourceDemands.CAPITAL);
            return effB - effA;
        });
        const cleared = [];
        const rejected = [];
        const remaining = {};
        const shadowPrices = {};
        const utilization = {};
        const resources = [
            'CAPITAL',
            'EXIT_CAPACITY',
            'TAIL_RISK_CAPACITY',
            'CONCENTRATION_CAPACITY',
            'EXECUTION_BANDWIDTH',
            'FEE_BUDGET',
            'UNKNOWN_SETTLEMENT_CAPACITY',
            'ATTENTION_COMPUTE',
        ];
        for (const r of resources) {
            remaining[r] = capacities[r]?.maxCapacity ?? 1000;
            shadowPrices[r] = 0;
        }
        let totalSurplus = 0;
        for (const bid of sorted) {
            // Check if all resource demands can be accommodated
            let canClear = true;
            for (const r of resources) {
                if (bid.resourceDemands[r] > remaining[r]) {
                    canClear = false;
                    shadowPrices[r] += 0.05; // Shadow price rises under scarcity
                    break;
                }
            }
            if (canClear) {
                cleared.push(bid);
                totalSurplus += bid.expectedSurplusUsd;
                for (const r of resources) {
                    remaining[r] -= bid.resourceDemands[r];
                }
            }
            else {
                rejected.push(bid);
            }
        }
        for (const r of resources) {
            const max = capacities[r]?.maxCapacity ?? 1000;
            const rem = remaining[r];
            utilization[r] = max > 0 ? (max - rem) / max : 0;
        }
        return {
            clearedBids: cleared,
            rejectedBids: rejected,
            shadowPrices,
            totalSurplusExtractedUsd: Number(totalSurplus.toFixed(2)),
            capacityUtilization: utilization,
        };
    }
}
//# sourceMappingURL=primal-dual-clearing.js.map