/**
 * SYLPH FUSION — SIGNAL ECOLOGY-X: SPECIALIST CONTRACT
 * Specifications: Master Blueprint Section XII (Intelligence Specialist Contract) & Section XV
 *
 * Invariant: All predictive systems output SpecialistPrediction.
 * Raw intelligence outputs cannot directly mutate capital or sign.
 */

import { SignalRole } from './signal-role.js';

export interface QuantileEstimates {
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
}

export interface SpecialistPrediction {
  readonly specialistId: string;
  readonly version: string;
  readonly role: SignalRole;
  readonly target: string;
  readonly horizonSec: number;
  readonly pointEstimate: number;
  readonly quantiles: QuantileEstimates;
  readonly uncertainty: number;
  readonly supportedContext: readonly string[];
  readonly evidenceRoot: string;
  readonly evidenceAncestry: readonly string[];
  readonly modelHash: string;
  readonly availableAtMs: number;
}
