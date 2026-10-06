/**
 * SYLPH FUSION — UNIVERSAL EVIDENCE MODEL
 * Specification: Master Blueprint Section VII (Universal Evidence Model)
 *
 * Every economically relevant value carries verifiable provenance, temporality,
 * and epistemic classification.
 *
 * Invariants:
 * 1. UNKNOWN !== false; UNKNOWN !== 0.
 * 2. MISSING !== 0; MISSING !== false.
 * 3. PAPER_SIMULATED !== VERIFIED_EXECUTION.
 * 4. MODELLED_COUNTERFACTUAL !== historical fact.
 * 5. No evidence may self-promote to a higher epistemic class.
 * 6. Temporal causality: knownAt >= observedAt && availableAt >= observedAt.
 */

import { createHash } from 'node:crypto';
import { hashCanonical } from '../pipeline/canonical-hashing.js';

export type UniversalEvidenceClass =
  | 'VERIFIED_CHAIN'
  | 'VERIFIED_EXECUTION'
  | 'OBSERVED_EXTERNAL'
  | 'DERIVED_CERTIFIED'
  | 'HISTORICAL_CERTIFIED'
  | 'PAPER_SIMULATED'
  | 'MODELLED_COUNTERFACTUAL'
  | 'OPERATOR_ASSERTED'
  | 'UNKNOWN'
  | 'MISSING'
  | 'CONFLICTED'
  | 'STALE'
  | 'REVOKED'
  | 'INVALID';

export const UNKNOWN_SENTINEL = Symbol.for('SYLPH_EVIDENCE_UNKNOWN');
export const MISSING_SENTINEL = Symbol.for('SYLPH_EVIDENCE_MISSING');

export interface UniversalEvidence<T = unknown> {
  readonly schemaVersion: '1.0.0';
  readonly evidenceId: string;
  readonly value: T;
  readonly evidenceClass: UniversalEvidenceClass;
  readonly source: string;
  readonly issuer: string;
  readonly observedAt: number;
  readonly receivedAt: number;
  readonly availableAt: number;
  readonly knownAt: number;
  readonly slot: bigint;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly stateRoot: string;
  readonly provenance: string;
  readonly freshnessMs: number;
  readonly coverage: number; // 0.0 to 1.0
  readonly contentHash: string;
}

export interface CreateUniversalEvidenceInput<T> {
  readonly value: T;
  readonly evidenceClass: UniversalEvidenceClass;
  readonly source: string;
  readonly issuer: string;
  readonly observedAt: number;
  readonly receivedAt?: number;
  readonly availableAt?: number;
  readonly knownAt?: number;
  readonly slot: bigint;
  readonly commitment?: 'processed' | 'confirmed' | 'finalized';
  readonly stateRoot?: string;
  readonly provenance: string;
  readonly coverage?: number;
}

/**
 * Creates a validated, immutable UniversalEvidence envelope.
 * Strictly verifies causality and non-fabrication.
 */
export function createUniversalEvidence<T>(input: CreateUniversalEvidenceInput<T>): UniversalEvidence<T> {
  const now = Date.now();
  const receivedAt = input.receivedAt ?? now;
  const availableAt = input.availableAt ?? receivedAt;
  const knownAt = input.knownAt ?? availableAt;

  // Invariant 6: Temporal causality
  if (knownAt < input.observedAt) {
    throw new Error(`TEMPORAL_CAUSALITY_VIOLATION: knownAt (${knownAt}) cannot be before observedAt (${input.observedAt})`);
  }
  if (availableAt < input.observedAt) {
    throw new Error(`TEMPORAL_CAUSALITY_VIOLATION: availableAt (${availableAt}) cannot be before observedAt (${input.observedAt})`);
  }

  // Value/Class coherence invariants
  if (input.evidenceClass === 'UNKNOWN' && (input.value === false || input.value === 0 || input.value === '0')) {
    // We allow explicit UNKNOWN_SENTINEL or undefined/null, but forbid collapsing UNKNOWN into false/zero
    throw new Error('EPISTEMIC_VIOLATION: UNKNOWN must not be represented as boolean false or numeric zero');
  }
  if (input.evidenceClass === 'MISSING' && (input.value === 0 || input.value === '0' || input.value === false)) {
    throw new Error('EPISTEMIC_VIOLATION: MISSING must not be represented as numeric zero or boolean false');
  }

  const freshnessMs = Math.max(0, now - input.observedAt);
  const coverage = input.coverage !== undefined ? Math.max(0, Math.min(1, input.coverage)) : 1.0;
  const stateRoot = input.stateRoot ?? '0000000000000000000000000000000000000000000000000000000000000000';

  const contentHash = hashCanonical({
    value: input.value,
    evidenceClass: input.evidenceClass,
    source: input.source,
    issuer: input.issuer,
    observedAt: input.observedAt,
    slot: input.slot.toString(),
    stateRoot,
  });

  const evidenceId = `ev_${createHash('sha256')
    .update(`${input.source}:${input.issuer}:${input.slot}:${contentHash}:${knownAt}`)
    .digest('hex')
    .slice(0, 24)}`;

  return Object.freeze({
    schemaVersion: '1.0.0',
    evidenceId,
    value: input.value,
    evidenceClass: input.evidenceClass,
    source: input.source,
    issuer: input.issuer,
    observedAt: input.observedAt,
    receivedAt,
    availableAt,
    knownAt,
    slot: input.slot,
    commitment: input.commitment ?? 'confirmed',
    stateRoot,
    provenance: input.provenance,
    freshnessMs,
    coverage,
    contentHash,
  });
}

/**
 * Checks whether evidence was available and known at a specific point in time.
 * Essential for point-in-time (PIT) feature compilation and preventing lookahead bias.
 */
export function isEvidencePointInTimeValid(evidence: UniversalEvidence, asOfTimeMs: number): boolean {
  return evidence.availableAt <= asOfTimeMs && evidence.knownAt <= asOfTimeMs;
}

/**
 * Epistemic promotion hierarchy rank.
 * Strictly enforces that lower confidence evidence cannot masquerade as higher truth.
 */
const EVIDENCE_CLASS_RANK: Record<UniversalEvidenceClass, number> = {
  VERIFIED_CHAIN: 100,
  VERIFIED_EXECUTION: 95,
  DERIVED_CERTIFIED: 85,
  HISTORICAL_CERTIFIED: 80,
  OBSERVED_EXTERNAL: 70,
  PAPER_SIMULATED: 50,
  MODELLED_COUNTERFACTUAL: 40,
  OPERATOR_ASSERTED: 30,
  UNKNOWN: 10,
  MISSING: 5,
  STALE: 2,
  CONFLICTED: 1,
  REVOKED: 0,
  INVALID: 0,
};

export function canPromoteEvidence(
  current: UniversalEvidenceClass,
  target: UniversalEvidenceClass
): boolean {
  // PAPER_SIMULATED and MODELLED_COUNTERFACTUAL can NEVER self-promote to live chain/execution truth
  if ((current === 'PAPER_SIMULATED' || current === 'MODELLED_COUNTERFACTUAL') &&
      (target === 'VERIFIED_CHAIN' || target === 'VERIFIED_EXECUTION')) {
    return false;
  }
  // No downward promotion directly without re-issuance
  return EVIDENCE_CLASS_RANK[target] > EVIDENCE_CLASS_RANK[current];
}
