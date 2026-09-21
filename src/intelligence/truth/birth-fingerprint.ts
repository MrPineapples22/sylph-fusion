/**
 * SOL-SYLPH Master Intelligence Architecture - Token Birth Fingerprint Engine
 * Specifications: Part V (Token Birth Fingerprint).
 *
 * Evaluates token trajectory across 8 discrete early-life windows:
 * - 0–2 sec
 * - 2–5 sec
 * - 5–10 sec
 * - 10–20 sec
 * - 20–30 sec
 * - 30–60 sec
 * - 1–3 min
 * - 3–5 min
 *
 * Preserves the entire birth trajectory rather than collapsing into a single snapshot.
 */

export type BirthWindow =
  | '0-2s'
  | '2-5s'
  | '5-10s'
  | '10-20s'
  | '20-30s'
  | '30-60s'
  | '1-3m'
  | '3-5m';

export interface BirthWindowMetrics {
  readonly window: BirthWindow;
  readonly startSec: number;
  readonly endSec: number;
  readonly buyersCount: number;
  readonly sellersCount: number;
  readonly uniqueWalletsCount: number;
  readonly effectiveIndependentParticipants: number;
  readonly buyVolumeSol: number;
  readonly sellVolumeSol: number;
  readonly buySellRatio: number;
  readonly txVelocityPerSec: number;
  readonly txAccelerationPerSec2: number;
  readonly priceVelocityPctPerSec: number;
  readonly priceAccelerationPctPerSec2: number;
  readonly liquidityVelocitySolPerSec: number;
  readonly liquidityAccelerationSolPerSec2: number;
  readonly holderGrowthRatePerSec: number;
  readonly isBundleActivityDetected: boolean;
  readonly creatorActivitySol: number;
  readonly averageWalletQualityScore: number;
  readonly capitalFlowVelocitySolPerSec: number;
  readonly topHolderConcentrationPct: number;
  readonly distributionPressureScore: number; // 0 - 100
}

export interface TokenBirthTrajectory {
  readonly mint: string;
  readonly birthTimestampMs: number;
  readonly windows: Record<BirthWindow, BirthWindowMetrics>;
  readonly aggregateOrganicScore: number; // 0 - 100
  readonly isOrganicLaunch: boolean;
  readonly trajectorySummary: string;
}

const WINDOW_BOUNDS: Record<BirthWindow, [number, number]> = {
  '0-2s': [0, 2],
  '2-5s': [2, 5],
  '5-10s': [5, 10],
  '10-20s': [10, 20],
  '20-30s': [20, 30],
  '30-60s': [30, 60],
  '1-3m': [60, 180],
  '3-5m': [180, 300],
};

