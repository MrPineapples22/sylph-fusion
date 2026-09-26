export class NavEngine {
    config;
    constructor(config = {
        defaultPerformanceFeeBps: 2000,
        minProfitThresholdLamports: 10000000n,
    }) {
        this.config = config;
    }
    /**
     * Calculates independent NAV and fee eligibility for a vault.
     * Absolute rule: Deposits != Profit, Withdrawals != Loss.
     */
    calculateNav(params) {
        const { vaultId, cashLamports, unrealizedPositionsValueLamports, startingNavLamports, peakNavLamports, highWaterMarkLamports, realizedPnlLamports, frictionCostsLamports, lifetimeFeesPaidLamports, customFeeBps, } = params;
        // Current NAV is the sum of liquid cash + verified market-marked positions
        const currentNavLamports = cashLamports + unrealizedPositionsValueLamports;
        // Peak NAV tracks highest marked value
        const newPeakNav = currentNavLamports > peakNavLamports ? currentNavLamports : peakNavLamports;
        // Calculate drawdown in basis points relative to peak NAV
        let drawdownBps = 0;
        if (newPeakNav > 0n && currentNavLamports < newPeakNav) {
            const drop = newPeakNav - currentNavLamports;
            drawdownBps = Number((drop * 10000n) / newPeakNav);
        }
        // Unrealized PnL is mark value relative to cost basis
        const unrealizedPnlLamports = unrealizedPositionsValueLamports;
        // High-Water Mark Fee Calculation:
        // Profit above HWM is eligible for performance fee
        let eligiblePerformanceFeeLamports = 0n;
        const feeRateBps = customFeeBps ?? this.config.defaultPerformanceFeeBps;
        if (currentNavLamports > highWaterMarkLamports) {
            const netGainAboveHwm = currentNavLamports - highWaterMarkLamports;
            if (netGainAboveHwm >= this.config.minProfitThresholdLamports) {
                eligiblePerformanceFeeLamports = (netGainAboveHwm * BigInt(feeRateBps)) / 10000n;
            }
        }
        // Net settlement value is Current NAV minus pending performance fees
        const netSettlementValueLamports = currentNavLamports > eligiblePerformanceFeeLamports
            ? currentNavLamports - eligiblePerformanceFeeLamports
            : 0n;
        return {
            vaultId,
            timestamp: Date.now(),
            startingNavLamports,
            currentNavLamports,
            peakNavLamports: newPeakNav,
            highWaterMarkLamports,
            drawdownBps,
            realizedPnlLamports,
            unrealizedPnlLamports,
            totalFrictionLamports: frictionCostsLamports,
            platformFeesPaidLamports: lifetimeFeesPaidLamports,
            eligiblePerformanceFeeLamports,
            netSettlementValueLamports,
        };
    }
    /**
     * Applies the performance fee, advancing the High-Water Mark to lock in fee calculation baseline.
     */
    crystallizePerformanceFee(snapshot) {
        const feeLamports = snapshot.eligiblePerformanceFeeLamports;
        if (feeLamports <= 0n) {
            return { feeLamports: 0n, newHwmLamports: snapshot.highWaterMarkLamports };
        }
        // New HWM is set to Current NAV after fee crystallization
        const newHwmLamports = snapshot.currentNavLamports;
        return { feeLamports, newHwmLamports };
    }
}
//# sourceMappingURL=nav-engine.js.map