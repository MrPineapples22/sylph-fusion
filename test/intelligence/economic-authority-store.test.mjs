import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EconomicAuthorityStore } from '../../dist/intelligence/capital/economic-authority-store.js';

test('EconomicAuthorityStore: Genesis initialization and hash-chained journal', () => {
  const store = new EconomicAuthorityStore(100_000_000_000n); // 100 SOL in lamports

  assert.equal(store.getConfirmedCash(), 100_000_000_000n);
  // Default emergency reserve is 5 SOL (5_000_000_000n)
  assert.equal(store.getAvailableCash(), 95_000_000_000n);
  assert.equal(store.getReservedCash(), 0n);

  const journal = store.getJournal();
  assert.equal(journal.length, 1);
  assert.equal(journal[0].eventType, 'GENESIS_LOAD');
  assert.equal(journal[0].sequenceNumber, 1n);
  assert.equal(journal[0].deltaCashLamports, 100_000_000_000n);
  assert.equal(journal[0].balanceAfterCashLamports, 100_000_000_000n);
  assert.equal(journal[0].previousHash, '0000000000000000000000000000000000000000000000000000000000000000');
  assert.ok(journal[0].entryHash.length === 64);
  assert.equal(store.getLastJournalHash(), journal[0].entryHash);
});

test('EconomicAuthorityStore: Reservation lifecycle and solvency gating', () => {
  const store = new EconomicAuthorityStore(10_000_000_000n); // 10 SOL (5 SOL available after 5 SOL reserve)

  // 1. Valid reservation
  const res = store.acquireReservation('intent_alpha_1', 2_000_000_000n, 150);
  assert.equal(res.intentId, 'intent_alpha_1');
  assert.equal(res.maxDebitLamports, 2_000_000_000n);
  assert.equal(store.getReservedCash(), 2_000_000_000n);
  assert.equal(store.getAvailableCash(), 3_000_000_000n);
  assert.equal(store.getConfirmedCash(), 10_000_000_000n); // Unsettled cash not debited yet

  // 2. Reject reservation exceeding available cash (3 SOL available, request 4 SOL)
  assert.throws(
    () => store.acquireReservation('intent_oversize', 4_000_000_000n, 150),
    /RESERVATION_DENIED/
  );

  // 3. Release reservation
  store.releaseReservation(res.reservationId, 151);
  assert.equal(store.getReservedCash(), 0n);
  assert.equal(store.getAvailableCash(), 5_000_000_000n);

  const journal = store.getJournal();
  assert.equal(journal.length, 3); // GENESIS, RESERVATION_ACQUIRED, RESERVATION_RELEASED
  assert.equal(journal[1].eventType, 'RESERVATION_ACQUIRED');
  assert.equal(journal[2].eventType, 'RESERVATION_RELEASED');
  assert.equal(journal[2].previousHash, journal[1].entryHash);
});

test('EconomicAuthorityStore: Settle Buy Fill (Lot Creation & Cash Debit)', () => {
  const store = new EconomicAuthorityStore(10_000_000_000n);
  const res = store.acquireReservation('intent_buy_1', 2_000_000_000n, 200);

  const lot = store.settleOpenFill({
    intentId: 'intent_buy_1',
    reservationId: res.reservationId,
    mint: 'PumpToken111111111111111111111111111111111111',
    tokenQtyRaw: 1_000_000_000_000n, // 1,000,000 tokens with 6 decimals
    principalDebitLamports: 1_500_000_000n, // 1.5 SOL
    feeLamports: 5_000n,
    tipLamports: 100_000n,
    rentLamports: 2_039_280n,
    slot: 201,
    signature: '5K3W...mock_buy_signature',
  });

  assert.ok(lot.lotId.startsWith('lot_PumpToke'));
  assert.equal(lot.rawTokenQty, 1_000_000_000_000n);
  assert.equal(lot.remainingTokenQty, 1_000_000_000_000n);
  assert.equal(lot.originalBasisLamports, 1_500_000_000n);
  assert.equal(lot.remainingBasisLamports, 1_500_000_000n);

  // Reservation cleared
  assert.equal(store.getReservedCash(), 0n);

  // Cash debited: 10 SOL - 1.5 SOL - (5000 + 100000 + 2039280)
  const expectedCashDebit = 1_500_000_000n + 5_000n + 100_000n + 2_039_280n;
  assert.equal(store.getConfirmedCash(), 10_000_000_000n - expectedCashDebit);

  // Inventory updated
  assert.equal(store.getTokenInventory('PumpToken111111111111111111111111111111111111'), 1_000_000_000_000n);

  // Conservation check
  const conservation = store.verifyConservation();
  assert.equal(conservation.isValid, true);
  assert.equal(conservation.discrepancies.length, 0);
});

