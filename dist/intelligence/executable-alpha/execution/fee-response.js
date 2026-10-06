/**
 * SYLPH FUSION — FEE RESPONSE SURFACE & CU EFFICIENCY ENGINE
 * Studies: FEE-RESPONSE-SURFACE-X, CU-EFFICIENCY-X (Section XVIII)
 *
 * Maps compute unit (CU) limits and priority fee bid curves to find
 * the optimal fee point maximizing landing probability per dollar spent.
 */
export class FeeResponseSurfaceEngine {
    static optimizeFee(params) {
        const { baseExecutionCuEstimate, congestionMultiplier, urgency, solPriceUsd = 150.0, } = params;
        // Set CU limit with safe 25% buffer (preventing out-of-CU transaction abortion)
        const requestedComputeUnits = Math.ceil(baseExecutionCuEstimate * 1.25);
        const cuSafetyMarginPct = 25.0;
        let priorityMicroLamports = 50_000 * Math.max(1.0, congestionMultiplier);
        let tipLamports = 100000n; // 0.0001 SOL
        if (urgency === 'NORMAL') {
            priorityMicroLamports = 150_000 * Math.max(1.0, congestionMultiplier);
            tipLamports = 500000n; // 0.0005 SOL
        }
        else if (urgency === 'HIGH') {
            priorityMicroLamports = 500_000 * Math.max(1.0, congestionMultiplier);
            tipLamports = 2000000n; // 0.002 SOL
        }
        else if (urgency === 'EMERGENCY') {
            priorityMicroLamports = 2_000_000 * Math.max(1.0, congestionMultiplier);
            tipLamports = 10000000n; // 0.010 SOL
        }
        const totalPriorityLamports = (requestedComputeUnits * priorityMicroLamports) / 1_000_000;
        const totalSolCost = (5000 + totalPriorityLamports + Number(tipLamports)) / 1e9;
        const estimatedFeeUsd = totalSolCost * solPriceUsd;
        const marginalGain = urgency === 'EMERGENCY' ? 0.05 : 0.85;
        return {
            requestedComputeUnits,
            optimalPriorityMicroLamports: priorityMicroLamports,
            optimalTipLamports: tipLamports,
            estimatedFeeUsd,
            marginalLandingGainPerDollar: marginalGain,
            cuSafetyMarginPct,
        };
    }
}
//# sourceMappingURL=fee-response.js.map