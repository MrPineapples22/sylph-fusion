/**
 * SYLPH FUSION — SAFE-CANARY-X: CANARY OUTCOME CERTIFICATE
 * Specifications: Master Blueprint Section XXIV (Canary Outcome Certificate)
 */

import { createHash } from 'node:crypto';
import type { CanaryLevel } from './canary-manifest.js';

export interface CanaryOutcomeCertificate {
  readonly certificateId: string;
  readonly experimentId: string;
  readonly canaryLevel: CanaryLevel;
  readonly policyArtifactId: string;
  readonly sampleSize: number;
  readonly realizedPnLLamports: bigint;
  readonly causalTreatmentEffectBps: number;
  readonly isHypothesisSupported: boolean;
  readonly isReconciled: boolean;
  readonly certificateHash: string;
  readonly certifiedAtMs: number;
}

export function certifyCanaryOutcome(params: {
  experimentId: string;
  canaryLevel: CanaryLevel;
  policyArtifactId: string;
  sampleSize: number;
  realizedPnLLamports: bigint;
  causalTreatmentEffectBps: number;
  isReconciled: boolean;
}): CanaryOutcomeCertificate {
  const certifiedAtMs = Date.now();
  const isHypothesisSupported = params.causalTreatmentEffectBps > 0 && params.isReconciled;

  const unsigned = {
    experimentId: params.experimentId,
    level: params.canaryLevel,
    policyId: params.policyArtifactId,
    pnl: params.realizedPnLLamports.toString(),
    effectBps: params.causalTreatmentEffectBps,
    isReconciled: params.isReconciled,
    certifiedAtMs,
  };

  const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const certificateId = `coc_${certificateHash.slice(0, 16)}`;

  return {
    certificateId,
    experimentId: params.experimentId,
    canaryLevel: params.canaryLevel,
    policyArtifactId: params.policyArtifactId,
    sampleSize: params.sampleSize,
    realizedPnLLamports: params.realizedPnLLamports,
    causalTreatmentEffectBps: params.causalTreatmentEffectBps,
    isHypothesisSupported,
    isReconciled: params.isReconciled,
    certificateHash,
    certifiedAtMs,
  };
}
