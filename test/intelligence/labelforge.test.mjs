import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LabelForgeAuthority
} from '../../src/intelligence/science/labelforge.ts';

function example(id, decisionTimestampMs, targetTimestampMs, overrides = {}) {
  return LabelForgeAuthority.certifyExample({
    tokenMint: id, creatorIdentity: `creator-${id}`, funderClusterId: `cluster-${id}`,
    candidateGenerationId: id, decisionTimestampMs, targetTimestampMs, decisionSlot: 1,
    featureAvailableAtMs: decisionTimestampMs - 1, featureSnapshotHash: id,
    featureSchemaVersion: '1', modelVersion: '1', strategyVersion: '1', configurationHash: 'cfg',
    actionTaken: 'BUY', actionProbability: 1, eventualFinalLabel: 1, labelFinality: 'ECONOMIC_FINAL',
    outcomeEvidenceIds: [id], realizedGrossPnlLamports: 2n, realizedNetPnlLamports: 1n,
    frictionFeesLamports: 1n, priceImpactBps: 0, ...overrides,
  });
}

describe('LABELFORGE: Leakage-Resistant Economic Dataset Certification (Upgrade 4)', () => {
  it('certifies examples and strictly blocks future feature leakage (Invariant 13)', () => {
    const decisionTime = 1790400000000;
    const targetTime = decisionTime + 600_000; // 10 minutes later

    // 1. Valid causal observation
    const cert = LabelForgeAuthority.certifyExample({
      tokenMint: 'TokenCausal111111111111111111111111111111111',
      creatorIdentity: 'CreatorAlpha',
      funderClusterId: 'Cluster1',
      candidateGenerationId: 'GEN-001',
      decisionTimestampMs: decisionTime,
      decisionSlot: 289450000,
      targetTimestampMs: targetTime,
      featureAvailableAtMs: decisionTime - 500, // Available 500ms before decision
      featureSnapshotHash: 'feat_hash_123',
      featureSchemaVersion: '1.0.0',
      modelVersion: 'MODEL-V1',
      strategyVersion: 'STRAT-V1',
      configurationHash: 'cfg_hash_123',
      actionTaken: 'BUY',
      actionProbability: 0.75,
      eventualFinalLabel: 1,
      labelFinality: 'ECONOMIC_FINAL',
      outcomeEvidenceIds: ['TX-FILL-1', 'TX-SETTLE-1'],
      realizedGrossPnlLamports: 50_000_000n,
      realizedNetPnlLamports: 42_000_000n,
      frictionFeesLamports: 8_000_000n,
      priceImpactBps: 80
    });

    assert.ok(cert.exampleId.startsWith('EXAMPLE-CERT-'));
    assert.equal(cert.labelFinality, 'ECONOMIC_FINAL');

    // 2. Future-leaking feature: availableAt > decisionTime -> FAIL CLOSED
    assert.throws(
      () =>
        LabelForgeAuthority.certifyExample({
          tokenMint: 'TokenLeaky111111111111111111111111111111111',
          creatorIdentity: 'CreatorBeta',
          funderClusterId: 'Cluster2',
          candidateGenerationId: 'GEN-002',
          decisionTimestampMs: decisionTime,
          decisionSlot: 289450000,
          targetTimestampMs: targetTime,
          featureAvailableAtMs: decisionTime + 100, // 100ms in the future!
          featureSnapshotHash: 'feat_hash_leaky',
          featureSchemaVersion: '1.0.0',
          modelVersion: 'MODEL-V1',
          strategyVersion: 'STRAT-V1',
          configurationHash: 'cfg_hash_123',
          actionTaken: 'BUY',
          actionProbability: 0.8,
          eventualFinalLabel: 1,
          labelFinality: 'ECONOMIC_FINAL',
          outcomeEvidenceIds: [],
          realizedGrossPnlLamports: 0n,
          realizedNetPnlLamports: 0n,
          frictionFeesLamports: 0n,
          priceImpactBps: 0
        }),
      /FUTURE_FEATURE_LEAKAGE/
    );
  });

  it('creates chronological split with embargo gaps and cluster-aware isolation', () => {
    const baseTime = 1790400000000;
    const examples = [];

    // Create 10 historical training examples spanning hours 0 to 5
    for (let i = 0; i < 10; i++) {
      examples.push(
        LabelForgeAuthority.certifyExample({
          tokenMint: `MintTrain_${i}`,
          creatorIdentity: `Creator_${i}`,
          funderClusterId: `Cluster_${i % 3}`,
          candidateGenerationId: `GEN-${i}`,
          decisionTimestampMs: baseTime + i * 360_000, // 6 min intervals
          decisionSlot: 289450000 + i * 100,
          targetTimestampMs: baseTime + i * 360_000 + 120_000,
          featureAvailableAtMs: baseTime + i * 360_000 - 100,
          featureSnapshotHash: `hash_${i}`,
          featureSchemaVersion: '1.0.0',
          modelVersion: 'V1',
          strategyVersion: 'S1',
          configurationHash: 'C1',
          actionTaken: 'BUY',
          actionProbability: 0.7,
          eventualFinalLabel: 1,
          labelFinality: 'ECONOMIC_FINAL',
          outcomeEvidenceIds: [`EV-${i}`],
          realizedGrossPnlLamports: 10_000_000n,
          realizedNetPnlLamports: 9_000_000n,
          frictionFeesLamports: 1_000_000n,
          priceImpactBps: 50
        })
      );
    }

    const split = LabelForgeAuthority.createChronologicalSplit(examples, 0.7, 600_000); // 10 min embargo
    assert.equal(split.totalExamples, 10);
    assert.equal(split.certifiedFinalExamples, 10);
    assert.ok(split.trainingExamples.length > 0);
  });

  it('purges a long training outcome that reaches beyond an otherwise valid embargo', () => {
    const train = example('train', 0, 100_000);
    const holdout = example('test', 10_000, 20_000);
    const split = LabelForgeAuthority.createChronologicalSplit([train, holdout], 0.5, 1_000);
    assert.deepEqual(split.trainingExamples, []);
    assert.deepEqual(split.testExamples, [holdout]);
    assert.equal(split.isLeakageFree, false);
    assert.match(split.leakageViolations[0], /LABEL_WINDOW_OVERLAP/);
  });

  it('treats outcome end equality as overlap and accepts an end immediately before holdout', () => {
    for (const target of [9_999, 10_000, 10_001]) {
      const train = example('train', 0, target);
      const holdout = example('test', 10_000, 20_000);
      const split = LabelForgeAuthority.createChronologicalSplit([holdout, train], 0.5, 0);
      assert.equal(split.trainingExamples.length, target < 10_000 ? 1 : 0);
      assert.equal(split.isLeakageFree, target < 10_000);
      assert.deepEqual(split.testExamples, [holdout]);
    }
  });

  it('keeps the original holdout boundary when its first row is excluded by embargo', () => {
    const rows = [example('a', 0, 10_500), example('b', 9_000, 9_500),
      example('c', 10_000, 10_100), example('d', 20_000, 21_000)];
    const split = LabelForgeAuthority.createChronologicalSplit(rows, 0.5, 2_000);
    assert.deepEqual(split.trainingExamples, [rows[1]]);
    assert.deepEqual(split.testExamples, [rows[3]]);
    assert.ok(split.leakageViolations.some(v => v.startsWith('LABEL_WINDOW_OVERLAP')));
    assert.ok(split.leakageViolations.some(v => v.startsWith('EMBARGO_BREACH')));
  });

  it('preserves creator/funder exclusions, final-only selection, and input order', () => {
    const train = example('a', 0, 100);
    const creator = example('b', 1_000, 1_100, { creatorIdentity: train.creatorIdentity });
    const funder = example('c', 2_000, 2_100, { funderClusterId: train.funderClusterId });
    const valid = example('d', 3_000, 3_100);
    const pending = { ...train, labelFinality: 'SETTLEMENT_PENDING', targetTimestampMs: undefined };
    const rows = Object.freeze([valid, pending, funder, train, creator]);
    const split = LabelForgeAuthority.createChronologicalSplit(rows, 0.25, 0);
    assert.deepEqual(split.trainingExamples, [train]);
    assert.deepEqual(split.testExamples, [valid]);
    assert.equal(split.certifiedFinalExamples, 4);
    assert.equal(rows[0], valid);
    assert.ok(split.leakageViolations.some(v => v.startsWith('CREATOR_LEAKAGE')));
    assert.ok(split.leakageViolations.some(v => v.startsWith('CLUSTER_LEAKAGE')));
  });

  it('rejects missing and nonfinite clocks before certifying or sorting final examples', () => {
    const valid = example('valid', 0, 100);
    for (const field of ['decisionTimestampMs', 'targetTimestampMs', 'featureAvailableAtMs']) {
      for (const value of [undefined, null, NaN, Infinity, -Infinity, '100']) {
        assert.throws(() => example('bad', 0, 100, { [field]: value }), /INVALID_TEMPORAL_INPUT/);
        if (field !== 'featureAvailableAtMs') {
          assert.throws(() => LabelForgeAuthority.createChronologicalSplit(
            [{ ...valid, [field]: value }], 0.5, 0), /INVALID_LABEL_WINDOW/);
        }
      }
    }
    for (const targetTimestampMs of [-1, 0]) {
      assert.throws(() => LabelForgeAuthority.createChronologicalSplit(
        [{ ...valid, targetTimestampMs }], 0.5, 0), /INVALID_LABEL_WINDOW/);
    }
    // Relative replay clocks and pre-decision feature timestamps remain supported.
    assert.equal(example('relative', -100, -1).decisionTimestampMs, -100);
  });

  it('rejects invalid split controls and handles an empty final cohort', () => {
    for (const ratio of [0, 1, -0.1, 1.1, NaN, Infinity, null]) {
      assert.throws(() => LabelForgeAuthority.createChronologicalSplit([], ratio, 0), /INVALID_SPLIT_RATIO/);
    }
    for (const embargo of [-1, NaN, Infinity, null]) {
      assert.throws(() => LabelForgeAuthority.createChronologicalSplit([], 0.5, embargo), /INVALID_EMBARGO/);
    }
    const split = LabelForgeAuthority.createChronologicalSplit([], 0.5, 0);
    assert.deepEqual(split.trainingExamples, []);
    assert.deepEqual(split.testExamples, []);
  });

  it('preserves target-before-test isolation for mixed horizons and split ratios', () => {
    const rows = Array.from({ length: 30 }, (_, i) => example(`m${i}`, i * 1_000, i * 1_000 + (i % 5 + 1) * 750));
    for (const ratio of [0.2, 0.5, 0.8]) {
      for (const embargo of [0, 1_000, 5_000]) {
        const split = LabelForgeAuthority.createChronologicalSplit(rows, ratio, embargo);
        assert.ok(split.trainingExamples.length > 0);
        assert.ok(split.testExamples.length > 0);
        for (const train of split.trainingExamples) {
          for (const holdout of split.testExamples) assert.ok(train.targetTimestampMs < holdout.decisionTimestampMs);
        }
      }
    }
  });
});
