/**
 * SYLPH FUSION — COHORT MATURITY & DIVERSITY ASSESSMENT
 * Specifications: Blueprint Section 35
 * Workbook: #543, #544
 *
 * Invariant:
 * Raw sample count alone MUST NEVER promote a cohort.
 * A cohort is mature ONLY when effective independent sample count,
 * regime diversity, creator diversity, wallet-cluster diversity,
 * and maturity horizons all satisfy strictly non-synthetic thresholds.
 */

export interface ObservationPoint {
  readonly observationId: string;
  readonly timestamp: number;
  readonly regime: string;
  readonly creatorId: string;
  readonly walletClusterId: string;
  readonly route: string;
  readonly isLateArrival?: boolean;
}

export interface CohortMaturityReport {
  readonly cohortId: string;
  readonly firstObservationAt: number;
  readonly lastObservationAt: number;
  readonly rawSampleCount: number;
  readonly effectiveIndependentSampleCount: number;
  readonly regimeDiversityScore: number;
  readonly creatorDiversityScore: number;
  readonly walletClusterDiversityScore: number;
  readonly routeDiversityScore: number;
  readonly maturityHorizonMs: number;
  readonly lateLabelFraction: number;
  readonly isMature: boolean;
  readonly disqualificationReasons: readonly string[];
  readonly assessmentEvidenceRoot: string;
}

export interface CohortMaturityThresholds {
  readonly minRawSamples: number;
  readonly minEffectiveIndependentSamples: number;
  readonly minRegimeDiversityScore: number;
  readonly minCreatorDiversityScore: number;
  readonly minWalletClusterDiversityScore: number;
  readonly minMaturityHorizonMs: number;
  readonly maxLateLabelFraction: number;
}

export const DEFAULT_COHORT_THRESHOLDS: CohortMaturityThresholds = {
  minRawSamples: 50,
  minEffectiveIndependentSamples: 25,
  minRegimeDiversityScore: 0.4,
  minCreatorDiversityScore: 0.5,
  minWalletClusterDiversityScore: 0.5,
  minMaturityHorizonMs: 3600_000, // 1 hour minimum horizon
  maxLateLabelFraction: 0.15,
};

