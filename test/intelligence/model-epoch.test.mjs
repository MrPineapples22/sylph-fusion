import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelEpochAuthority } from '../../dist/intelligence/science/model-epoch.js';

test('ModelEpochAuthority: registers ModelArtifactCertificates and activates immutable epoch', () => {
  const authority = new ModelEpochAuthority();

  const cert = authority.registerModel({
    modelName: 'SPIE_MOMENTUM_NET_EV',
    modelVersion: 'v2.1.0',
    artifactSha256: 'sha256-weights-89a7df6b',
    featureSchemaHash: 'sha256-schema-4455aa',
    transformationVersion: 'tf-v1',
    trainingDatasetRoot: 's3://datasets/clean-good-train-2026-09.parquet',
    calibrationArtifactSha256: 'sha256-platt-calib-v2',
    supportedRegimes: ['TRENDING', 'NORMAL'],
  });

  assert.ok(cert.certificateId.startsWith('MCERT-'));
  assert.equal(cert.modelName, 'SPIE_MOMENTUM_NET_EV');

  const epoch = authority.activateEpoch(310000000);
  assert.equal(epoch.epochNumber, 1);
  assert.equal(epoch.activeModels.size, 1);
  assert.equal(epoch.activeModels.get('SPIE_MOMENTUM_NET_EV')?.modelVersion, 'v2.1.0');
});

test('FeatureTime Lineage: rejects future information leakage (Invariant 13)', () => {
  const authority = new ModelEpochAuthority();
  const decisionTimeMs = 1790400000000;

  // 1. Valid point-in-time feature: available 500ms before decision
  const validFeature = {
    featureName: 'pump_flow_acceleration',
    value: 12.5,
    unit: 'sol_per_sec2',
    providerId: 'yellowstone-grpc',
    contextSlot: 310000000,
    observedTimeMs: decisionTimeMs - 600,
    availableAtMs: decisionTimeMs - 500, // <= decisionTime
    evidenceHash: 'hash-flow-1',
  };
  assert.equal(authority.validateFeaturePointInTime(validFeature, decisionTimeMs), true);

  // 2. Future information leakage: feature timestamped in the future
  const leakedFeature = {
    featureName: 'future_exit_price',
    value: 0.005,
    unit: 'sol',
    providerId: 'future-oracle',
    contextSlot: 310000005,
    observedTimeMs: decisionTimeMs + 200,
    availableAtMs: decisionTimeMs + 200, // > decisionTime!
    evidenceHash: 'hash-leak-1',
  };

  assert.throws(
    () => authority.validateFeaturePointInTime(leakedFeature, decisionTimeMs),
    /FEATURETIME_INVARIANT_VIOLATION/
  );
});
