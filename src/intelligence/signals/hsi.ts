/**
 * SOL-SYLPH Master Production Intelligence - Decomposed HSI (Holder Suspicion Index)
 * Specifications: Section 11 (Preserve and Upgrade Existing HSI).
 *
 * Decomposes HSI into 7 distinct evidence families:
 * 1. ParticipationQuality
 * 2. LiquidityQuality
 * 3. TradeDiversity
 * 4. WalletIndependence
 * 5. VelocityQuality
 * 6. SellPressure
 * 7. ManipulationRisk
 */

export interface HsiInputs {
  readonly buyerCount: number;
  readonly uniqueFundingClusters: number;
  readonly realQuoteReservesLamports: bigint;
  readonly virtualTokenReserves: bigint;
  readonly buyCount: number;
  readonly sellCount: number;
  readonly buyVolumeSol: number;
  readonly sellVolumeSol: number;
  readonly tokenAgeSeconds: number;
  readonly creatorNetDeltaPct: number;
  readonly averageTradeSizeSol: number;
  readonly tradeSizeVariance: number;
  readonly bundleParticipantCount?: number;
  readonly vestingRecipientCount?: number;
  readonly topTenHolderConcentrationBps?: number;
}

export interface DecomposedHsiReport {
  readonly compositeHsi: number; // 0 (safest) to 100 (extreme suspicion)
  readonly families: {
    readonly participationQuality: number; // 0 to 100
    readonly liquidityQuality: number;     // 0 to 100
    readonly tradeDiversity: number;       // 0 to 100
    readonly walletIndependence: number;   // 0 to 100
    readonly velocityQuality: number;      // 0 to 100
    readonly sellPressure: number;         // 0 to 100
    readonly manipulationRisk: number;     // 0 to 100
  };
  readonly detectors: {
    readonly bundlerDetected: boolean;
    readonly velocityAnomaly: boolean;
    readonly devDumpingDetected: boolean;
    readonly excessiveConcentration: boolean;
  };
  readonly effectiveIndependentParticipants: number;
  readonly suspicionReason: string;
}

