/**
 * SYLPH FUSION — LABELFORGE: Leakage-Resistant Economic Dataset Certification
 * Specifications: Section 8 (Upgrade 4: LabelForge), Section 103 (Invariant 13)
 *
 * Invariants:
 * 1. Every training observation must be an immutable certified artifact (TrainingExampleCertificate).
 * 2. Only examples marked ECONOMIC_FINAL may enter production training or evaluation.
 * 3. Strict anti-leakage guards:
 *    - Future-data leakage (featureAvailableAt <= decisionTimestamp < targetTimestamp).
 *    - Creator and wallet-cluster leakage (embargo gaps and cluster-aware splits).
 * 4. Chronological walk-forward validation with embargo gaps.
 */

import { createHash } from 'node:crypto';

export type LabelFinalityStatus = 'INTERMEDIATE_ESTIMATE' | 'SETTLEMENT_PENDING' | 'ECONOMIC_FINAL' | 'REVISED_INVALID';

export interface TrainingExampleCertificate {
  readonly exampleId: string;
  readonly tokenMint: string;
  readonly creatorIdentity: string;
  readonly funderClusterId: string;
  readonly candidateGenerationId: string;
  readonly decisionTimestampMs: number;
  readonly decisionSlot: number;
  readonly targetTimestampMs: number;
  readonly featureSnapshotHash: string;
  readonly featureSchemaVersion: string;
  readonly modelVersion: string;
  readonly strategyVersion: string;
  readonly configurationHash: string;
  readonly actionTaken: string;
  readonly actionProbability: number;
  readonly eventualFinalLabel: number; // e.g. 1 (profitable > threshold), 0 (loss)
  readonly labelFinality: LabelFinalityStatus;
  readonly outcomeEvidenceIds: readonly string[];
  readonly realizedGrossPnlLamports: bigint;
  readonly realizedNetPnlLamports: bigint;
  readonly frictionFeesLamports: bigint;
  readonly priceImpactBps: number;
  readonly provenanceRoot: string;
  readonly digest: string;
}

export interface DatasetSplitEvaluation {
  readonly totalExamples: number;
  readonly certifiedFinalExamples: number;
  readonly trainingExamples: readonly TrainingExampleCertificate[];
  readonly testExamples: readonly TrainingExampleCertificate[];
  readonly embargoGapMs: number;
  /** No violations of the checked windows/identities; not proof of label availability or settlement finality. */
  readonly isLeakageFree: boolean;
  readonly leakageViolations: readonly string[];
}

export class LabelForgeAuthority {
  private static readonly EMBARGO_GAP_MS_DEFAULT = 3_600_000; // 1 hour embargo

  /**
   * Certifies an economic training example, verifying point-in-time causality.
   */
  public static certifyExample(params: {
    tokenMint: string;
    creatorIdentity: string;
    funderClusterId: string;
    candidateGenerationId: string;
    decisionTimestampMs: number;
    decisionSlot: number;
    targetTimestampMs: number;
    featureAvailableAtMs: number; // Must be <= decisionTimestampMs
    featureSnapshotHash: string;
    featureSchemaVersion: string;
    modelVersion: string;
    strategyVersion: string;
    configurationHash: string;
    actionTaken: string;
    actionProbability: number;
    eventualFinalLabel: number;
    labelFinality: LabelFinalityStatus;
    outcomeEvidenceIds: string[];
    realizedGrossPnlLamports: bigint;
    realizedNetPnlLamports: bigint;
    frictionFeesLamports: bigint;
    priceImpactBps: number;
  }): TrainingExampleCertificate {
    if (![params.featureAvailableAtMs, params.decisionTimestampMs, params.targetTimestampMs].every(Number.isFinite)) {
      throw new Error('INVALID_TEMPORAL_INPUT: Feature, decision and target timestamps must be finite numbers');
    }
    // 1. Anti-leakage: Feature causality check (Invariant 13)
    if (params.featureAvailableAtMs > params.decisionTimestampMs) {
      throw new Error(
        `FUTURE_FEATURE_LEAKAGE: Feature available at ${params.featureAvailableAtMs}ms > decision time ${params.decisionTimestampMs}ms`
      );
    }

    if (params.decisionTimestampMs >= params.targetTimestampMs) {
      throw new Error(
        `TARGET_CAUSALITY_VIOLATION: Decision time ${params.decisionTimestampMs}ms >= target evaluation time ${params.targetTimestampMs}ms`
      );
    }

    const payload = `${params.tokenMint}:${params.creatorIdentity}:${params.funderClusterId}:${params.decisionSlot}:${params.decisionTimestampMs}:${params.targetTimestampMs}:${params.featureSnapshotHash}:${params.eventualFinalLabel}:${params.labelFinality}`;
    const digest = createHash('sha256').update(payload).digest('hex');
    const exampleId = `EXAMPLE-CERT-${digest.slice(0, 16)}`;

    return {
      exampleId,
      tokenMint: params.tokenMint,
      creatorIdentity: params.creatorIdentity,
      funderClusterId: params.funderClusterId,
      candidateGenerationId: params.candidateGenerationId,
      decisionTimestampMs: params.decisionTimestampMs,
      decisionSlot: params.decisionSlot,
      targetTimestampMs: params.targetTimestampMs,
      featureSnapshotHash: params.featureSnapshotHash,
      featureSchemaVersion: params.featureSchemaVersion,
      modelVersion: params.modelVersion,
      strategyVersion: params.strategyVersion,
      configurationHash: params.configurationHash,
      actionTaken: params.actionTaken,
      actionProbability: params.actionProbability,
      eventualFinalLabel: params.eventualFinalLabel,
      labelFinality: params.labelFinality,
      outcomeEvidenceIds: [...params.outcomeEvidenceIds],
      realizedGrossPnlLamports: params.realizedGrossPnlLamports,
      realizedNetPnlLamports: params.realizedNetPnlLamports,
      frictionFeesLamports: params.frictionFeesLamports,
      priceImpactBps: params.priceImpactBps,
      provenanceRoot: digest,
      digest
    };
  }

