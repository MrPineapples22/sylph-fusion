import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ExecutionReviewContract,
  getValidTransitions,
  isTerminalState,
  _resetSequence,
} from '../src/execution-contract.js';

beforeEach(() => _resetSequence());

const validPayload = (overrides = {}) => ({
  mint: 'So11111111111111111111111111111111111111112',
  side: 'buy',
  source: 'operator-manual',
  reason: 'Test entry',
  amount: 0.1,
  ...overrides,
});

// --- Construction ---

test('contract creation freezes payload and sets CREATED state', () => {
  const contract = new ExecutionReviewContract(validPayload());
  assert.equal(contract.state, 'CREATED');
  assert.ok(Object.isFrozen(contract.payload));
  assert.equal(contract.payload.mint, 'So11111111111111111111111111111111111111112');
  assert.equal(contract.isTerminal, false);
  assert.equal(contract.isSettled, false);
  assert.equal(typeof contract.contractId, 'string');
  assert.ok(contract.contractId.startsWith('erc-'));
});

test('contract rejects invalid construction arguments', () => {
  assert.throws(() => new ExecutionReviewContract(null), /payload required/);
  assert.throws(() => new ExecutionReviewContract({}), /valid mint required/);
  assert.throws(() => new ExecutionReviewContract({ mint: 'x' }), /side must be buy or sell/);
  assert.throws(() => new ExecutionReviewContract({ mint: 'x', side: 'buy' }), /source required/);
  assert.throws(() => new ExecutionReviewContract({ mint: 'x', side: 'long' }), /side must be buy or sell/);
});

test('payload cannot be mutated after construction', () => {
  const contract = new ExecutionReviewContract(validPayload());
  assert.throws(() => { contract.payload.mint = 'HACKED'; }, TypeError);
  assert.throws(() => { contract.payload.newField = 'INJECTED'; }, TypeError);
});

// --- State Machine Transitions ---

test('full happy path: CREATED → REVIEWING → CONFIRMED → SUBMITTED → ACKNOWLEDGED → SETTLED → RECONCILED', () => {
  const c = new ExecutionReviewContract(validPayload());
  assert.equal(c.advance('REVIEWING', 'Operator review'), 'REVIEWING');
  assert.equal(c.advance('CONFIRMED', 'Operator confirmed'), 'CONFIRMED');
  assert.equal(c.advance('SUBMITTED', 'Sent to exchange'), 'SUBMITTED');
  assert.equal(c.advance('ACKNOWLEDGED', 'Exchange ack'), 'ACKNOWLEDGED');
  assert.equal(c.advance('SETTLED', 'Fill confirmed', { filledQty: 100, price: 0.001 }), 'SETTLED');
  assert.equal(c.isSettled, true);
  assert.equal(c.advance('RECONCILED', 'Ledger balanced'), 'RECONCILED');
  assert.equal(c.isTerminal, true);
  assert.equal(c.transitions.length, 7); // initial CREATED + 6 advances
});

test('illegal state transitions are rejected', () => {
  const c = new ExecutionReviewContract(validPayload());
  assert.throws(() => c.advance('CONFIRMED'), /illegal transition CREATED → CONFIRMED/);
  assert.throws(() => c.advance('SETTLED'), /illegal transition CREATED → SETTLED/);
  assert.throws(() => c.advance('RECONCILED'), /illegal transition CREATED → RECONCILED/);
});

test('cannot transition from terminal states', () => {
  const c = new ExecutionReviewContract(validPayload());
  c.advance('CANCELLED', 'User cancelled');
  assert.equal(c.isTerminal, true);
  assert.throws(() => c.advance('REVIEWING'), /cannot transition from terminal state/);
});

