import assert from 'node:assert/strict';
import test from 'node:test';
import { FinalizedCostLedger, createFinalizedCostRecord, verifyFinalizedCostRecord } from '../../dist/intelligence/profit/finalized-cost-ledger.js';

const evidence = (overrides = {}) => ({
  certificateId: 'cert-1', settlementId: 'settle-1', finalizedAtMs: 1_700_000_000_000,
  source: 'paper-finality', sourceEventId: 'event-1', transactionSignature: 'paper-sig-1',
  grossPnlLamports: 1_000n, networkFeeLamports: 10n, priorityFeeLamports: 20n,
  jitoTipLamports: 30n, routeFeeLamports: 40n, failedTransactionCostLamports: 50n,
  mevCostLamports: 60n, slippageCostLamports: 70n, tokenDeltaLamports: -100n, ...overrides,
});

test('finalized cost record retains every cost, signed token delta, and sealed realized net PnL', () => {
  const record = createFinalizedCostRecord(evidence());
  assert.equal(record.totalCostLamports, '280');
  assert.equal(record.realizedNetPnlLamports, '620');
  assert.equal(verifyFinalizedCostRecord(record), true);
  assert.equal(verifyFinalizedCostRecord({ ...record, jitoTipLamports: '0' }), false);
});

test('finalized cost ledger rejects overwrites, repeated settlements, and hidden negative costs', () => {
  const ledger = new FinalizedCostLedger();
  ledger.append(evidence());
  assert.throws(() => ledger.append(evidence({ settlementId: 'settle-2' })), /CERTIFICATE_ALREADY_SETTLED/);
  assert.throws(() => ledger.append(evidence({ certificateId: 'cert-2' })), /SETTLEMENT_ID_ALREADY_USED/);
  assert.throws(() => createFinalizedCostRecord(evidence({ jitoTipLamports: -1n })), /jitoTipLamports_MUST_BE_NON_NEGATIVE/);
  assert.equal(ledger.verify(), true);
});