test('EconomicAuthorityStore: Multi-lot FIFO partial exit basis relief & PnL calculation', () => {
  const store = new EconomicAuthorityStore(20_000_000_000n);
  const mint = 'TargetToken22222222222222222222222222222222';

  // Buy Lot 1: 500 tokens for 1.0 SOL
  store.settleOpenFill({
    intentId: 'buy_lot_1',
    mint,
    tokenQtyRaw: 500n,
    principalDebitLamports: 1_000_000_000n,
    feeLamports: 5_000n,
    tipLamports: 0n,
    rentLamports: 0n,
    slot: 100,
    signature: 'sig_buy_1',
  });

  // Buy Lot 2: 500 tokens for 2.0 SOL (higher entry)
  store.settleOpenFill({
    intentId: 'buy_lot_2',
    mint,
    tokenQtyRaw: 500n,
    principalDebitLamports: 2_000_000_000n,
    feeLamports: 5_000n,
    tipLamports: 0n,
    rentLamports: 0n,
    slot: 105,
    signature: 'sig_buy_2',
  });

  assert.equal(store.getTokenInventory(mint), 1000n);
  const activeLots = store.getActiveLots(mint);
  assert.equal(activeLots.length, 2);

  // Exit 750 tokens (Full Lot 1 [500] + Half Lot 2 [250])
  // Gross proceeds: 4.0 SOL (4_000_000_000 lamports)
  // Exit friction: 5,000 fee + 20,000 tip = 25,000 lamports
  // Basis relieved should be:
  //   Lot 1: 1,000,000,000 (all)
  //   Lot 2: (2,000,000,000 * 250) / 500 = 1,000,000,000
  //   Total basis relieved: 2,000,000,000 lamports (2 SOL)
  // Realized PnL: 4,000,000,000 (gross) - 2,000,000,000 (basis) - 25,000 (friction) = 1,999,975,000 lamports

  const exitResult = store.settlePartialOrFullExit({
    intentId: 'exit_partial_1',
    mint,
    tokensToSellRaw: 750n,
    grossProceedsLamports: 4_000_000_000n,
    exitFeeLamports: 5_000n,
    exitTipLamports: 20_000n,
    slot: 110,
    signature: 'sig_exit_1',
  });

  assert.equal(exitResult.tokensSoldRaw, 750n);
  assert.equal(exitResult.grossProceedsLamports, 4_000_000_000n);
  assert.equal(exitResult.basisRelievedLamports, 2_000_000_000n);
  assert.equal(exitResult.exitFrictionLamports, 25_000n);
  assert.equal(exitResult.realizedPnLLamports, 1_999_975_000n);
  assert.equal(exitResult.remainingTokensRaw, 250n);
  assert.equal(exitResult.remainingBasisLamports, 1_000_000_000n);
  assert.equal(exitResult.lotsAffected.length, 2);

  // Remaining active lots: only Lot 2 with 250 tokens and 1 SOL basis
  const remainingLots = store.getActiveLots(mint);
  assert.equal(remainingLots.length, 1);
  assert.equal(remainingLots[0].remainingTokenQty, 250n);
  assert.equal(remainingLots[0].remainingBasisLamports, 1_000_000_000n);

  // Total conservation verification
  const conservation = store.verifyConservation();
  assert.equal(conservation.isValid, true);
  assert.equal(conservation.discrepancies.length, 0);

  // Inventory violation check: trying to sell 300 when only 250 remaining
  assert.throws(
    () =>
      store.settlePartialOrFullExit({
        intentId: 'exit_excess',
        mint,
        tokensToSellRaw: 300n,
        grossProceedsLamports: 1_000_000_000n,
        exitFeeLamports: 5_000n,
        exitTipLamports: 0n,
        slot: 120,
        signature: 'sig_exit_excess',
      }),
    /INVENTORY_VIOLATION/
  );
});