export class TokenBirthFingerprintEngine {
  /**
   * Compute multi-window trajectory fingerprint for a token.
   */
  public computeFingerprint(params: {
    mint: string;
    birthTimestampMs: number;
    trades: readonly {
      timestampMs: number;
      wallet: string;
      isBuy: boolean;
      amountSol: number;
      priceSol: number;
      poolLiquiditySol: number;
      isCreator?: boolean;
    }[];
    effectiveDispersalRatio?: number;
  }): TokenBirthTrajectory {
    const { mint, birthTimestampMs, trades, effectiveDispersalRatio = 0.85 } = params;

    const windowMetrics: Partial<Record<BirthWindow, BirthWindowMetrics>> = {};
    let prevTxVel = 0;
    let prevPriceVel = 0;
    let prevLiqVel = 0;

    for (const [wKey, [startSec, endSec]] of Object.entries(WINDOW_BOUNDS) as [BirthWindow, [number, number]][]) {
      const windowStartMs = birthTimestampMs + startSec * 1000;
      const windowEndMs = birthTimestampMs + endSec * 1000;
      const durationSec = endSec - startSec;

      const windowTrades = trades.filter(
        (t) => t.timestampMs >= windowStartMs && t.timestampMs < windowEndMs
      );

      let buyers = 0;
      let sellers = 0;
      let buyVol = 0;
      let sellVol = 0;
      let creatorSol = 0;
      const uniqueWallets = new Set<string>();

      for (const t of windowTrades) {
        uniqueWallets.add(t.wallet);
        if (t.isBuy) {
          buyers++;
          buyVol += t.amountSol;
        } else {
          sellers++;
          sellVol += t.amountSol;
        }
        if (t.isCreator) creatorSol += t.amountSol;
      }

      const txVelocity = windowTrades.length / durationSec;
      const txAcceleration = (txVelocity - prevTxVel) / durationSec;
      prevTxVel = txVelocity;

      const pStart = windowTrades[0]?.priceSol ?? 0.00001;
      const pEnd = windowTrades[windowTrades.length - 1]?.priceSol ?? pStart;
      const priceVelocity = pStart > 0 ? ((pEnd - pStart) / pStart) * 100 / durationSec : 0;
      const priceAcceleration = (priceVelocity - prevPriceVel) / durationSec;
      prevPriceVel = priceVelocity;

      const liqStart = windowTrades[0]?.poolLiquiditySol ?? 10.0;
      const liqEnd = windowTrades[windowTrades.length - 1]?.poolLiquiditySol ?? liqStart;
      const liqVelocity = (liqEnd - liqStart) / durationSec;
      const liqAcceleration = (liqVelocity - prevLiqVel) / durationSec;
      prevLiqVel = liqVelocity;

      const effectiveParticipants = Math.max(1, Math.round(uniqueWallets.size * effectiveDispersalRatio));
      const isBundle = windowTrades.length >= 3 && durationSec <= 2 && (windowTrades[0]?.timestampMs === windowTrades[windowTrades.length - 1]?.timestampMs);

      windowMetrics[wKey] = {
        window: wKey,
        startSec,
        endSec,
        buyersCount: buyers,
        sellersCount: sellers,
        uniqueWalletsCount: uniqueWallets.size,
        effectiveIndependentParticipants: effectiveParticipants,
        buyVolumeSol: buyVol,
        sellVolumeSol: sellVol,
        buySellRatio: sellVol > 0 ? buyVol / sellVol : buyVol > 0 ? 10.0 : 1.0,
        txVelocityPerSec: Number(txVelocity.toFixed(2)),
        txAccelerationPerSec2: Number(txAcceleration.toFixed(2)),
        priceVelocityPctPerSec: Number(priceVelocity.toFixed(2)),
        priceAccelerationPctPerSec2: Number(priceAcceleration.toFixed(2)),
        liquidityVelocitySolPerSec: Number(liqVelocity.toFixed(2)),
        liquidityAccelerationSolPerSec2: Number(liqAcceleration.toFixed(2)),
        holderGrowthRatePerSec: Number((uniqueWallets.size / durationSec).toFixed(2)),
        isBundleActivityDetected: isBundle,
        creatorActivitySol: creatorSol,
        averageWalletQualityScore: Math.min(100, Math.round(effectiveDispersalRatio * 100)),
        capitalFlowVelocitySolPerSec: Number(((buyVol - sellVol) / durationSec).toFixed(2)),
        topHolderConcentrationPct: Math.round((1 - effectiveDispersalRatio) * 100),
        distributionPressureScore: sellVol > buyVol * 0.5 ? 75 : 20,
      };
    }

    const firstWindow = windowMetrics['0-2s']!;
    const organicScore = Math.min(
      100,
      Math.max(
        10,
        Math.round(
          effectiveDispersalRatio * 60 +
          (firstWindow.isBundleActivityDetected ? 0 : 25) +
          (firstWindow.buyVolumeSol > 0 ? 15 : 0)
        )
      )
    );

    return {
      mint,
      birthTimestampMs,
      windows: windowMetrics as Record<BirthWindow, BirthWindowMetrics>,
      aggregateOrganicScore: organicScore,
      isOrganicLaunch: organicScore >= 65 && !firstWindow.isBundleActivityDetected,
      trajectorySummary: `Organic score ${organicScore}/100 with ${windowMetrics['0-2s']?.effectiveIndependentParticipants} initial independent participants.`,
    };
  }
}

export type BirthFingerprintProfiler = TokenBirthFingerprintEngine;
export const BirthFingerprintProfiler = TokenBirthFingerprintEngine;


