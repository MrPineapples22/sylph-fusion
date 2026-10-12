/** Research-only paired transport measurements. This class sends no transactions. */

import { createHash } from 'node:crypto';

export type ExecutionLaneType = 'JITO_BUNDLE' | 'DIRECT_TPU_QUIC' | 'RPC_FALLBACK';
export type LandingOutcome = 'LANDED' | 'FAILED' | 'EXPIRED';

export interface LandingAttempt {
  readonly benchmarkId: string;
  readonly trialId: string;
  readonly lane: ExecutionLaneType;
  readonly transactionDigest: string;
  readonly notionalLamports: bigint;
  readonly targetSlot: number;
  readonly submittedAtMs: number;
  readonly outcome: LandingOutcome;
  readonly firstShredAtMs?: number;
  readonly includedSlot?: number;
  readonly baseFeeLamports?: bigint;
  readonly priorityFeeLamports?: bigint;
  readonly tipLamports?: bigint;
}

export interface LaneLandingMetrics {
  readonly lane: ExecutionLaneType;
  readonly totalSubmissions: number;
  readonly landedCount: number;
  readonly deliveryFailedCount: number;
  readonly blockhashExpiredCount: number;
  readonly landingRatePct: number | null;
  readonly meanFirstShredLatencyMs: number | null;
  readonly p95FirstShredLatencyMs: number | null;
  readonly meanInclusionSlotDistance: number | null;
  readonly observedTipTotalLamports: string | null;
}

export interface DynamicTipSchedule {
  /** Percentiles of supplied tips from complete paired trials; never recommendations. */
  readonly p25TipLamports: string | null;
  readonly p50TipLamports: string | null;
  readonly p75TipLamports: string | null;
  readonly p90TipLamports: string | null;
  readonly p99TipLamports: string | null;
  readonly recommendedTipLamports: null;
}

export interface LandingBenchmarkCertificate {
  readonly benchmarkId: string;
  readonly targetSlot: number | null;
  readonly evaluatedLanes: readonly LaneLandingMetrics[];
  readonly overallLandingRatePct: number | null;
  readonly isLandingHealthy: boolean | null;
  readonly dynamicTipSchedule: DynamicTipSchedule;
  readonly pairedTrialCount: number;
  readonly requiredPairedTrialCount: number;
  readonly excludedUnpairedAttemptCount: number;
  readonly pairedEvidenceSufficient: boolean;
  readonly observationLeaderForReview: ExecutionLaneType | null;
  readonly evaluationStatus: 'INSUFFICIENT_PAIRED_EVIDENCE' | 'OBSERVATIONS_ONLY';
  readonly certificateHash: string;
  readonly evaluatedAtMs: number;
  readonly authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY';
}

export function shouldBlockLandingBenchmark(report: LandingBenchmarkCertificate, minimumLandingRatePct: number): boolean {
  return !Number.isFinite(minimumLandingRatePct) || minimumLandingRatePct < 0 ||
    !report.pairedEvidenceSufficient || report.isLandingHealthy === null || report.overallLandingRatePct === null ||
    report.overallLandingRatePct < minimumLandingRatePct;
}

type StoredAttempt = LandingAttempt;

const LANES: readonly ExecutionLaneType[] = ['JITO_BUNDLE', 'DIRECT_TPU_QUIC', 'RPC_FALLBACK'];
const finiteInteger = (value: number) => Number.isSafeInteger(value) && value >= 0;
const medianRank = (sorted: readonly number[], percentile: number) => sorted.length
  ? sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)]
  : null;
const bigintRank = (sorted: readonly bigint[], percentile: number) => sorted.length
  ? sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)].toString()
  : null;

export class LandingBenchmarkEngine {
  private readonly attempts = new Map<string, StoredAttempt>();
  private readonly maxStoredAttempts: number;
  private readonly minimumPairedTrials: number;

