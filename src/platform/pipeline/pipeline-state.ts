/**
 * SYLPH FUSION — PIPELINE STATE MACHINE & AUTHORITY TYPES
 * Specifications: Prompt 6, Prompt 7, Prompt 11
 *
 * Canonical top-level state machine:
 *   OBSERVED
 *   → EVIDENCE_CERTIFIED
 *   → TEMPORALLY_VALID
 *   → SEMANTICALLY_RESOLVED
 *   → AUTHENTICATED_MARKET
 *   → FEATURED
 *   → HYPOTHESIS_READY
 *   → DECIDED
 *   → RISK_APPROVED
 *   → RESOURCE_ADMITTED
 *   → CAPITAL_RESERVED
 *   → AUTHORIZED
 *   → TRANSACTION_VERIFIED
 *   → PROOF_READY
 *   → SIGNED
 *   → SUBMITTED
 *   → OUTCOME_PENDING
 *
 * Then branch:
 *   OUTCOME_PENDING
 *   ├── LANDED_FAILED
 *   ├── LANDED_SUCCESS
 *   ├── EXPIRED_UNRESOLVED
 *   ├── CERTIFIED_NOLAND
 *   └── DISPUTED
 *
 * EXPIRED_UNRESOLVED may later transition to:
 *   LANDED_FAILED, LANDED_SUCCESS, CERTIFIED_NOLAND, DISPUTED
 * when authoritative evidence arrives.
 *
 * Reconciliation:
 *   LANDED_FAILED | LANDED_SUCCESS | CERTIFIED_NOLAND | DISPUTED
 *       ↓
 *   ECONOMIC_RECONCILED
 *       ↓
 *   SETTLED
 *       ↓
 *   OUTCOME_MATURE
 *       ↓
 *   LEARNING_READY
 */

export type FusionPipelineState =
  | 'OBSERVED'
  | 'EVIDENCE_CERTIFIED'
  | 'TEMPORALLY_VALID'
  | 'SEMANTICALLY_RESOLVED'
  | 'AUTHENTICATED_MARKET'
  | 'FEATURED'
  | 'HYPOTHESIS_READY'
  | 'DECIDED'
  | 'RISK_APPROVED'
  | 'RISK_BYPASSED_PAPER'
  | 'RESOURCE_ADMITTED'
  | 'CAPITAL_RESERVED'
  | 'AUTHORIZED'
  | 'AUTHORIZED_PAPER'
  | 'TRANSACTION_VERIFIED'
  | 'PROOF_READY'
  | 'PAPER_EXECUTION_ATTEMPTED'
  | 'SIGNED'
  | 'SUBMITTED'
  | 'OUTCOME_PENDING'
  | 'LANDED_FAILED'
  | 'LANDED_SUCCESS'
  | 'PAPER_FILLED'
  | 'PAPER_PARTIAL'
  | 'PAPER_REJECTED'
  | 'PAPER_NOLAND'
  | 'PAPER_UNEXITABLE'
  | 'PAPER_EXPIRED'
  | 'PAPER_DISPUTED'
  | 'EXPIRED_UNRESOLVED'
  | 'CERTIFIED_NOLAND'
  | 'DISPUTED'
  | 'ECONOMIC_RECONCILED'
  | 'SETTLED'
  | 'OUTCOME_MATURE'
  | 'LEARNING_READY';

/**
 * Formal Authority Capabilities (Prompt 11).
 * Capabilities, not confidence scores.
 * INFER or RECOMMEND can NEVER produce AUTHORIZE.
 */
export type PipelineAuthority =
  | 'OBSERVE'
  | 'INFER'
  | 'RECOMMEND'
  | 'VETO'
  | 'RESERVE'
  | 'AUTHORIZE'
  | 'SIGN'
  | 'SETTLE';

/**
 * Strict legal state transitions map.
 * Skipped transitions, illegal backwards steps, or unmapped transitions are rejected.
 */
