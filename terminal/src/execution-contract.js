/**
 * ExecutionReviewContract — Immutable state machine for execution lifecycle.
 *
 * Enforces strict state progression:
 *   CREATED → REVIEWING → CONFIRMED → SUBMITTED → ACKNOWLEDGED → SETTLED → RECONCILED
 *
 * Terminal states: REJECTED, CANCELLED, EXPIRED
 *
 * Rules:
 * - Payload is frozen on creation — cannot be mutated after construction.
 * - Each advance() validates transition legality and returns a new state.
 * - isDuplicate() checks for duplicate economic effects within a time window.
 * - toAuditEntry() produces structured log entries.
 */

const VALID_TRANSITIONS = {
  CREATED: ['REVIEWING', 'CANCELLED', 'EXPIRED'],
  REVIEWING: ['CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['SUBMITTED', 'CANCELLED', 'EXPIRED'],
  SUBMITTED: ['ACKNOWLEDGED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  ACKNOWLEDGED: ['SETTLED', 'REJECTED', 'CANCELLED'],
  SETTLED: ['RECONCILED'],
  // Terminal states — no further transitions
  RECONCILED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

const TERMINAL_STATES = new Set(['RECONCILED', 'REJECTED', 'CANCELLED', 'EXPIRED']);

/** Duration within which orders for the same mint+side are considered potential duplicates. */
const DUPLICATE_WINDOW_MS = 10_000;

let contractSequence = 0;

export class ExecutionReviewContract {
  /**
   * @param {Object} payload - The execution payload
   * @param {string} payload.mint - Token mint address
   * @param {string} payload.side - 'buy' or 'sell'
   * @param {string} payload.source - Origin of the execution request
   * @param {string} [payload.reason] - Human-readable reason
   * @param {number} [payload.amount] - USD amount or token quantity
   * @param {Object} [payload.config] - Execution configuration snapshot
   */
  constructor(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('ExecutionReviewContract: payload required');
    if (!payload.mint || typeof payload.mint !== 'string') throw new Error('ExecutionReviewContract: valid mint required');
    if (!['buy', 'sell'].includes(payload.side)) throw new Error('ExecutionReviewContract: side must be buy or sell');
    if (!payload.source || typeof payload.source !== 'string') throw new Error('ExecutionReviewContract: source required');

    this._contractId = `erc-${++contractSequence}-${Date.now()}`;
    this._state = 'CREATED';
    this._payload = Object.freeze({ ...payload });
    this._createdAt = Date.now();
    this._transitions = [{ from: null, to: 'CREATED', at: this._createdAt, reason: 'Contract created' }];
    this._settled = false;
    this._settledAt = null;
    this._economicEffect = null;
    Object.freeze(this._payload);
  }

  /** @returns {string} Unique contract identifier */
  get contractId() { return this._contractId; }

  /** @returns {string} Current state */
  get state() { return this._state; }

  /** @returns {Object} Frozen payload — immutable after construction */
  get payload() { return this._payload; }

  /** @returns {number} Creation timestamp */
  get createdAt() { return this._createdAt; }

  /** @returns {boolean} Whether in a terminal state */
  get isTerminal() { return TERMINAL_STATES.has(this._state); }

  /** @returns {boolean} Whether settlement has occurred */
  get isSettled() { return this._settled; }

  /** @returns {ReadonlyArray} Full transition history */
  get transitions() { return [...this._transitions]; }

  /**
   * Advance the contract to a new state.
   * @param {string} targetState - The state to transition to
   * @param {string} [reason] - Reason for the transition
   * @param {Object} [economicEffect] - For SETTLED state: the economic effect details
   * @returns {string} The new state
   * @throws {Error} If the transition is illegal
   */
  advance(targetState, reason = '', economicEffect = null) {
    if (this.isTerminal) {
      throw new Error(`ExecutionReviewContract: cannot transition from terminal state ${this._state}`);
    }

    const allowed = VALID_TRANSITIONS[this._state];
    if (!allowed || !allowed.includes(targetState)) {
      throw new Error(`ExecutionReviewContract: illegal transition ${this._state} → ${targetState}. Allowed: [${allowed?.join(', ')}]`);
    }

    // Settlement must include economic effect and cannot happen twice
    if (targetState === 'SETTLED') {
      if (this._settled) {
        throw new Error('ExecutionReviewContract: duplicate settlement attempt — economic effect already recorded');
      }
      this._settled = true;
      this._settledAt = Date.now();
      this._economicEffect = economicEffect ? Object.freeze({ ...economicEffect }) : null;
    }

    const transition = {
      from: this._state,
      to: targetState,
      at: Date.now(),
      reason: reason || `Transition to ${targetState}`,
    };
    this._transitions.push(transition);
    this._state = targetState;
    return this._state;
  }

  /**
   * Check if this contract would create a duplicate economic effect.
   * @param {ExecutionReviewContract[]} existingContracts - Active contracts to check against
   * @returns {{ isDuplicate: boolean, conflictingContractId: string|null, reason: string }}
   */
  isDuplicate(existingContracts) {
    if (!Array.isArray(existingContracts)) return { isDuplicate: false, conflictingContractId: null, reason: '' };

    for (const other of existingContracts) {
      if (other.contractId === this._contractId) continue;
      if (other.isTerminal && !other.isSettled) continue; // rejected/cancelled don't count

      if (
        other.payload.mint === this._payload.mint &&
        other.payload.side === this._payload.side &&
        Math.abs(other.createdAt - this._createdAt) < DUPLICATE_WINDOW_MS &&
        !TERMINAL_STATES.has(other.state)
      ) {
        return {
          isDuplicate: true,
          conflictingContractId: other.contractId,
          reason: `Duplicate ${this._payload.side} for ${this._payload.mint} within ${DUPLICATE_WINDOW_MS}ms window (conflicts with ${other.contractId})`,
        };
      }
    }

    return { isDuplicate: false, conflictingContractId: null, reason: '' };
  }

  /**
   * Produce a structured audit entry for the contract's current state.
   * @returns {Object} Audit entry
   */
  toAuditEntry() {
    return {
      contractId: this._contractId,
      state: this._state,
      isTerminal: this.isTerminal,
      payload: { ...this._payload },
      createdAt: this._createdAt,
      settledAt: this._settledAt,
      economicEffect: this._economicEffect ? { ...this._economicEffect } : null,
      transitionCount: this._transitions.length,
      transitions: this._transitions.map(t => ({ ...t })),
      lastTransition: this._transitions.at(-1) || null,
    };
  }
}

/**
 * Get a list of valid transitions from the given state.
 * @param {string} state
 * @returns {string[]}
 */
export function getValidTransitions(state) {
  return [...(VALID_TRANSITIONS[state] || [])];
}

/**
 * Check if a state is terminal.
 * @param {string} state
 * @returns {boolean}
 */
export function isTerminalState(state) {
  return TERMINAL_STATES.has(state);
}

/** Reset the contract sequence counter (for testing only). */
export function _resetSequence() {
  contractSequence = 0;
}