  constructor(config: { readonly maxStoredAttempts?: number; readonly minimumPairedTrials?: number } = {}) {
    this.maxStoredAttempts = config.maxStoredAttempts ?? 10_000;
    this.minimumPairedTrials = config.minimumPairedTrials ?? 30;
    if (!Number.isSafeInteger(this.maxStoredAttempts) || this.maxStoredAttempts < 1 ||
        !Number.isSafeInteger(this.minimumPairedTrials) || this.minimumPairedTrials < 1) throw new Error('INVALID_BENCHMARK_CONFIG');
  }

  /** Record caller-supplied observation facts; malformed or contradictory pairs fail closed. */
  public recordSubmissionAttempt(attempt: LandingAttempt): void {
    if (!attempt || !attempt.benchmarkId || !attempt.trialId || !attempt.transactionDigest ||
        !LANES.includes(attempt.lane) || typeof attempt.notionalLamports !== 'bigint' || attempt.notionalLamports < 0n ||
        !finiteInteger(attempt.targetSlot) || !Number.isFinite(attempt.submittedAtMs) || attempt.submittedAtMs <= 0 ||
        !['LANDED', 'FAILED', 'EXPIRED'].includes(attempt.outcome) ||
        (attempt.firstShredAtMs !== undefined && (!Number.isFinite(attempt.firstShredAtMs) || attempt.firstShredAtMs < attempt.submittedAtMs)) ||
        (attempt.includedSlot !== undefined && (!finiteInteger(attempt.includedSlot) || attempt.includedSlot < attempt.targetSlot)) ||
        [attempt.baseFeeLamports, attempt.priorityFeeLamports, attempt.tipLamports].some((amount) => amount !== undefined && (typeof amount !== 'bigint' || amount < 0n))) {
      throw new Error('INVALID_LANDING_ATTEMPT');
    }
    if (attempt.outcome !== 'LANDED' && (attempt.firstShredAtMs !== undefined || attempt.includedSlot !== undefined)) {
      throw new Error('FAILED_ATTEMPT_HAS_LANDING_EVIDENCE');
    }
    const key = `${attempt.benchmarkId}:${attempt.trialId}:${attempt.lane}`;
    if (this.attempts.has(key)) throw new Error('DUPLICATE_LANE_ATTEMPT');
    for (const other of this.attempts.values()) {
      if (other.benchmarkId === attempt.benchmarkId && other.trialId === attempt.trialId &&
          (other.transactionDigest !== attempt.transactionDigest || other.notionalLamports !== attempt.notionalLamports || other.targetSlot !== attempt.targetSlot)) {
        throw new Error('UNPAIRED_BENCHMARK_MISMATCH');
      }
    }
    this.attempts.set(key, attempt);
    while (this.attempts.size > this.maxStoredAttempts) {
      const oldest = this.attempts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.attempts.delete(oldest);
    }
  }

