/**
 * SYLPH FUSION — MODEL EPOCH AUTHORITY & FEATURETIME LINEAGE
 * Specifications: Sections 47 (Model Epoch), 48 (Calibration Firewall), 49 (FeatureTime), 103 (Invariants 12, 13)
 *
 * Implements:
 * 1. ModelArtifactCertificate & ModelEpoch: Immutable model weights and pipeline manifest binding.
 * 2. FeatureTime Lineage: Enforces strict point-in-time invariant:
 *    For every feature f, f.availableAt <= decisionTime.
 *    Any future information leakage triggers fail-closed feature rejection.
 */

import { createHash } from 'node:crypto';

export interface ModelArtifactCertificate {
  readonly certificateId: string;
  readonly modelName: string;
  readonly modelVersion: string;
  readonly artifactSha256: string;
  readonly featureSchemaHash: string;
  readonly transformationVersion: string;
  readonly trainingDatasetRoot: string;
  readonly calibrationArtifactSha256: string;
  readonly supportedRegimes: readonly string[];
  readonly registeredAtMs: number;
}

export interface ModelEpoch {
  readonly epochId: string;
  readonly epochNumber: number;
  readonly activeModels: ReadonlyMap<string, ModelArtifactCertificate>;
  readonly activationSlot: number;
  readonly activatedAtMs: number;
}

export interface FeatureObservation<T = number | string | boolean> {
  readonly featureName: string;
  readonly value: T;
  readonly unit: string;
  readonly providerId: string;
  readonly contextSlot: number;
  readonly observedTimeMs: number;
  readonly availableAtMs: number;
  readonly evidenceHash: string;
}

export class ModelEpochAuthority {
  private activeEpochNumber = 1;
  private registeredModels = new Map<string, ModelArtifactCertificate>();
  private activeEpoch?: ModelEpoch;

  /**
   * Registers an immutable ModelArtifactCertificate (Section 47).
   */
  public registerModel(params: {
    modelName: string;
    modelVersion: string;
    artifactSha256: string;
    featureSchemaHash: string;
    transformationVersion: string;
    trainingDatasetRoot: string;
    calibrationArtifactSha256: string;
    supportedRegimes: readonly string[];
  }): ModelArtifactCertificate {
    const { modelName, modelVersion, artifactSha256, featureSchemaHash } = params;

    const certId = `MCERT-${createHash('sha256')
      .update(`${modelName}:${modelVersion}:${artifactSha256}:${featureSchemaHash}`)
      .digest('hex')
      .slice(0, 16)}`;

    const cert: ModelArtifactCertificate = {
      certificateId: certId,
      ...params,
      registeredAtMs: Date.now(),
    };

    this.registeredModels.set(modelName, cert);
    return cert;
  }

  /**
   * Binds exact active models into an immutable ModelEpoch (Section 47).
   */
  public activateEpoch(activationSlot: number): ModelEpoch {
    if (this.registeredModels.size === 0) {
      throw new Error('MODEL_EPOCH_FAILED: cannot activate epoch with 0 registered models');
    }

    const epochId = `EPOCH-${this.activeEpochNumber}-${Date.now()}`;
    const epoch: ModelEpoch = {
      epochId,
      epochNumber: this.activeEpochNumber,
      activeModels: new Map(this.registeredModels),
      activationSlot,
      activatedAtMs: Date.now(),
    };

    this.activeEpoch = epoch;
    this.activeEpochNumber++;
    return epoch;
  }

  public getActiveEpoch(): ModelEpoch | undefined {
    return this.activeEpoch;
  }

  /**
   * FeatureTime Validator (Section 49 & Invariant 13):
   * Proves that feature.availableAt <= decisionAtMs.
   * Any future-looking feature is rejected with an invariant error.
   */
  public validateFeaturePointInTime<T>(
    feature: FeatureObservation<T>,
    decisionAtMs: number
  ): boolean {
    if (feature.availableAtMs > decisionAtMs) {
      throw new Error(
        `FEATURETIME_INVARIANT_VIOLATION: Feature '${feature.featureName}' availableAt (${feature.availableAtMs}) > decisionTime (${decisionAtMs}). Future information leakage detected!`
      );
    }
    return true;
  }
}

export const globalModelEpoch = new ModelEpochAuthority();
