import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EconomicEventSpine,
  createOpportunitySetSnapshot,
  verifyOpportunitySetSnapshot,
} from '../../dist/intelligence/profit/economic-event-spine.js';

const provenance = (observedAtMs, receivedAtMs = observedAtMs) => ({
  source: 'fixture-provider', sourceEventId: `${observedAtMs}-${receivedAtMs}`, observedAtMs, receivedAtMs, revision: 0,
});

test('economic event spine is append-only, hash-linked, and decision-time fenced', () => {
  const spine = new EconomicEventSpine();
  spine.append({ certificateId: 'cert-1', kind: 'DECISION', occurredAtMs: 100, provenance: provenance(90, 100), payload: { score: 1 } });
  spine.append({ certificateId: 'cert-1', kind: 'QUOTE', occurredAtMs: 120, provenance: provenance(110, 150), payload: { price: 2 } });
  assert.equal(spine.verify('cert-1'), true);
  assert.equal(spine.visibleAt('cert-1', 125).length, 1);
  assert.equal(spine.visibleAt('cert-1', 150).length, 2);
  assert.throws(() => spine.append({ certificateId: 'cert-1', kind: 'PERMIT', occurredAtMs: 119, provenance: provenance(119), payload: {} }), /NON_MONOTONIC/);
});

test('economic event spine rejects impossible provenance and tampering', () => {
  const spine = new EconomicEventSpine();
  assert.throws(() => spine.append({ certificateId: 'cert-1', kind: 'QUOTE', occurredAtMs: 10, provenance: provenance(11), payload: {} }), /OCCURRED_BEFORE_OBSERVED/);
  const event = spine.append({ certificateId: 'cert-1', kind: 'QUOTE', occurredAtMs: 20, provenance: provenance(10), payload: {} });
  event.payload.mutated = true;
  assert.equal(spine.verify('cert-1'), false);
});

test('opportunity set snapshots preserve cash, candidate identity, and integrity', () => {
  const snapshot = createOpportunitySetSnapshot({
    certificateId: 'cert-1', decidedAtMs: 100, availableCapitalLamports: 99n,
    candidates: [
      { candidateId: 'a', certaintyEquivalentLamports: 10n, requiredCapitalLamports: 10n, expectedLockSeconds: 5 },
      { candidateId: 'b', certaintyEquivalentLamports: 9n, requiredCapitalLamports: 20n, expectedLockSeconds: 6 },
    ],
  });
  assert.equal(verifyOpportunitySetSnapshot(snapshot), true);
  assert.equal(verifyOpportunitySetSnapshot({ ...snapshot, candidateIds: ['a'] }), false);
  assert.throws(() => createOpportunitySetSnapshot({ certificateId: 'cert-1', decidedAtMs: 100, availableCapitalLamports: 0n, candidates: [
    { candidateId: 'a', certaintyEquivalentLamports: 1n, requiredCapitalLamports: 1n, expectedLockSeconds: 1 },
    { candidateId: 'a', certaintyEquivalentLamports: 1n, requiredCapitalLamports: 1n, expectedLockSeconds: 1 },
  ] }), /UNIQUE/);
});
