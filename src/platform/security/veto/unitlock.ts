/**
 * PHASE 9 — UNITLOCK: EXACT ARITHMETIC & BOUNDED INTERVAL KERNEL
 *
 * Eliminates all veto-critical reliance on lossy JavaScript IEEE-754 floats.
 * Implements:
 * - Exact cross-multiplication for percentages/basis points
 * - Rigorous interval arithmetic (lowerBound / upperBound)
 * - Safe rational comparisons
 * - Proven threshold satisfaction rules
 */

import { BasisPoints, Lamports, RawTokenUnits, basisPoints } from './types.js';

export interface IntervalBound {
  readonly lower: bigint;
  readonly upper: bigint;
}

export class UnitLock {
  private static readonly BPS_BASE = 10_000n;

  /**
   * Exact concentration check using integer cross-multiplication:
   * held / supply > thresholdBps / 10,000
   * <=> held * 10,000 > supply * thresholdBps
   */
  public static isConcentrationBreached(
    held: bigint,
    supply: bigint,
    thresholdBps: bigint
  ): boolean {
    if (supply <= 0n) return false;
    if (held < 0n || thresholdBps < 0n) return false;
    return held * this.BPS_BASE > supply * thresholdBps;
  }

  /**
   * Interval threshold proof:
   * A hard rule violation requires PROOF that the ACTUAL value is beyond the threshold.
   * Therefore, the lowerBound of the interval must strictly exceed the threshold.
   * If only the upperBound exceeds the threshold, the actual value could be below it,
   * which constitutes UNCERTAINTY, not proven violation.
   */
  public static isLowerBoundBreachProven(
    interval: IntervalBound,
    threshold: bigint
  ): boolean {
    if (interval.lower > interval.upper) {
      throw new Error(`Invalid interval: lower bound (${interval.lower}) > upper bound (${interval.upper})`);
    }
    return interval.lower > threshold;
  }

  /**
   * Safe rational comparison: (numA / denA) > (numB / denB)
   * <=> numA * denB > numB * denA (for positive denominators)
   */
  public static compareRationals(
    numA: bigint,
    denA: bigint,
    numB: bigint,
    denB: bigint
  ): number {
    if (denA <= 0n || denB <= 0n) throw new Error('Denominators must be strictly positive');
    const left = numA * denB;
    const right = numB * denA;
    if (left > right) return 1;
    if (left < right) return -1;
    return 0;
  }

  /**
   * Calculates basis points from two BigInts with floor rounding.
   */
  public static calculateBasisPoints(numerator: bigint, denominator: bigint): BasisPoints {
    if (denominator <= 0n) return basisPoints(0n);
    return basisPoints((numerator * this.BPS_BASE) / denominator);
  }
}
