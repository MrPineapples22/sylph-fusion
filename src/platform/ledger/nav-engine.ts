export interface NavSnapshot {
  vaultId: string;
  timestamp: number;
  startingNavLamports: bigint;
  currentNavLamports: bigint;
  peakNavLamports: bigint;
  highWaterMarkLamports: bigint;
  drawdownBps: number;
  realizedPnlLamports: bigint;
  unrealizedPnlLamports: bigint;
  totalFrictionLamports: bigint;
  platformFeesPaidLamports: bigint;
  eligiblePerformanceFeeLamports: bigint;
  netSettlementValueLamports: bigint;
}

export interface NavEngineConfig {
  defaultPerformanceFeeBps: number; // e.g. 2000 = 20% performance fee
  minProfitThresholdLamports: bigint; // e.g. 10_000_000n = 0.01 SOL min profit before fee
}

export class NavEngine {
  constructor(private config: NavEngineConfig = {
    defaultPerformanceFeeBps: 2000,
    minProfitThresholdLamports: 10_000_000n,
  }) {}

  /**
   * Calculates independent NAV and fee eligibility for a vault.
   * Absolute rule: Deposits != Profit, Withdrawals != Loss.
   */
  calculateNav(params: {
    vaultId: string;
    cashLamports: bigint;
    unrealizedPositionsValueLamports: bigint;
    startingNavLamports: bigint;
    peakNavLamports: bigint;
    highWaterMarkLamports: bigint;
    realizedPnlLamports: bigint;
    frictionCostsLamports: bigint;
    lifetimeFeesPaidLamports: bigint;
    customFeeBps?: number;
  }): NavSnapshot {
    const {
      vaultId,
      cashLamports,
      unrealizedPositionsValueLamports,
      startingNavLamports,
      peakNavLamports,
      highWaterMarkLamports,
      realizedPnlLamports,
      frictionCostsLamports,
      lifetimeFeesPaidLamports,
      customFeeBps,
    } = params;

    // Current NAV is the sum of liquid cash + verified market-marked positions
    const currentNavLamports = cashLamports + unrealizedPositionsValueLamports;

    // Peak NAV tracks highest marked value
    const newPeakNav = currentNavLamports > peakNavLamports ? currentNavLamports : peakNavLamports;

    // Calculate drawdown in basis points relative to peak NAV
    let drawdownBps = 0;
    if (newPeakNav > 0n && currentNavLamports < newPeakNav) {
      const drop = newPeakNav - currentNavLamports;
      drawdownBps = Number((drop * 10_000n) / newPeakNav);
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
        eligiblePerformanceFeeLamports = (netGainAboveHwm * BigInt(feeRateBps)) / 10_000n;
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
  crystallizePerformanceFee(
    snapshot: NavSnapshot
  ): { feeLamports: bigint; newHwmLamports: bigint } {
    const feeLamports = snapshot.eligiblePerformanceFeeLamports;
    if (feeLamports <= 0n) {
      return { feeLamports: 0n, newHwmLamports: snapshot.highWaterMarkLamports };
    }

    // New HWM is set to Current NAV after fee crystallization
    const newHwmLamports = snapshot.currentNavLamports;
    return { feeLamports, newHwmLamports };
  }
}