export const VALID_TRANSITIONS: Readonly<Record<FusionPipelineState, readonly FusionPipelineState[]>> = {
  OBSERVED: ['EVIDENCE_CERTIFIED'],
  EVIDENCE_CERTIFIED: ['TEMPORALLY_VALID'],
  TEMPORALLY_VALID: ['SEMANTICALLY_RESOLVED'],
  SEMANTICALLY_RESOLVED: ['AUTHENTICATED_MARKET'],
  AUTHENTICATED_MARKET: ['FEATURED'],
  FEATURED: ['HYPOTHESIS_READY'],
  HYPOTHESIS_READY: ['DECIDED'],
  DECIDED: ['RISK_APPROVED', 'RISK_BYPASSED_PAPER'],
  RISK_APPROVED: ['RESOURCE_ADMITTED'],
  RISK_BYPASSED_PAPER: ['RESOURCE_ADMITTED'],
  RESOURCE_ADMITTED: ['CAPITAL_RESERVED'],
  CAPITAL_RESERVED: ['AUTHORIZED', 'AUTHORIZED_PAPER'],
  AUTHORIZED: ['TRANSACTION_VERIFIED'],
  AUTHORIZED_PAPER: ['TRANSACTION_VERIFIED'],
  TRANSACTION_VERIFIED: ['PROOF_READY'],
  PROOF_READY: ['SIGNED', 'PAPER_EXECUTION_ATTEMPTED'],
  PAPER_EXECUTION_ATTEMPTED: ['OUTCOME_PENDING'],
  SIGNED: ['SUBMITTED'],
  SUBMITTED: ['OUTCOME_PENDING'],
  OUTCOME_PENDING: [
    'LANDED_SUCCESS',
    'LANDED_FAILED',
    'EXPIRED_UNRESOLVED',
    'CERTIFIED_NOLAND',
    'DISPUTED',
    'PAPER_FILLED',
    'PAPER_PARTIAL',
    'PAPER_REJECTED',
    'PAPER_NOLAND',
    'PAPER_UNEXITABLE',
    'PAPER_EXPIRED',
    'PAPER_DISPUTED',
  ],
  // EXPIRED_UNRESOLVED must NOT automatically mean CERTIFIED_NOLAND.
  // It can transition to terminal states when authoritative proof arrives.
  EXPIRED_UNRESOLVED: [
    'LANDED_SUCCESS',
    'LANDED_FAILED',
    'CERTIFIED_NOLAND',
    'DISPUTED',
  ],
  LANDED_SUCCESS: ['ECONOMIC_RECONCILED'],
  LANDED_FAILED: ['ECONOMIC_RECONCILED'],
  CERTIFIED_NOLAND: ['ECONOMIC_RECONCILED'],
  DISPUTED: ['ECONOMIC_RECONCILED'],
  PAPER_FILLED: ['ECONOMIC_RECONCILED'],
  PAPER_PARTIAL: ['ECONOMIC_RECONCILED'],
  PAPER_REJECTED: ['ECONOMIC_RECONCILED'],
  PAPER_NOLAND: ['ECONOMIC_RECONCILED'],
  PAPER_UNEXITABLE: ['ECONOMIC_RECONCILED'],
  PAPER_EXPIRED: ['ECONOMIC_RECONCILED'],
  PAPER_DISPUTED: ['ECONOMIC_RECONCILED'],
  ECONOMIC_RECONCILED: ['SETTLED'],
  SETTLED: ['OUTCOME_MATURE'],
  OUTCOME_MATURE: ['LEARNING_READY'],
  LEARNING_READY: [],
};

/**
 * Checks if a transition from -> to is strictly valid.
 */
export function isValidTransition(from: FusionPipelineState, to: FusionPipelineState): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Required authority capabilities per transition.
 * Invariant: Models with INFER or RECOMMEND can never advance to AUTHORIZED, CAPITAL_RESERVED, SIGNED, or SETTLED.
 */
export const REQUIRED_AUTHORITY_MAP: Readonly<Record<FusionPipelineState, PipelineAuthority>> = {
  OBSERVED: 'OBSERVE',
  EVIDENCE_CERTIFIED: 'OBSERVE',
  TEMPORALLY_VALID: 'OBSERVE',
  SEMANTICALLY_RESOLVED: 'OBSERVE',
  AUTHENTICATED_MARKET: 'OBSERVE',
  FEATURED: 'OBSERVE',
  HYPOTHESIS_READY: 'INFER',
  DECIDED: 'RECOMMEND',
  RISK_APPROVED: 'VETO',
  RISK_BYPASSED_PAPER: 'VETO',
  RESOURCE_ADMITTED: 'RESERVE',
  CAPITAL_RESERVED: 'RESERVE',
  AUTHORIZED: 'AUTHORIZE',
  AUTHORIZED_PAPER: 'AUTHORIZE',
  TRANSACTION_VERIFIED: 'AUTHORIZE',
  PROOF_READY: 'AUTHORIZE',
  PAPER_EXECUTION_ATTEMPTED: 'AUTHORIZE',
  SIGNED: 'SIGN',
  SUBMITTED: 'AUTHORIZE',
  OUTCOME_PENDING: 'OBSERVE',
  LANDED_SUCCESS: 'OBSERVE',
  LANDED_FAILED: 'OBSERVE',
  PAPER_FILLED: 'OBSERVE',
  PAPER_PARTIAL: 'OBSERVE',
  PAPER_REJECTED: 'OBSERVE',
  PAPER_NOLAND: 'OBSERVE',
  PAPER_UNEXITABLE: 'OBSERVE',
  PAPER_EXPIRED: 'OBSERVE',
  PAPER_DISPUTED: 'OBSERVE',
  EXPIRED_UNRESOLVED: 'OBSERVE',
  CERTIFIED_NOLAND: 'OBSERVE',
  DISPUTED: 'OBSERVE',
  ECONOMIC_RECONCILED: 'SETTLE',
  SETTLED: 'SETTLE',
  OUTCOME_MATURE: 'OBSERVE',
  LEARNING_READY: 'OBSERVE',
};

/**
 * Verifies if the provided authority has the right capability for the target state.
 * Strictly enforces that models (INFER, RECOMMEND) can never OBSERVE, RESERVE, AUTHORIZE, SIGN, or SETTLE.
 */
export function isAuthorizedForState(authority: PipelineAuthority, targetState: FusionPipelineState): boolean {
  const required = REQUIRED_AUTHORITY_MAP[targetState];
  if (!required) return false;

  switch (required) {
    case 'OBSERVE':
      return authority === 'OBSERVE';
    case 'INFER':
      return authority === 'INFER';
    case 'RECOMMEND':
      return authority === 'RECOMMEND';
    case 'VETO':
      return authority === 'VETO';
    case 'RESERVE':
      return authority === 'RESERVE';
    case 'AUTHORIZE':
      return authority === 'AUTHORIZE';
    case 'SIGN':
      return authority === 'SIGN';
    case 'SETTLE':
      return authority === 'SETTLE';
    default:
      return false;
  }
}
