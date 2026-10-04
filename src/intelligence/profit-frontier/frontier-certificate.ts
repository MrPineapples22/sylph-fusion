/**
 * SYLPH FUSION — PROFIT FRONTIER-X: FRONTIER CERTIFICATE
 * Specifications: Master Blueprint Section LI (Frontier Certificate)
 */

import { createHash } from 'node:crypto';
import type { EngineeringCandidate } from './engineering-candidate.js';

export interface FrontierCertificate {
  readonly certificateId: string;
  readonly optimalCandidateId: string;
  readonly targetSubsystem: string;
  readonly expectedNetBenefitUsd: number;
  readonly paretoCandidates: readonly EngineeringCandidate[];
  readonly certificateHash: string;
  readonly certifiedAtMs: number;
}

export function certifyProfitFrontier(candidates: readonly EngineeringCandidate[]): FrontierCertificate {
  const certifiedAtMs = Date.now();
  if (candidates.length === 0) {
    const fallbackId = 'none';
    const certificateHash = createHash('sha256').update(`NONE:${certifiedAtMs}`).digest('hex');
    return {
      certificateId: `frc_${certificateHash.slice(0, 16)}`,
      optimalCandidateId: fallbackId,
      targetSubsystem: 'NONE',
      expectedNetBenefitUsd: 0,
      paretoCandidates: [],
      certificateHash,
      certifiedAtMs,
    };
  }

  // Rank by ROI: expectedNetBenefitUsd / estimatedEffortHours
  const sorted = [...candidates].sort((a, b) => {
    const roiA = a.expectedNetBenefitUsd / Math.max(1, a.estimatedEffortHours);
    const roiB = b.expectedNetBenefitUsd / Math.max(1, b.estimatedEffortHours);
    return roiB - roiA;
  });

  const optimal = sorted[0]!;
  const unsigned = {
    optimalId: optimal.candidateId,
    subsystem: optimal.targetSubsystem,
    netBenefit: optimal.expectedNetBenefitUsd,
    certifiedAtMs,
  };

  const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const certificateId = `frc_${certificateHash.slice(0, 16)}`;

  return {
    certificateId,
    optimalCandidateId: optimal.candidateId,
    targetSubsystem: optimal.targetSubsystem,
    expectedNetBenefitUsd: optimal.expectedNetBenefitUsd,
    paretoCandidates: Object.freeze(sorted),
    certificateHash,
    certifiedAtMs,
  };
}
