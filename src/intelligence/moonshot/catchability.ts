/**
 * SYLPH FUSION — CATCHABILITY CURVE & EXECUTABLE ATH (EATH)
 * Specifications: Master Blueprint Sections XVII, XVIII, XIX, XX
 *
 * Implements:
 * 1. Catchability Curve: C_m(t, q) = MaxExecutableProceedsAfter(t, q) / ExecutableEntryCost(t, q)
 * 2. Executable ATH (EATH(q)) across sizes: $1, $5, $10, $25, $50, $100, $250, $500, $1K, $2.5K, $5K, $10K
 * 3. Time to Monetizable Peak: T_EMP(q) = argmax_t ExecutableProceeds(q, t)
 * 4. Realistic Moonshot Labels conditioned on latency and position size
 *
 * Invariant: Never confuse displayed chart ATH with executable ATH.
 */

export const STANDARD_POSITION_SIZES_USD = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
] as const;

export const STANDARD_LATENCIES_MS = [
  400,    // 1 slot
  800,    // 2 slots
  1000,   // 1s
  2000,   // 2s
  5000,   // 5s
  10000,  // 10s
  15000,  // 15s
  30000,  // 30s
  60000,  // 1m
  120000, // 2m
  300000, // 5m
  600000, // 10m
] as const;

export interface TokenTrajectoryPoint {
  readonly timestampMs: number;
  readonly slot: bigint;
  readonly priceSol: number;
  readonly realQuoteReservesLamports: bigint;
  readonly virtualQuoteReservesLamports: bigint;
  readonly virtualTokenReserves: bigint;
}

export interface CatchabilityEvaluation {
  readonly latencyMs: number;
  readonly sizeUsd: number;
  readonly executableEntryCostLamports: bigint;
  readonly maxExecutableProceedsLamports: bigint;
  readonly catchabilityRatio: number; // Proceeds / Cost
  readonly monetizablePeakTimestampMs: number;
  readonly timeToMonetizablePeakMs: number;
}

export interface ExecutableAthProfile {
  readonly mint: string;
  readonly displayedAthMultiple: number;
  readonly displayedAthTimestampMs: number;
  readonly eathBySize: ReadonlyMap<number, number>; // sizeUsd -> max executable multiple
  readonly tempBySizeMs: ReadonlyMap<number, number>; // sizeUsd -> T_EMP (ms from birth)
  readonly catchabilityMatrix: readonly CatchabilityEvaluation[];
  readonly qualifiedLabels: readonly string[];
}

export class CatchabilityEngine {
  private static readonly SOL_PRICE_USD = 150.0;
  private static readonly LAMPORTS_PER_SOL = 1_000_000_000n;

  /**
   * Computes constant product AMM executable output proceeds for a given sell size.
   */
  public static calculateExecutableProceedsLamports(
    tokenQtyRaw: bigint,
    virtualTokenReserves: bigint,
    virtualQuoteReserves: bigint
  ): bigint {
    if (tokenQtyRaw <= 0n || virtualTokenReserves <= 0n || virtualQuoteReserves <= 0n) return 0n;
    // dQ = (Q * dT) / (T + dT)
    const proceeds = (virtualQuoteReserves * tokenQtyRaw) / (virtualTokenReserves + tokenQtyRaw);
    return proceeds;
  }

