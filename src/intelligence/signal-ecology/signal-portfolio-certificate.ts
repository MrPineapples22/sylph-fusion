/**
 * SYLPH FUSION — SIGNAL ECOLOGY-X: SIGNAL PORTFOLIO CERTIFICATE
 * Specifications: Master Blueprint Section XV (Signal Portfolio Certificate)
 *
 * Output: SignalPortfolioCertificate.
 * Distinct decomposed scores across all 7 roles; never collapsed into one score.
 */

import { createHash } from 'node:crypto';
import type { EcologyAggregationResult } from './family-aggregator.js';
import type { DecomposedRoleProfile } from './signal-role.js';

export interface SignalPortfolioCertificate {
  readonly certificateId: string;
  readonly targetMint: string;
  readonly slot: bigint;
  readonly roleProfile: DecomposedRoleProfile;
  readonly effectiveIndependentAlphaUnits: number;
  readonly alphaConcentrationBps: number;
  readonly redundancyPenalties: Record<string, number>;
  readonly isEcologySound: boolean;
  readonly certificateHash: string;
  readonly issuedAtMs: number;
}

export function certifySignalPortfolio(params: {
  targetMint: string;
  slot: bigint;
  aggregation: EcologyAggregationResult;
  roleProfile: DecomposedRoleProfile;
}): SignalPortfolioCertificate {
  const issuedAtMs = Date.now();
  const isEcologySound =
    params.aggregation.effectiveIndependentAlphaUnits >= 2 &&
    params.roleProfile.survivalProbability >= 0.70 &&
    params.roleProfile.authenticityProven;

  const unsigned = {
    targetMint: params.targetMint,
    slot: params.slot.toString(),
    roleProfile: params.roleProfile,
    independentUnits: params.aggregation.effectiveIndependentAlphaUnits,
    isEcologySound,
    issuedAtMs,
  };

  const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const certificateId = `spc_${certificateHash.slice(0, 16)}`;

  return {
    certificateId,
    targetMint: params.targetMint,
    slot: params.slot,
    roleProfile: params.roleProfile,
    effectiveIndependentAlphaUnits: params.aggregation.effectiveIndependentAlphaUnits,
    alphaConcentrationBps: Math.round(10_000 / Math.max(1, params.aggregation.effectiveIndependentAlphaUnits)),
    redundancyPenalties: params.aggregation.redundancyPenalties,
    isEcologySound,
    certificateHash,
    issuedAtMs,
  };
}
