/**
 * SYLPH FUSION — OBSERVABILITY GAP DETECTOR
 * Study: OBSERVABILITY-GAP-X (Section VIII)
 *
 * In the empirical 523k cohort:
 * - Median primary history spanned only 90.3 seconds (17 observations).
 * - 74.86% spanned less than 5 minutes.
 * - Only 12 tokens satisfied: >=20 observations, >=1 hour span, and no gap exceeding 5 minutes.
 * ObservabilityGapEngine detects data gaps that make exit quotes unavailable.
 */

export interface ObservabilityGapReport {
  readonly totalSpanSeconds: number;
  readonly observationCount: number;
  readonly maxGapSeconds: number;
  readonly averageGapSeconds: number;
  readonly isShortHistory: boolean; // < 300s
  readonly isContinuousHistory: boolean; // >=20 obs, >=3600s, max gap <=300s
  readonly exitObservabilityAvailable: boolean;
  readonly reason?: string;
}

export class ObservabilityGapEngine {
  public static evaluateGaps(timestampsMs: readonly number[]): ObservabilityGapReport {
    if (timestampsMs.length < 2) {
      return {
        totalSpanSeconds: 0,
        observationCount: timestampsMs.length,
        maxGapSeconds: 0,
        averageGapSeconds: 0,
        isShortHistory: true,
        isContinuousHistory: false,
        exitObservabilityAvailable: false,
        reason: 'INSUFFICIENT_OBSERVATION_COUNT',
      };
    }

    const sorted = [...timestampsMs].sort((a, b) => a - b);
    const totalSpanSeconds = (sorted[sorted.length - 1] - sorted[0]) / 1000.0;
    let maxGapSeconds = 0;
    let gapSum = 0;

    for (let i = 1; i < sorted.length; i++) {
      const gap = (sorted[i] - sorted[i - 1]) / 1000.0;
      gapSum += gap;
      if (gap > maxGapSeconds) {
        maxGapSeconds = gap;
      }
    }

    const averageGapSeconds = gapSum / (sorted.length - 1);
    const isShortHistory = totalSpanSeconds < 300.0;
    const isContinuousHistory = sorted.length >= 20 && totalSpanSeconds >= 3600.0 && maxGapSeconds <= 300.0;

    let exitObservabilityAvailable = true;
    let reason: string | undefined;

    if (maxGapSeconds > 120.0) {
      exitObservabilityAvailable = false;
      reason = `MAX_GAP_EXCEEDED: Largest gap was ${maxGapSeconds.toFixed(1)}s; continuous exit pricing impossible`;
    } else if (isShortHistory && sorted.length < 5) {
      exitObservabilityAvailable = false;
      reason = 'SPARSE_SHORT_HISTORY: Less than 5 observations across short history';
    }

    return {
      totalSpanSeconds,
      observationCount: sorted.length,
      maxGapSeconds,
      averageGapSeconds,
      isShortHistory,
      isContinuousHistory,
      exitObservabilityAvailable,
      reason,
    };
  }
}
