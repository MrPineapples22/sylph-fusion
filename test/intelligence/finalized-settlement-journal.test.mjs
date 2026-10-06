import test from 'node:test';
import assert from 'node:assert/strict';
import { EconomicEventSpine } from '../../dist/intelligence/profit/economic-event-spine.js';
import { FinalizedCostLedger, verifyFinalizedCostRecord } from '../../dist/intelligence/profit/finalized-cost-ledger.js';
import { FinalizedSettlementJournal } from '../../dist/intelligence/profit/finalized-settlement-journal.js';

const costInput = (overrides = {}) => ({
  certificateId: 'cert-1', settlementId: 'settlement-1', finalizedAtMs: 3_000,
  source: 'paper-settlement-store', sourceEventId: 'source-event-1',
  grossPnlLamports: 1_000n, networkFeeLamports: 5n, priorityFeeLamports: 7n,
  jitoTipLamports: 11n, routeFeeLamports: 13n, failedTransactionCostLamports: 17n,
  mevCostLamports: 19n, slippageCostLamports: 23n, tokenDeltaLamports: 29n,
  ...overrides,
});
const provenance = (overrides = {}) => ({
  source: 'paper-settlement-store', sourceEventId: 'source-event-1',
  observedAtMs: 2_990, receivedAtMs: 3_010, revision: 0, ...overrides,
});

test('finalized settlement is joined to its certificate event chain', () => {
  const costs = new FinalizedCostLedger();
  const events = new EconomicEventSpine();
  const journal = new FinalizedSettlementJournal(costs, events);
  const { record, event } = journal.append({ cost: costInput(), provenance: provenance() });

  assert.equal(record.realizedNetPnlLamports, '934');
  assert.equal(verifyFinalizedCostRecord(record), true);
  assert.equal(costs.get('cert-1')?.integrityHash, record.integrityHash);
  assert.equal(event.kind, 'SETTLEMENT');
  assert.equal(event.certificateId, record.certificateId);
  assert.equal(event.payload.settlementId, record.settlementId);
  assert.equal(event.payload.finalizedCost.integrityHash, record.integrityHash);
  assert.equal(events.verify('cert-1'), true);
  assert.equal(costs.verify(), true);
});

test('invalid provenance or event ordering leaves both ledgers unchanged', () => {
  const costs = new FinalizedCostLedger();
  const events = new EconomicEventSpine();
  const journal = new FinalizedSettlementJournal(costs, events);
  assert.throws(() => journal.append({ cost: costInput(), provenance: provenance({ source: 'other' }) }), /SETTLEMENT_PROVENANCE_MISMATCH/);
  events.append({
    certificateId: 'cert-1', kind: 'DECISION', occurredAtMs: 4_000,
    provenance: provenance({ observedAtMs: 3_990, receivedAtMs: 4_010 }), payload: {},
  });
  assert.throws(() => journal.append({ cost: costInput(), provenance: provenance() }), /NON_MONOTONIC_ECONOMIC_EVENT_TIME/);
  assert.equal(costs.get('cert-1'), undefined);
  assert.equal(events.list('cert-1').length, 1);
});

test('unhashable provenance is rejected before either store is mutated', () => {
  const costs = new FinalizedCostLedger();
  const events = new EconomicEventSpine();
  const journal = new FinalizedSettlementJournal(costs, events);
  const cyclic = provenance();
  cyclic.extra = cyclic;
  assert.throws(() => journal.append({ cost: costInput(), provenance: cyclic }), /SETTLEMENT_PROVENANCE_FIELDS_INVALID/);
  assert.equal(costs.get('cert-1'), undefined);
  assert.equal(events.list('cert-1').length, 0);
});

test('settlement commits one immutable snapshot even when caller fields are getters', () => {
  const costs = new FinalizedCostLedger();
  const events = new EconomicEventSpine();
  const journal = new FinalizedSettlementJournal(costs, events);
  let grossReads = 0;
  const cost = costInput();
  Object.defineProperty(cost, 'grossPnlLamports', {
    enumerable: true,
    get: () => (++grossReads === 1 ? 1_000n : 99_000n),
  });
  let observedReads = 0;
  const source = provenance();
  Object.defineProperty(source, 'observedAtMs', {
    enumerable: true,
    get: () => (++observedReads === 1 ? 2_990 : 3_500),
  });

  const { record, event } = journal.append({ cost, provenance: source });
  assert.equal(grossReads, 1);
  assert.equal(observedReads, 1);
  assert.equal(record.grossPnlLamports, '1000');
  assert.equal(event.payload.finalizedCost.integrityHash, record.integrityHash);
  assert.equal(events.verify('cert-1'), true);
});

test('duplicate settlements cannot append a second event or overwrite cost facts', () => {
  const costs = new FinalizedCostLedger();
  const events = new EconomicEventSpine();
  const journal = new FinalizedSettlementJournal(costs, events);
  const first = journal.append({ cost: costInput(), provenance: provenance() });
  assert.throws(() => journal.append({ cost: costInput({ settlementId: 'settlement-2' }), provenance: provenance() }), /FINALIZED_COST_CERTIFICATE_ALREADY_SETTLED/);
  assert.throws(() => journal.append({
    cost: costInput({ certificateId: 'cert-2' }), provenance: provenance(),
  }), /FINALIZED_COST_SETTLEMENT_ID_ALREADY_USED/);
  assert.equal(events.list('cert-1').length, 1);
  assert.equal(events.list('cert-2').length, 0);
  assert.equal(costs.get('cert-1')?.integrityHash, first.record.integrityHash);
});