export class DecomposedHsiEngine {
  public evaluate(input: HsiInputs): DecomposedHsiReport {
    if (!input || typeof input !== 'object') throw new Error('HSI_INPUT_INVALID');
    const counts = [input.buyerCount, input.uniqueFundingClusters, input.buyCount, input.sellCount,
      input.bundleParticipantCount ?? 0, input.vestingRecipientCount ?? 0];
    if (counts.some(value => !Number.isSafeInteger(value) || value < 0) ||
        !Number.isSafeInteger(input.buyCount + input.sellCount)) throw new Error('HSI_COUNT_INVALID');
    const nonnegative = [input.buyVolumeSol, input.sellVolumeSol, input.tokenAgeSeconds,
      input.averageTradeSizeSol, input.tradeSizeVariance];
    if (nonnegative.some(value => !Number.isFinite(value) || value < 0) ||
        !Number.isFinite(input.creatorNetDeltaPct)) throw new Error('HSI_METRIC_INVALID');
    const u64Max = (1n << 64n) - 1n;
    for (const reserve of [input.realQuoteReservesLamports, input.virtualTokenReserves]) {
      if (typeof reserve !== 'bigint' || reserve < 0n || reserve > u64Max) throw new Error('HSI_RESERVE_INVALID');
    }
    const concentration = input.topTenHolderConcentrationBps;
    if (concentration !== undefined && (!Number.isInteger(concentration) || concentration < 0 || concentration > 10_000)) {
      throw new Error('HSI_CONCENTRATION_INVALID');
    }
    // 1. Participation Quality (0 = high quality, 100 = poor)
    // Discount vesting recipients and bundled accounts from organic participants
    const discountedRecipients = (input.vestingRecipientCount ?? 0) + Math.max(0, (input.bundleParticipantCount ?? 0) - 1);
    const rawEffective = Math.min(input.buyerCount, input.uniqueFundingClusters);
    const effectiveParticipants = Math.max(0, rawEffective - discountedRecipients);
    const clusterRatio = input.buyerCount > 0 ? effectiveParticipants / input.buyerCount : 0;
    const participationQuality = Math.max(0, Math.min(100, Math.round((1 - clusterRatio) * 100)));

    // 2. Liquidity Quality (1 SOL min threshold)
    const reserveSol = Number(input.realQuoteReservesLamports) / 1e9;
    const liquidityQuality = reserveSol < 1.0
      ? 80
      : reserveSol < 3.0
      ? 40
      : 10;

    // 3. Trade Diversity (variance of lot sizes)
    const tradeDiversity = input.tradeSizeVariance < 0.05 && input.buyCount > 10 ? 85 : 20;

    // 4. Wallet Independence
    const bundlerDetected = (input.bundleParticipantCount ?? 0) >= 3 || (input.buyerCount > 10 && input.uniqueFundingClusters <= 2);
    const walletIndependence = bundlerDetected ? 95 : (input.buyerCount > 15 && input.uniqueFundingClusters < 3 ? 90 : 15);

    // 5. Velocity Quality (unnatural burst check)
    // Protect against false positives when token is brand new (<5s) with low sample count
    const trades = input.buyCount + input.sellCount;
    const velocity = input.tokenAgeSeconds > 0 ? trades / input.tokenAgeSeconds : 0;
    const velocityAnomaly = input.tokenAgeSeconds >= 5 && trades >= 10 && velocity > 12;
    const velocityQuality = velocityAnomaly ? 85 : velocity > 8 ? 60 : (velocity < 0.05 && trades >= 5) ? 45 : 15;

    // 6. Sell Pressure & Dev Selling
    const devDumpingDetected = input.creatorNetDeltaPct < -5;
    let sellPressure = 20;
    if (devDumpingDetected) {
      sellPressure = 95; // Dev selling supply!
    } else if (input.sellVolumeSol > input.buyVolumeSol) {
      sellPressure = 65;
    }

    // 7. Developer Concentration / Top-10 Concentration
    const excessiveConcentration = (input.topTenHolderConcentrationBps ?? 0) > 4000; // >40% top 10

    // 8. Manipulation Risk
    const manipulationRisk = Math.max(
      participationQuality,
      walletIndependence,
      tradeDiversity,
      excessiveConcentration ? 75 : 0
    );

    // Composite HSI calculation
    let composite = Math.round(
      participationQuality * 0.2 +
      liquidityQuality * 0.15 +
      tradeDiversity * 0.1 +
      walletIndependence * 0.2 +
      velocityQuality * 0.1 +
      sellPressure * 0.15 +
      manipulationRisk * 0.1
    );

    // Severe sell pressure (e.g. dev dump) or bundler elevates composite suspicion
    if (sellPressure >= 80) {
      composite = Math.max(composite, Math.round(sellPressure * 0.55));
    }
    if (bundlerDetected) {
      composite = Math.max(composite, 65);
    }

    let reason = 'Healthy organic holder distribution';
    if (sellPressure >= 80) reason = 'Heavy creator or insider sell pressure';
    else if (bundlerDetected) reason = 'Coordinated bundle or Sybil funding network detected';
    else if (walletIndependence >= 80) reason = 'Coordinated wallet cluster or Sybil funding network';
    else if (excessiveConcentration) reason = 'Excessive top-holder supply concentration (>40%)';
    else if (participationQuality >= 70) reason = 'Low effective independent participant ratio';
    else if (velocityAnomaly) reason = 'Unnatural transaction velocity anomaly';

    return {
      compositeHsi: Math.max(0, Math.min(100, composite)),
      families: {
        participationQuality,
        liquidityQuality,
        tradeDiversity,
        walletIndependence,
        velocityQuality,
        sellPressure,
        manipulationRisk,
      },
      detectors: {
        bundlerDetected,
        velocityAnomaly,
        devDumpingDetected,
        excessiveConcentration,
      },
      effectiveIndependentParticipants: effectiveParticipants,
      suspicionReason: reason,
    };
  }
}