  /**
   * Evaluates complete Catchability Curve and Executable ATH across position sizes and latencies.
   */
  public static evaluateTrajectory(params: {
    mint: string;
    birthTimestampMs: number;
    trajectory: readonly TokenTrajectoryPoint[];
  }): ExecutableAthProfile {
    const sortedTrajectory = [...params.trajectory].sort((a, b) => a.timestampMs - b.timestampMs);
    if (sortedTrajectory.length === 0) {
      return {
        mint: params.mint,
        displayedAthMultiple: 1.0,
        displayedAthTimestampMs: params.birthTimestampMs,
        eathBySize: new Map(),
        tempBySizeMs: new Map(),
        catchabilityMatrix: [],
        qualifiedLabels: [],
      };
    }

    const birthPoint = sortedTrajectory[0];
    const initialPrice = birthPoint.priceSol;
    let displayedMaxPrice = initialPrice;
    let displayedAthTime = birthPoint.timestampMs;

    for (const point of sortedTrajectory) {
      if (point.priceSol > displayedMaxPrice) {
        displayedMaxPrice = point.priceSol;
        displayedAthTime = point.timestampMs;
      }
    }
    const displayedAthMultiple = displayedMaxPrice / Math.max(1e-12, initialPrice);

    const eathBySize = new Map<number, number>();
    const tempBySizeMs = new Map<number, number>();
    const catchabilityMatrix: CatchabilityEvaluation[] = [];
    const qualifiedLabels = new Set<string>();

    if (displayedAthMultiple >= 100) qualifiedLabels.add('DISPLAYED_100X');
    if (displayedAthMultiple >= 50) qualifiedLabels.add('DISPLAYED_50X');
    if (displayedAthMultiple >= 10) qualifiedLabels.add('DISPLAYED_10X');

    // Evaluate for each standard position size
    for (const sizeUsd of STANDARD_POSITION_SIZES_USD) {
      const entrySol = sizeUsd / this.SOL_PRICE_USD;
      const entryLamports = BigInt(Math.round(entrySol * 1e9));

      let maxProceedsForSize = 0n;
      let tempForSize = birthPoint.timestampMs;

      for (const latencyMs of STANDARD_LATENCIES_MS) {
        const entryTargetTime = params.birthTimestampMs + latencyMs;
        const entryPoint = sortedTrajectory.find(p => p.timestampMs >= entryTargetTime) ?? sortedTrajectory[sortedTrajectory.length - 1];

        // Tokens received at entry
        const entryTokens = (entryPoint.virtualTokenReserves * entryLamports) / (entryPoint.virtualQuoteReservesLamports + entryLamports);

        // Find max executable exit AFTER entryTargetTime
        let maxProceeds = 0n;
        let bestExitTime = entryPoint.timestampMs;

        for (const exitPoint of sortedTrajectory) {
          if (exitPoint.timestampMs <= entryPoint.timestampMs) continue;

          const proceeds = this.calculateExecutableProceedsLamports(
            entryTokens,
            exitPoint.virtualTokenReserves,
            exitPoint.virtualQuoteReservesLamports
          );

          if (proceeds > maxProceeds) {
            maxProceeds = proceeds;
            bestExitTime = exitPoint.timestampMs;
          }
        }

        const ratio = entryLamports > 0n ? Number(maxProceeds) / Number(entryLamports) : 0;
        const timeToPeakMs = Math.max(0, bestExitTime - entryPoint.timestampMs);

        catchabilityMatrix.push({
          latencyMs,
          sizeUsd,
          executableEntryCostLamports: entryLamports,
          maxExecutableProceedsLamports: maxProceeds,
          catchabilityRatio: Number(ratio.toFixed(3)),
          monetizablePeakTimestampMs: bestExitTime,
          timeToMonetizablePeakMs: timeToPeakMs,
        });

        if (maxProceeds > maxProceedsForSize) {
          maxProceedsForSize = maxProceeds;
          tempForSize = bestExitTime;
        }

        // Add size and latency conditioned labels
        if (ratio >= 100) qualifiedLabels.add(`EXECUTABLE_100X_$${sizeUsd}_LATENCY_${Math.round(latencyMs / 1000)}S`);
        if (ratio >= 50) qualifiedLabels.add(`EXECUTABLE_50X_$${sizeUsd}_LATENCY_${Math.round(latencyMs / 1000)}S`);
        if (ratio >= 10) qualifiedLabels.add(`EXECUTABLE_10X_$${sizeUsd}_LATENCY_${Math.round(latencyMs / 1000)}S`);
      }

      const eathMultiple = entryLamports > 0n ? Number(maxProceedsForSize) / Number(entryLamports) : 0;
      eathBySize.set(sizeUsd, Number(eathMultiple.toFixed(3)));
      tempBySizeMs.set(sizeUsd, Math.max(0, tempForSize - params.birthTimestampMs));

      if (eathMultiple >= 100) qualifiedLabels.add(`EXECUTABLE_100X_$${sizeUsd}`);
      if (eathMultiple >= 10) qualifiedLabels.add(`EXECUTABLE_10X_$${sizeUsd}`);
    }

    return {
      mint: params.mint,
      displayedAthMultiple: Number(displayedAthMultiple.toFixed(2)),
      displayedAthTimestampMs: displayedAthTime,
      eathBySize,
      tempBySizeMs,
      catchabilityMatrix,
      qualifiedLabels: Array.from(qualifiedLabels),
    };
  }
}
