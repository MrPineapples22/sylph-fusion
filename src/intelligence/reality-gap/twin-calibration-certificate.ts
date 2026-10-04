/**
 * SYLPH FUSION — REALITY-GAP-X: TWIN CALIBRATION CERTIFICATE
 * Specifications: Master Blueprint Section XVII, XVIII
 */

import { createHash } from 'node:crypto';
import type { RealityGapVector } from './reality-gap-vector.js';
import { type TwinTrustLevel, type DownstreamTwinConstraints, evaluateDownstreamConstraints } from './twin-trust-state.js';

export interface TwinCalibrationCertificate {
  readonly certificateId: string;
  readonly venue: string;
  readonly sampleCount: number;
  readonly medianPriceResidualBps: number;
  readonly p95PriceResidualBps: number;
  readonly medianLandingLagSlots: number;
  readonly trustLevel: TwinTrustLevel;
  readonly constraints: DownstreamTwinConstraints;
  readonly isCalibrationActive: boolean;
  readonly certificateHash: string;
  readonly issuedAtMs: number;
}

export function certifyTwinCalibration(params: {
  venue: string;
  residuals: readonly RealityGapVector[];
}): TwinCalibrationCertificate {
  const issuedAtMs = Date.now();
  const n = params.residuals.length;

  if (n < 10) {
    const constraints = evaluateDownstreamConstraints('CALIBRATING');
    const unsigned = { venue: params.venue, n, trust: 'CALIBRATING', issuedAtMs };
    const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    return {
      certificateId: `tcc_${certificateHash.slice(0, 16)}`,
      venue: params.venue,
      sampleCount: n,
      medianPriceResidualBps: 0,
      p95PriceResidualBps: 0,
      medianLandingLagSlots: 0,
      trustLevel: 'CALIBRATING',
      constraints,
      isCalibrationActive: false,
      certificateHash,
      issuedAtMs,
    };
  }

  const sortedPrice = params.residuals.map((r) => Math.abs(r.priceResidualBps)).sort((a, b) => a - b);
  const medianPrice = sortedPrice[Math.floor(n / 2)]!;
  const p95Price = sortedPrice[Math.floor(n * 0.95)]!;

  const sortedLag = params.residuals.map((r) => Math.max(0, r.landingResidualSlots)).sort((a, b) => a - b);
  const medianLag = sortedLag[Math.floor(n / 2)]!;

  let trustLevel: TwinTrustLevel = 'SHADOW_TRUSTED';
  if (p95Price > 400 || medianLag > 3) {
    trustLevel = 'DEGRADED';
  } else if (p95Price > 200 || medianLag > 1) {
    trustLevel = 'WATCH';
  }

  const constraints = evaluateDownstreamConstraints(trustLevel);
  const unsigned = {
    venue: params.venue,
    sampleCount: n,
    medianPrice,
    p95Price,
    medianLag,
    trustLevel,
    issuedAtMs,
  };

  const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const certificateId = `tcc_${certificateHash.slice(0, 16)}`;

  return {
    certificateId,
    venue: params.venue,
    sampleCount: n,
    medianPriceResidualBps: medianPrice,
    p95PriceResidualBps: p95Price,
    medianLandingLagSlots: medianLag,
    trustLevel,
    constraints,
    isCalibrationActive: trustLevel === 'SHADOW_TRUSTED' || trustLevel === 'WATCH',
    certificateHash,
    issuedAtMs,
  };
}
