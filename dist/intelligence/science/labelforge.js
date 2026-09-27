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
export class LabelForgeAuthority {
    static EMBARGO_GAP_MS_DEFAULT = 3_600_000; // 1 hour embargo
    /**
     * Certifies an economic training example, verifying point-in-time causality.
     */
    static certifyExample(params) {
        // 1. Anti-leakage: Feature causality check (Invariant 13)
        if (params.featureAvailableAtMs > params.decisionTimestampMs) {
            throw new Error(`FUTURE_FEATURE_LEAKAGE: Feature available at ${params.featureAvailableAtMs}ms > decision time ${params.decisionTimestampMs}ms`);
        }
        if (params.decisionTimestampMs >= params.targetTimestampMs) {
            throw new Error(`TARGET_CAUSALITY_VIOLATION: Decision time ${params.decisionTimestampMs}ms >= target evaluation time ${params.targetTimestampMs}ms`);
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
     */
    static createChronologicalSplit(examples, splitRatio = 0.8, embargoGapMs = LabelForgeAuthority.EMBARGO_GAP_MS_DEFAULT) {
        const finalExamples = examples.filter((e) => e.labelFinality === 'ECONOMIC_FINAL');
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
        const testExamples = [];
        const leakageViolations = [];
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
            trainingExamples: rawTrain,
            testExamples,
            embargoGapMs,
            isLeakageFree: leakageViolations.length === 0,
            leakageViolations
        };
    }
}
//# sourceMappingURL=labelforge.js.map