/**
 * SYLPH FUSION — CANONICAL EPISTEMIC CLASSIFICATION: EVIDENCE CLASS
 * Specifications: Blueprint Section 4 (Define Authoritative Evidence Classes)
 *
 * Epistemic Laws:
 *   MODELLED != OBSERVED
 *   PAPER != LANDED
 *   UNKNOWN != SAFE
 *   CONFIRMED != FINALIZED
 *   FORECAST != REALIZED
 *
 * Invariant: No downstream mathematical operation may upgrade evidence class without new independent evidence.
 */

export type EvidenceClass =
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

export const ALL_EVIDENCE_CLASSES: readonly EvidenceClass[] = Object.freeze([
  'VERIFIED_CHAIN',
  'VERIFIED_EXECUTION',
  'OBSERVED_EXTERNAL',
  'DERIVED_CERTIFIED',
  'HISTORICAL_CERTIFIED',
  'PAPER_SIMULATED',
  'MODELLED_COUNTERFACTUAL',
  'OPERATOR_ASSERTED',
  'UNKNOWN',
  'MISSING',
  'CONFLICTED',
  'STALE',
  'REVOKED',
  'INVALID',
]);

/**
 * Checks whether an evidence class is authoritative enough to authorize financial capital risk.
 * Only VERIFIED_CHAIN and VERIFIED_EXECUTION carry production execution authority.
 */
export function isExecutableAuthorityEvidence(cls: EvidenceClass): boolean {
  return cls === 'VERIFIED_CHAIN' || cls === 'VERIFIED_EXECUTION';
}

/**
 * Checks whether an evidence class represents non-favorable, degraded, or invalid state.
 * Missing/Unknown/Stale/Revoked/Invalid evidence can NEVER produce authority.
 */
export function isFailingOrDegradedEvidence(cls: EvidenceClass): boolean {
  return (
    cls === 'UNKNOWN' ||
    cls === 'MISSING' ||
    cls === 'CONFLICTED' ||
    cls === 'STALE' ||
    cls === 'REVOKED' ||
    cls === 'INVALID'
  );
}

/**
 * Epistemic promotion gate: strictly blocks ungrounded evidence upgrades.
 */
export function assertLegalEvidencePromotion(from: EvidenceClass, to: EvidenceClass, hasIndependentEvidence: boolean): void {
  if (from === to) return;

  // Unfavorable evidence cannot be upgraded without independent proof
  if (isFailingOrDegradedEvidence(from) && !hasIndependentEvidence) {
    throw new Error(`ILLEGAL_EVIDENCE_UPGRADE: Cannot promote ${from} to ${to} without independent verified evidence`);
  }

  // Simulations, models, and papers cannot become chain truth without chain execution
  if ((from === 'PAPER_SIMULATED' || from === 'MODELLED_COUNTERFACTUAL') && (to === 'VERIFIED_CHAIN' || to === 'VERIFIED_EXECUTION')) {
    if (!hasIndependentEvidence) {
      throw new Error(`EPISTEMIC_VIOLATION: ${from} cannot be upgraded to ${to}`);
    }
  }
}
