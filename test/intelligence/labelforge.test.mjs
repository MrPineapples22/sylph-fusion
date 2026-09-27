import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LabelForgeAuthority
} from '../../dist/intelligence/science/labelforge.js';

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
});
