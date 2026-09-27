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
export class ModelEpochAuthority {
    activeEpochNumber = 1;
    registeredModels = new Map();
    activeEpoch;
    /**
     * Registers an immutable ModelArtifactCertificate (Section 47).
     */
    registerModel(params) {
        const { modelName, modelVersion, artifactSha256, featureSchemaHash } = params;
        const certId = `MCERT-${createHash('sha256')
            .update(`${modelName}:${modelVersion}:${artifactSha256}:${featureSchemaHash}`)
            .digest('hex')
            .slice(0, 16)}`;
        const cert = {
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
    activateEpoch(activationSlot) {
        if (this.registeredModels.size === 0) {
            throw new Error('MODEL_EPOCH_FAILED: cannot activate epoch with 0 registered models');
        }
        const epochId = `EPOCH-${this.activeEpochNumber}-${Date.now()}`;
        const epoch = {
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
    getActiveEpoch() {
        return this.activeEpoch;
    }
    /**
     * FeatureTime Validator (Section 49 & Invariant 13):
     * Proves that feature.availableAt <= decisionAtMs.
     * Any future-looking feature is rejected with an invariant error.
     */
    validateFeaturePointInTime(feature, decisionAtMs) {
        if (feature.availableAtMs > decisionAtMs) {
            throw new Error(`FEATURETIME_INVARIANT_VIOLATION: Feature '${feature.featureName}' availableAt (${feature.availableAtMs}) > decisionTime (${decisionAtMs}). Future information leakage detected!`);
        }
        return true;
    }
}
export const globalModelEpoch = new ModelEpochAuthority();
//# sourceMappingURL=model-epoch.js.map