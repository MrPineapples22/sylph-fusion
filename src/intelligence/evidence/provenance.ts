/**
 * SOL-SYLPH Intelligence Evidence Provenance Contract
 * Specifications: Section 8 (Remove remaining synthetic intelligence inputs)
 *
 * Every intelligence and decision field must have explicit provenance.
 * Non-negotiable invariant:
 * Absence of evidence must never be converted into favorable evidence.
 * Do not turn unavailable fields into zero unless zero itself was observed.
 */

export type EvidenceStatus = 'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE';

export interface Evidence<T> {
  readonly value: T | null;
  readonly status: EvidenceStatus;
  readonly source: string | null;
  readonly observedAt: number | null;
  readonly validatedAt: number | null;
  readonly confidence: number | null;
}

export function observedEvidence<T>(
  value: T,
  source: string,
  observedAt = Date.now(),
  validatedAt = Date.now(),
  confidence = 1.0
): Evidence<T> {
  return {
    value,
    status: 'OBSERVED',
    source,
    observedAt,
    validatedAt,
    confidence,
  };
}

export function derivedEvidence<T>(
  value: T,
  source: string,
  observedAt: number | null = null,
  validatedAt = Date.now(),
  confidence = 0.9
): Evidence<T> {
  return {
    value,
    status: 'DERIVED',
    source,
    observedAt,
    validatedAt,
    confidence,
  };
}

export function unavailableEvidence<T = any>(
  source: string | null = null
): Evidence<T> {
  return {
    value: null,
    status: 'UNAVAILABLE',
    source,
    observedAt: null,
    validatedAt: null,
    confidence: null,
  };
}

export function staleEvidence<T>(
  value: T,
  source: string,
  observedAt: number,
  validatedAt = Date.now(),
  confidence = 0.2
): Evidence<T> {
  return {
    value,
    status: 'STALE',
    source,
    observedAt,
    validatedAt,
    confidence,
  };
}