  /**
   * Produces a leakage-resistant chronological walk-forward split with cluster-aware embargo gaps.
   * targetTimestampMs is the inclusive end of each label's observation window. Actual label
   * availability after that target (for example delayed settlement) is not modeled or certified.
   */
  public static createChronologicalSplit(
    examples: readonly TrainingExampleCertificate[],
    splitRatio: number = 0.8,
    embargoGapMs: number = LabelForgeAuthority.EMBARGO_GAP_MS_DEFAULT
  ): DatasetSplitEvaluation {
    if (!Number.isFinite(splitRatio) || splitRatio <= 0 || splitRatio >= 1) {
      throw new Error('INVALID_SPLIT_RATIO: Expected a finite ratio strictly between zero and one');
    }
    if (!Number.isFinite(embargoGapMs) || embargoGapMs < 0) {
      throw new Error('INVALID_EMBARGO: Expected a finite nonnegative duration');
    }
    const finalExamples = examples.filter((e) => e.labelFinality === 'ECONOMIC_FINAL');
    for (const example of finalExamples) {
      if (!Number.isFinite(example.decisionTimestampMs) || !Number.isFinite(example.targetTimestampMs)
        || example.targetTimestampMs <= example.decisionTimestampMs) {
        throw new Error(`INVALID_LABEL_WINDOW: Example ${example.exampleId} requires finite decision < target timestamps`);
      }
    }
    // Sort strictly chronologically
    const sorted = [...finalExamples].sort((a, b) => a.decisionTimestampMs - b.decisionTimestampMs);

    const splitIdx = Math.floor(sorted.length * splitRatio);
    const rawTrain = sorted.slice(0, splitIdx);
    const rawCandidateTest = sorted.slice(splitIdx);

    const trainMaxTimestamp = rawTrain.length > 0 ? rawTrain[rawTrain.length - 1].decisionTimestampMs : 0;
    const testCutoffTimestamp = trainMaxTimestamp + embargoGapMs;

    // Filter test set to enforce embargo gap and disallow overlapping creator/funder clusters
    const trainClusters = new Set(rawTrain.map((t) => t.funderClusterId).filter((c) => c !== ''));
    const trainCreators = new Set(rawTrain.map((t) => t.creatorIdentity).filter((c) => c !== ''));

    const testExamples: TrainingExampleCertificate[] = [];
    const leakageViolations: string[] = [];
    // Freeze the boundary before test exclusions: removing test rows must not admit labels
    // that observe the original holdout period. Equality overlaps the inclusive window.
    const testStartTimestamp = rawCandidateTest[0]?.decisionTimestampMs;
    const trainingExamples = rawTrain.filter((example) => {
      if (testStartTimestamp !== undefined && example.targetTimestampMs >= testStartTimestamp) {
        leakageViolations.push(`LABEL_WINDOW_OVERLAP: Example ${example.exampleId} target reaches the holdout beginning at ${testStartTimestamp}ms`);
        return false;
      }
      return true;
    });

    for (const testEx of rawCandidateTest) {
      if (testEx.decisionTimestampMs < testCutoffTimestamp) {
        leakageViolations.push(`EMBARGO_BREACH: Example ${testEx.exampleId} fell within ${embargoGapMs}ms embargo window`);
        continue;
      }

      if (trainClusters.has(testEx.funderClusterId) && testEx.funderClusterId !== '') {
        leakageViolations.push(`CLUSTER_LEAKAGE: Example ${testEx.exampleId} shares funder cluster ${testEx.funderClusterId} with train set`);
        continue;
      }

      if (trainCreators.has(testEx.creatorIdentity) && testEx.creatorIdentity !== '') {
        leakageViolations.push(`CREATOR_LEAKAGE: Example ${testEx.exampleId} shares creator ${testEx.creatorIdentity} with train set`);
        continue;
      }

      testExamples.push(testEx);
    }

    return {
      totalExamples: examples.length,
      certifiedFinalExamples: finalExamples.length,
      trainingExamples,
      testExamples,
      embargoGapMs,
      isLeakageFree: leakageViolations.length === 0,
      leakageViolations
    };
  }
}