test('REJECTED is terminal from REVIEWING, SUBMITTED, and ACKNOWLEDGED', () => {
  for (const fromState of ['REVIEWING', 'SUBMITTED', 'ACKNOWLEDGED']) {
    const c = new ExecutionReviewContract(validPayload());
    // Navigate to the fromState
    if (fromState === 'REVIEWING') c.advance('REVIEWING');
    if (fromState === 'SUBMITTED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); c.advance('SUBMITTED'); }
    if (fromState === 'ACKNOWLEDGED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); c.advance('SUBMITTED'); c.advance('ACKNOWLEDGED'); }
    c.advance('REJECTED', `Rejected from ${fromState}`);
    assert.equal(c.isTerminal, true);
    assert.equal(c.state, 'REJECTED');
  }
});

test('CANCELLED is reachable from non-terminal, non-settled states', () => {
  for (const fromState of ['CREATED', 'REVIEWING', 'CONFIRMED', 'SUBMITTED', 'ACKNOWLEDGED']) {
    const c = new ExecutionReviewContract(validPayload());
    if (fromState === 'REVIEWING') c.advance('REVIEWING');
    if (fromState === 'CONFIRMED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); }
    if (fromState === 'SUBMITTED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); c.advance('SUBMITTED'); }
    if (fromState === 'ACKNOWLEDGED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); c.advance('SUBMITTED'); c.advance('ACKNOWLEDGED'); }
    c.advance('CANCELLED', `Cancelled from ${fromState}`);
    assert.equal(c.isTerminal, true);
    assert.equal(c.state, 'CANCELLED');
  }
});

test('EXPIRED is reachable from CREATED, REVIEWING, CONFIRMED, SUBMITTED', () => {
  for (const fromState of ['CREATED', 'REVIEWING', 'CONFIRMED', 'SUBMITTED']) {
    const c = new ExecutionReviewContract(validPayload());
    if (fromState === 'REVIEWING') c.advance('REVIEWING');
    if (fromState === 'CONFIRMED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); }
    if (fromState === 'SUBMITTED') { c.advance('REVIEWING'); c.advance('CONFIRMED'); c.advance('SUBMITTED'); }
    c.advance('EXPIRED', `Expired from ${fromState}`);
    assert.equal(c.isTerminal, true);
    assert.equal(c.state, 'EXPIRED');
  }
});

// --- Settlement Safety ---

test('duplicate settlement attempt throws', () => {
  const c = new ExecutionReviewContract(validPayload());
  c.advance('REVIEWING');
  c.advance('CONFIRMED');
  c.advance('SUBMITTED');
  c.advance('ACKNOWLEDGED');
  c.advance('SETTLED', 'First fill', { filledQty: 100, price: 0.001 });
  // Cannot settle again (only transition from SETTLED is RECONCILED)
  assert.throws(() => c.advance('SETTLED'), /illegal transition SETTLED → SETTLED/);
});

test('economic effect is frozen after settlement', () => {
  const c = new ExecutionReviewContract(validPayload());
  c.advance('REVIEWING');
  c.advance('CONFIRMED');
  c.advance('SUBMITTED');
  c.advance('ACKNOWLEDGED');
  c.advance('SETTLED', 'Fill', { filledQty: 100, price: 0.001 });
  const audit = c.toAuditEntry();
  assert.equal(audit.economicEffect.filledQty, 100);
  assert.ok(Object.isFrozen(audit.economicEffect) === false, 'audit entry returns a copy, not the frozen original');
});

// --- Duplicate Detection ---

test('isDuplicate detects contracts for same mint+side within time window', () => {
  const c1 = new ExecutionReviewContract(validPayload());
  const c2 = new ExecutionReviewContract(validPayload());
  const result = c2.isDuplicate([c1]);
  assert.equal(result.isDuplicate, true);
  assert.equal(result.conflictingContractId, c1.contractId);
  assert.ok(result.reason.includes('Duplicate'));
});

test('isDuplicate allows different mints', () => {
  const c1 = new ExecutionReviewContract(validPayload({ mint: 'AAAA' }));
  const c2 = new ExecutionReviewContract(validPayload({ mint: 'BBBB' }));
  assert.equal(c2.isDuplicate([c1]).isDuplicate, false);
});

test('isDuplicate allows different sides for same mint', () => {
  const c1 = new ExecutionReviewContract(validPayload({ side: 'buy' }));
  const c2 = new ExecutionReviewContract(validPayload({ side: 'sell' }));
  assert.equal(c2.isDuplicate([c1]).isDuplicate, false);
});

test('isDuplicate ignores terminated contracts (rejected/cancelled)', () => {
  const c1 = new ExecutionReviewContract(validPayload());
  c1.advance('CANCELLED', 'User cancelled');
  const c2 = new ExecutionReviewContract(validPayload());
  assert.equal(c2.isDuplicate([c1]).isDuplicate, false);
});

test('isDuplicate does not consider itself', () => {
  const c1 = new ExecutionReviewContract(validPayload());
  assert.equal(c1.isDuplicate([c1]).isDuplicate, false);
});

test('isDuplicate handles empty and null arrays gracefully', () => {
  const c1 = new ExecutionReviewContract(validPayload());
  assert.equal(c1.isDuplicate([]).isDuplicate, false);
  assert.equal(c1.isDuplicate(null).isDuplicate, false);
});

// --- Audit Trail ---

test('toAuditEntry produces complete structured record', () => {
  const c = new ExecutionReviewContract(validPayload());
  c.advance('REVIEWING', 'Manual review');
  const audit = c.toAuditEntry();
  assert.equal(audit.contractId, c.contractId);
  assert.equal(audit.state, 'REVIEWING');
  assert.equal(audit.isTerminal, false);
  assert.equal(audit.payload.mint, validPayload().mint);
  assert.equal(audit.transitionCount, 2);
  assert.equal(audit.transitions[0].to, 'CREATED');
  assert.equal(audit.transitions[1].to, 'REVIEWING');
  assert.equal(audit.transitions[1].reason, 'Manual review');
  assert.equal(audit.lastTransition.to, 'REVIEWING');
  assert.equal(audit.economicEffect, null);
});

// --- Utility Functions ---

test('getValidTransitions returns correct transitions for each state', () => {
  assert.deepEqual(getValidTransitions('CREATED'), ['REVIEWING', 'CANCELLED', 'EXPIRED']);
  assert.deepEqual(getValidTransitions('SETTLED'), ['RECONCILED']);
  assert.deepEqual(getValidTransitions('RECONCILED'), []);
  assert.deepEqual(getValidTransitions('UNKNOWN_STATE'), []);
});

test('isTerminalState correctly identifies terminal states', () => {
  assert.equal(isTerminalState('RECONCILED'), true);
  assert.equal(isTerminalState('REJECTED'), true);
  assert.equal(isTerminalState('CANCELLED'), true);
  assert.equal(isTerminalState('EXPIRED'), true);
  assert.equal(isTerminalState('CREATED'), false);
  assert.equal(isTerminalState('SUBMITTED'), false);
});

// --- Transition History ---

test('transition history records timestamps and reasons for every state change', () => {
  const c = new ExecutionReviewContract(validPayload());
  c.advance('REVIEWING', 'Operator initiated');
  c.advance('REJECTED', 'Slippage too high');
  const history = c.transitions;
  assert.equal(history.length, 3);
  assert.equal(history[0].from, null);
  assert.equal(history[0].to, 'CREATED');
  assert.equal(history[1].from, 'CREATED');
  assert.equal(history[1].to, 'REVIEWING');
  assert.equal(history[1].reason, 'Operator initiated');
  assert.equal(history[2].from, 'REVIEWING');
  assert.equal(history[2].to, 'REJECTED');
  assert.equal(history[2].reason, 'Slippage too high');
  // All timestamps should be valid
  for (const t of history) {
    assert.ok(Number.isFinite(t.at) && t.at > 0);
  }
});
