/**
 * SYLPH FUSION — REALITY-GAP-X: TWIN TRUST STATE & DOWNSTREAM CONSTRAINTS
 * Specifications: Master Blueprint Section XVIII (Twin Trust)
 *
 * Invariant: Twin trust must tighten actual downstream execution and allocation constraints.
 * Execution trust degraded -> larger cost uncertainty -> smaller allocation -> shorter permit TTL.
 * Evacuation trust quarantined -> no new exposure permitted.
 */

export type TwinTrustLevel =
  | 'UNAVAILABLE'
  | 'CALIBRATING'
  | 'SHADOW_TRUSTED'
  | 'WATCH'
  | 'DEGRADED'
  | 'QUARANTINED';

export interface DownstreamTwinConstraints {
  readonly allocationMultiplier: number;
  readonly costUncertaintyMultiplier: number;
  readonly maxPermitTtlSlots: number;
  readonly newExposurePermitted: boolean;
  readonly reason: string;
}

export function evaluateDownstreamConstraints(level: TwinTrustLevel): DownstreamTwinConstraints {
  switch (level) {
    case 'SHADOW_TRUSTED':
      return {
        allocationMultiplier: 1.0,
        costUncertaintyMultiplier: 1.0,
        maxPermitTtlSlots: 150,
        newExposurePermitted: true,
        reason: 'Twin calibration verified and trusted',
      };
    case 'WATCH':
      return {
        allocationMultiplier: 0.75,
        costUncertaintyMultiplier: 1.25,
        maxPermitTtlSlots: 100,
        newExposurePermitted: true,
        reason: 'Twin under observation with minor residual drift',
      };
    case 'DEGRADED':
      return {
        allocationMultiplier: 0.40,
        costUncertaintyMultiplier: 2.0,
        maxPermitTtlSlots: 40,
        newExposurePermitted: true,
        reason: 'Twin degraded: significant residuals; constraining risk and short TTL',
      };
    case 'CALIBRATING':
      return {
        allocationMultiplier: 0.0,
        costUncertaintyMultiplier: 3.0,
        maxPermitTtlSlots: 0,
        newExposurePermitted: false,
        reason: 'Twin currently calibrating: insufficient samples for live exposure',
      };
    case 'UNAVAILABLE':
    case 'QUARANTINED':
    default:
      return {
        allocationMultiplier: 0.0,
        costUncertaintyMultiplier: 5.0,
        maxPermitTtlSlots: 0,
        newExposurePermitted: false,
        reason: 'Twin quarantined or unavailable: all new exposure strictly forbidden',
      };
  }
}