export class CohortMaturityEngine {
  /**
   * Assesses maturity and independence of an observation cohort.
   */
  public static assessMaturity(
    cohortId: string,
    observations: readonly ObservationPoint[],
    thresholds: CohortMaturityThresholds = DEFAULT_COHORT_THRESHOLDS
  ): CohortMaturityReport {
    if (observations.length === 0) {
      return {
        cohortId,
        firstObservationAt: 0,
        lastObservationAt: 0,
        rawSampleCount: 0,
        effectiveIndependentSampleCount: 0,
        regimeDiversityScore: 0,
        creatorDiversityScore: 0,
        walletClusterDiversityScore: 0,
        routeDiversityScore: 0,
        maturityHorizonMs: 0,
        lateLabelFraction: 0,
        isMature: false,
        disqualificationReasons: ['ZERO_OBSERVATIONS'],
        assessmentEvidenceRoot: `ev_cohort_${cohortId}_empty`,
      };
    }

    const rawSampleCount = observations.length;
    let minTime = observations[0].timestamp;
    let maxTime = observations[0].timestamp;
    let lateCount = 0;

    const regimeCounts = new Map<string, number>();
    const creatorCounts = new Map<string, number>();
    const clusterCounts = new Map<string, number>();
    const routeCounts = new Map<string, number>();

    for (const obs of observations) {
      if (obs.timestamp < minTime) minTime = obs.timestamp;
      if (obs.timestamp > maxTime) maxTime = obs.timestamp;
      if (obs.isLateArrival) lateCount++;

      regimeCounts.set(obs.regime, (regimeCounts.get(obs.regime) ?? 0) + 1);
      creatorCounts.set(obs.creatorId, (creatorCounts.get(obs.creatorId) ?? 0) + 1);
      clusterCounts.set(obs.walletClusterId, (clusterCounts.get(obs.walletClusterId) ?? 0) + 1);
      routeCounts.set(obs.route, (routeCounts.get(obs.route) ?? 0) + 1);
    }

    const timespanMs = maxTime - minTime;
    const lateLabelFraction = Number((lateCount / rawSampleCount).toFixed(4));

    // Compute Shannon Entropy normalized to [0, 1] for diversity scores
    const regimeDiversityScore = this.computeNormalizedEntropy(regimeCounts, rawSampleCount);
    const creatorDiversityScore = this.computeNormalizedEntropy(creatorCounts, rawSampleCount);
    const walletClusterDiversityScore = this.computeNormalizedEntropy(clusterCounts, rawSampleCount);
    const routeDiversityScore = this.computeNormalizedEntropy(routeCounts, rawSampleCount);

    // Compute effective independent sample count using average concentration index
    const maxCreatorShare = Math.max(...creatorCounts.values()) / rawSampleCount;
    const maxClusterShare = Math.max(...clusterCounts.values()) / rawSampleCount;
    const correlationPenalty = Math.max(maxCreatorShare, maxClusterShare);
    const effectiveIndependentSampleCount = Math.max(
      1,
      Math.floor(rawSampleCount * (1 - correlationPenalty * 0.75))
    );

    const disqualifications: string[] = [];

    if (rawSampleCount < thresholds.minRawSamples) {
      disqualifications.push(`INSUFFICIENT_RAW_SAMPLES: ${rawSampleCount} < ${thresholds.minRawSamples}`);
    }
    if (effectiveIndependentSampleCount < thresholds.minEffectiveIndependentSamples) {
      disqualifications.push(
        `INSUFFICIENT_EFFECTIVE_SAMPLES: ${effectiveIndependentSampleCount} < ${thresholds.minEffectiveIndependentSamples}`
      );
    }
    if (regimeDiversityScore < thresholds.minRegimeDiversityScore) {
      disqualifications.push(
        `LOW_REGIME_DIVERSITY: ${regimeDiversityScore.toFixed(3)} < ${thresholds.minRegimeDiversityScore}`
      );
    }
    if (creatorDiversityScore < thresholds.minCreatorDiversityScore) {
      disqualifications.push(
        `LOW_CREATOR_DIVERSITY: ${creatorDiversityScore.toFixed(3)} < ${thresholds.minCreatorDiversityScore}`
      );
    }
    if (walletClusterDiversityScore < thresholds.minWalletClusterDiversityScore) {
      disqualifications.push(
        `LOW_WALLET_CLUSTER_DIVERSITY: ${walletClusterDiversityScore.toFixed(3)} < ${thresholds.minWalletClusterDiversityScore}`
      );
    }
    if (timespanMs < thresholds.minMaturityHorizonMs) {
      disqualifications.push(
        `INSUFFICIENT_MATURITY_HORIZON: ${timespanMs}ms < ${thresholds.minMaturityHorizonMs}ms`
      );
    }
    if (lateLabelFraction > thresholds.maxLateLabelFraction) {
      disqualifications.push(
        `EXCESSIVE_LATE_LABELS: ${lateLabelFraction.toFixed(3)} > ${thresholds.maxLateLabelFraction}`
      );
    }

    const isMature = disqualifications.length === 0;

    return {
      cohortId,
      firstObservationAt: minTime,
      lastObservationAt: maxTime,
      rawSampleCount,
      effectiveIndependentSampleCount,
      regimeDiversityScore: Number(regimeDiversityScore.toFixed(4)),
      creatorDiversityScore: Number(creatorDiversityScore.toFixed(4)),
      walletClusterDiversityScore: Number(walletClusterDiversityScore.toFixed(4)),
      routeDiversityScore: Number(routeDiversityScore.toFixed(4)),
      maturityHorizonMs: timespanMs,
      lateLabelFraction,
      isMature,
      disqualificationReasons: disqualifications,
      assessmentEvidenceRoot: `ev_cohort_${cohortId}_${rawSampleCount}_${Date.now()}`,
    };
  }

  private static computeNormalizedEntropy(counts: Map<string, number>, total: number): number {
    if (counts.size <= 1 || total <= 1) return 0;
    let entropy = 0;
    for (const count of counts.values()) {
      const p = count / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }
    const maxEntropy = Math.log2(counts.size);
    return maxEntropy > 0 ? entropy / maxEntropy : 0;
  }
}
