/**
 * SYLPH FUSION — ALPHA REALITY-X: ALPHA REALITY CERTIFICATE
 * Specifications: Master Blueprint Section XIII (Alpha Reality Certificate)
 *
 * Invariant: Only certified incremental signal value may progress to capital allocation.
 */

import { createHash } from 'node:crypto';
import type { OrthogonalizationResult } from './orthogonalization.js';

export interface AlphaRealityCertificate {
  readonly certificateId: string;
  readonly strategyId: string;
  readonly evaluationPeriodSlots: { readonly start: bigint; readonly end: bigint };
  readonly sampleSize: number;
  readonly tradedSampleSize: number;
  readonly netInformationCoefficient: number;
  readonly incrementalAlphaBps: number;
  readonly netSharpeHurdlePassed: boolean;
  readonly collinearityCheckPassed: boolean;
  readonly walkForwardVerified: boolean;
  readonly certificateState: 'PROVEN_TRUE' | 'PROVEN_FALSE' | 'INSUFFICIENT_EVIDENCE';
  readonly certificateHash: string;
  readonly issuedAtMs: number;
}

export function certifyAlphaReality(params: {
  strategyId: string;
  startSlot: bigint;
  endSlot: bigint;
  sampleSize: number;
  tradedSampleSize: number;
  orthogonalization: OrthogonalizationResult;
  netRealizedReturnBps: number;
  costHurdleBps: number;
  walkForwardVerified: boolean;
}): AlphaRealityCertificate {
  const issuedAtMs = Date.now();
  let certificateState: 'PROVEN_TRUE' | 'PROVEN_FALSE' | 'INSUFFICIENT_EVIDENCE' = 'PROVEN_TRUE';

  if (params.sampleSize < 30 || params.tradedSampleSize < 5) {
    certificateState = 'INSUFFICIENT_EVIDENCE';
  } else if (
    params.orthogonalization.isCollinearWithExistingSignals ||
    params.netRealizedReturnBps < params.costHurdleBps ||
    !params.walkForwardVerified
  ) {
    certificateState = 'PROVEN_FALSE';
  }

  const unsigned = {
    strategyId: params.strategyId,
    startSlot: params.startSlot.toString(),
    endSlot: params.endSlot.toString(),
    sampleSize: params.sampleSize,
    tradedSampleSize: params.tradedSampleSize,
    netIC: params.orthogonalization.incrementalInformationCoefficient,
    residualAlphaBps: params.orthogonalization.residualAlphaBps,
    certificateState,
    issuedAtMs,
  };

  const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const certificateId = `arc_${certificateHash.slice(0, 16)}`;

  return {
    certificateId,
    strategyId: params.strategyId,
    evaluationPeriodSlots: { start: params.startSlot, end: params.endSlot },
    sampleSize: params.sampleSize,
    tradedSampleSize: params.tradedSampleSize,
    netInformationCoefficient: params.orthogonalization.incrementalInformationCoefficient,
    incrementalAlphaBps: params.orthogonalization.residualAlphaBps,
    netSharpeHurdlePassed: params.netRealizedReturnBps >= params.costHurdleBps,
    collinearityCheckPassed: !params.orthogonalization.isCollinearWithExistingSignals,
    walkForwardVerified: params.walkForwardVerified,
    certificateState,
    certificateHash,
    issuedAtMs,
  };
}