  public evaluateBenchmark(benchmarkIdValue: string | number, _legacyContentionRatio?: number): LandingBenchmarkCertificate {
    const benchmarkId = String(benchmarkIdValue);
    if (!benchmarkId) throw new Error('INVALID_BENCHMARK_ID');
    const selected = [...this.attempts.values()].filter((attempt) => attempt.benchmarkId === benchmarkId);
    const byTrial = new Map<string, StoredAttempt[]>();
    for (const attempt of selected) {
      const trial = byTrial.get(attempt.trialId) ?? [];
      trial.push(attempt);
      byTrial.set(attempt.trialId, trial);
    }
    const completeTrials = [...byTrial.values()].filter((trial) => new Set(trial.map((attempt) => attempt.lane)).size === LANES.length);
    const pairedTrialCount = completeTrials.length;
    const pairedAttempts = completeTrials.flat();
    const targetSlots = new Set(pairedAttempts.map((attempt) => attempt.targetSlot));
    const allLanded = pairedAttempts.filter((attempt) => attempt.outcome === 'LANDED').length;
    const overallLandingRatePct = pairedAttempts.length ? Number(((allLanded / pairedAttempts.length) * 100).toFixed(1)) : null;
    const lanes = LANES.map((lane): LaneLandingMetrics => {
      const laneAttempts = pairedAttempts.filter((attempt) => attempt.lane === lane);
      const landed = laneAttempts.filter((attempt) => attempt.outcome === 'LANDED');
      const latencies = landed.filter((attempt) => attempt.firstShredAtMs !== undefined)
        .map((attempt) => attempt.firstShredAtMs! - attempt.submittedAtMs).sort((a, b) => a - b);
      const slotDistances = landed.filter((attempt) => attempt.includedSlot !== undefined)
        .map((attempt) => attempt.includedSlot! - attempt.targetSlot);
      const tips = laneAttempts.flatMap((attempt) => attempt.tipLamports === undefined ? [] : [attempt.tipLamports]);
      const tipTotal = tips.length ? tips.reduce((sum, value) => sum + value, 0n).toString() : null;
      return {
        lane,
        totalSubmissions: laneAttempts.length,
        landedCount: landed.length,
        deliveryFailedCount: laneAttempts.filter((attempt) => attempt.outcome === 'FAILED').length,
        blockhashExpiredCount: laneAttempts.filter((attempt) => attempt.outcome === 'EXPIRED').length,
        landingRatePct: laneAttempts.length ? Number(((landed.length / laneAttempts.length) * 100).toFixed(1)) : null,
        meanFirstShredLatencyMs: latencies.length ? Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(1)) : null,
        p95FirstShredLatencyMs: medianRank(latencies, 0.95),
        meanInclusionSlotDistance: slotDistances.length ? Number((slotDistances.reduce((sum, value) => sum + value, 0) / slotDistances.length).toFixed(2)) : null,
        observedTipTotalLamports: tipTotal,
      };
    });
    const sufficient = pairedTrialCount >= this.minimumPairedTrials;
    const observationLeaderForReview = sufficient
      ? [...lanes].filter((lane) => lane.totalSubmissions > 0 && lane.landingRatePct !== null)
          .sort((a, b) => (b.landingRatePct! - a.landingRatePct!) || (a.meanFirstShredLatencyMs ?? Infinity) - (b.meanFirstShredLatencyMs ?? Infinity))[0]?.lane ?? null
      : null;
    const tips = pairedAttempts.flatMap((attempt) => attempt.tipLamports === undefined ? [] : [attempt.tipLamports]).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const dynamicTipSchedule: DynamicTipSchedule = {
      p25TipLamports: bigintRank(tips, 0.25),
      p50TipLamports: bigintRank(tips, 0.50),
      p75TipLamports: bigintRank(tips, 0.75),
      p90TipLamports: bigintRank(tips, 0.90),
      p99TipLamports: bigintRank(tips, 0.99),
      recommendedTipLamports: null,
    };
    const evaluatedAtMs = Date.now();
    const contents = {
      benchmarkId,
      targetSlot: targetSlots.size === 1 ? [...targetSlots][0] : null,
      evaluatedLanes: lanes,
      overallLandingRatePct,
      isLandingHealthy: overallLandingRatePct === null ? null : overallLandingRatePct >= 70,
      dynamicTipSchedule,
      pairedTrialCount,
      requiredPairedTrialCount: this.minimumPairedTrials,
      excludedUnpairedAttemptCount: selected.length - pairedAttempts.length,
      pairedEvidenceSufficient: sufficient,
      observationLeaderForReview,
      evaluationStatus: sufficient ? 'OBSERVATIONS_ONLY' as const : 'INSUFFICIENT_PAIRED_EVIDENCE' as const,
      evaluatedAtMs,
      authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY' as const,
    };
    const certificateHash = createHash('sha256').update(JSON.stringify(contents)).digest('hex');
    return { ...contents, certificateHash };
  }
}
