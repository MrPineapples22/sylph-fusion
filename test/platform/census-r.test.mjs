import assert from 'node:assert/strict';
import test from 'node:test';
import { CensusRJournalAuthority } from '../../dist/platform/ingestion/census-r.js';

test('CENSUS-R: commits transaction event batches atomically with canonical event IDs (Section 10)', () => {
  const census = new CensusRJournalAuthority();

  const batch = census.commitTransactionBatch({
    slot: 310000000,
    bankHash: 'bank-hash-alpha',
    txHash: 'tx5eUm8K9YiCqAxtyZgmmN1NGhmD3D2C9Azp2Za7nxwhiN',
    providerId: 'yellowstone-grpc-1',
    providerTimestampMs: 1790400000000,
    events: [
      { eventType: 'CREATOR_TRANSFER', payload: { creator: 'DevWallet', amount: 500000 } },
      { eventType: 'BONDING_CURVE_UPDATE', payload: { virtualSol: '30000000000', virtualTokens: '1073000000000000' } },
      { eventType: 'TRADE_EXECUTION', payload: { buyer: 'Trader1', solIn: 1000000000 } },
    ],
  });

  assert.equal(batch.isCommitted, true);
  assert.equal(batch.events.length, 3);
  assert.equal(census.getJournalLength(), 3);

  // Verify canonical event ID format: <slot>:<bank_hash>:<tx_hash>:<event_idx>
  assert.equal(batch.events[0]?.eventId, '310000000:bank-has:tx5eUm8K9YiCqAxt:0');
  assert.equal(batch.events[1]?.eventId, '310000000:bank-has:tx5eUm8K9YiCqAxt:1');
  assert.equal(batch.events[2]?.eventId, '310000000:bank-has:tx5eUm8K9YiCqAxt:2');

  const wm = census.getWatermark();
  assert.equal(wm.highestObservedSlot, 310000000);
  assert.equal(wm.highestCanonicalSlot, 310000000);
});

test('CENSUS-R: late events (event.slot < currentSlot) repair historical state without being dropped (Section 9)', () => {
  const census = new CensusRJournalAuthority();

  // Commit batch at slot 310000050
  census.commitTransactionBatch({
    slot: 310000050,
    bankHash: 'bank-hash-1',
    txHash: 'tx-recent',
    providerId: 'rpc-1',
    providerTimestampMs: 1790400050000,
    events: [{ eventType: 'TRADE', payload: { id: 2 } }],
  });

  // Late arriving event from slot 310000020 arrives now
  const late = census.ingestLateEvent({
    slot: 310000020, // < 310000050!
    bankHash: 'bank-hash-1',
    txHash: 'tx-late',
    eventIndex: 0,
    providerId: 'yellowstone-backup',
    providerTimestampMs: 1790400020000,
    eventType: 'MINT_GENESIS',
    payload: { mint: 'LateMint111' },
  });

  assert.ok(late);
  assert.equal(census.getJournalLength(), 2);

  // Late event is ordered correctly before slot 310000050 in historical replay!
  const replayed = census.replayJournal();
  assert.equal(replayed[0]?.slot, 310000020);
  assert.equal(replayed[1]?.slot, 310000050);
});

test('CENSUS-R: rolls back unsealed events from an abandoned bank fork (Section 9)', () => {
  const census = new CensusRJournalAuthority();

  // Commit at slot 310000100 on Main Fork
  census.commitTransactionBatch({
    slot: 310000100,
    bankHash: 'fork-main',
    txHash: 'tx-main',
    providerId: 'rpc-1',
    providerTimestampMs: 1790400100000,
    events: [{ eventType: 'TRADE', payload: { main: true } }],
  });

  // Seal slot 310000100
  census.sealUpToSlot(310000100);

  // Commit at slot 310000105 on Ghost Fork
  census.commitTransactionBatch({
    slot: 310000105,
    bankHash: 'fork-ghost',
    txHash: 'tx-ghost',
    providerId: 'rpc-1',
    providerTimestampMs: 1790400105000,
    events: [{ eventType: 'TRADE', payload: { ghost: true } }],
  });

  assert.equal(census.getJournalLength(), 2);

  // Fork reorg: Fork-ghost is abandoned; rollback to ancestor slot 310000100
  const rollback = census.rollbackFork('fork-ghost', 310000100);
  assert.equal(rollback.rolledBackEventsCount, 1);
  assert.equal(census.getJournalLength(), 1);

  // Sealed event on main fork survived
  const replayed = census.replayJournal();
  assert.equal(replayed[0]?.bankHash, 'fork-main');
  assert.equal(replayed[0]?.stage, 'SEALED');
});
