import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VaultManager, MANDATE_PRESETS } from '../../dist/platform/vault/vault-manager.js';
import { EventLedger } from '../../dist/platform/ledger/event-ledger.js';
import { DoubleEntryJournal } from '../../dist/platform/ledger/double-entry.js';
import { NavEngine } from '../../dist/platform/ledger/nav-engine.js';

test('VaultManager: registers isolated users and creates segregated vaults', () => {
  const manager = new VaultManager();

  const alice = manager.registerUser('usr-alice', 'AliceDest11111111111111111111111111111111');
  const bob = manager.registerUser('usr-bob', 'BobDest1111111111111111111111111111111111');

  assert.equal(alice.userId, 'usr-alice');
  assert.equal(bob.userId, 'usr-bob');
  assert.notEqual(alice.confirmedDestinationAddress, bob.confirmedDestinationAddress);

  const vaultAlice = manager.createVault('vlt-alice-1', 'usr-alice', 'CONSERVATIVE');
  const vaultBob = manager.createVault('vlt-bob-1', 'usr-bob', 'AGGRESSIVE');

  assert.equal(vaultAlice.state, 'CREATED');
  assert.equal(vaultAlice.mandate.type, 'CONSERVATIVE');
  assert.equal(vaultBob.mandate.type, 'AGGRESSIVE');

  // Verify duplicate user or vault ID is rejected
  assert.throws(() => manager.registerUser('usr-alice', 'Duplicate11111111111111111111111111111111'));
  assert.throws(() => manager.createVault('vlt-alice-1', 'usr-alice'));
});

test('VaultManager: deposit segregates operational reserves and enforces Equity != Risk Capital', () => {
  const manager = new VaultManager();
  manager.registerUser('usr-alice', 'AliceDest11111111111111111111111111111111');
  const vault = manager.createVault('vlt-alice-1', 'usr-alice', 'CONSERVATIVE');

  // Deposit 10 SOL = 10,000,000,000 lamports
  const depositLamports = 10_000_000_000n;
  manager.processDeposit('vlt-alice-1', depositLamports);

  assert.equal(vault.state, 'FUNDED');
  assert.equal(vault.balances.customerAssetsLamports, depositLamports);
  assert.equal(vault.currentNavLamports, depositLamports);
  assert.equal(vault.highWaterMarkLamports, depositLamports);

  // Conservative reserve is 40% (4,000,000,000 lamports)
  const expectedReserve = 4_000_000_000n;
  const expectedTradingCap = 6_000_000_000n;
  assert.equal(vault.balances.operationalReserveLamports, expectedReserve);
  assert.equal(vault.balances.tradingCapitalLamports, expectedTradingCap);

  // Conservative active exposure cap is 40% (4,000,000,000 lamports)
  // Even though trading capital is 6 SOL, authorized risk capital is capped at 4 SOL
  assert.equal(vault.authorizedRiskCapitalLamports, 4_000_000_000n);
  assert.notEqual(vault.currentNavLamports, vault.authorizedRiskCapitalLamports, 'Account Equity MUST NOT equal Risk Capital');
});

test('EventLedger: cryptographic SHA-256 hash chaining and tamper detection', () => {
  const ledger = new EventLedger();

  const ev1 = ledger.append({
    timestamp: 1000,
    type: 'DEPOSIT',
    userId: 'usr-alice',
    vaultId: 'vlt-1',
    asset: 'SOL',
    quantity: '10000000000',
    solValueLamports: 10_000_000_000n,
    source: 'treasury',
    reason: 'Initial funding',
  });

  const ev2 = ledger.append({
    timestamp: 2000,
    type: 'REALIZED_PNL',
    userId: 'usr-alice',
    vaultId: 'vlt-1',
    asset: 'SOL',
    quantity: '500000000',
    solValueLamports: 500_000_000n,
    source: 'execution_engine',
    reason: 'Take profit stage 1',
  });

  const ev3 = ledger.append({
    timestamp: 3000,
    type: 'PLATFORM_FEE',
    userId: 'usr-alice',
    vaultId: 'vlt-1',
    asset: 'SOL',
    quantity: '100000000',
    solValueLamports: 100_000_000n,
    source: 'fee_engine',
    reason: 'Performance fee 20%',
  });

  assert.equal(ev2.previousLedgerHash, ev1.currentLedgerHash);
  assert.equal(ev3.previousLedgerHash, ev2.currentLedgerHash);

  const verification = ledger.verifyChain();
  assert.equal(verification.valid, true);
  assert.equal(verification.verifiedEvents, 3);

  // Reconstruct state from ledger
  const reconstructed = ledger.reconstructVaultState('vlt-1');
  assert.equal(reconstructed.depositsLamports, 10_000_000_000n);
  assert.equal(reconstructed.realizedPnlLamports, 500_000_000n);
  assert.equal(reconstructed.feesPaidLamports, 100_000_000n);
  assert.equal(reconstructed.netCashBalanceLamports, 10_400_000_000n);

  // Compensating adjustment test
  ledger.createCompensatingAdjustment(ev3.eventId, 'vlt-1', 'usr-alice', 20_000_000n, 'Fee rebate adjustment');
  const postAdj = ledger.reconstructVaultState('vlt-1');
  assert.equal(postAdj.netCashBalanceLamports, 10_420_000_000n);
});

test('EventLedger: rejects tampered event payload', () => {
  const ledger = new EventLedger();
  ledger.append({
    timestamp: 1000,
    type: 'DEPOSIT',
    userId: 'usr-alice',
    vaultId: 'vlt-1',
    asset: 'SOL',
    quantity: '10000000000',
    solValueLamports: 10_000_000_000n,
    source: 'treasury',
    reason: 'Initial funding',
  });

  // Tamper with underlying event
  const events = [...ledger.getEvents()];
  events[0] = { ...events[0], solValueLamports: 999_999_999n };

  assert.throws(() => new EventLedger(events), /Hash mismatch/);
});

test('EventLedger: returned events cannot mutate the canonical hash chain', () => {
  const ledger = new EventLedger();
  const event = ledger.append({
    timestamp: 1000, type: 'DEPOSIT', userId: 'usr-alice', vaultId: 'vlt-1', asset: 'SOL',
    quantity: '100', solValueLamports: 100n, source: 'treasury', reason: 'Initial funding',
  });
  event.solValueLamports = 1n;
  const read = ledger.getEvents();
  read[0].solValueLamports = 2n;
  assert.equal(ledger.getEvents()[0].solValueLamports, 100n);
  assert.equal(ledger.verifyChain().valid, true);
});

test('DoubleEntryJournal: enforces debit-credit balance and conservation invariance', () => {
  const journal = new DoubleEntryJournal();

  // 1. Customer deposits 10 SOL
  journal.postDeposit('evt-dep-1', 10_000_000_000n);
  assert.equal(journal.getBalance('Assets:CustomerControlled'), 10_000_000_000n);
  assert.equal(journal.getBalance('Liabilities:CustomerEquity'), 10_000_000_000n);

  // 2. Network friction fee 0.005 SOL
  journal.postNetworkFriction('evt-tx-1', 5_000_000n);
  assert.equal(journal.getBalance('Assets:CustomerControlled'), 9_995_000_000n);
  assert.equal(journal.getBalance('Expenses:NetworkFriction'), 5_000_000n);

  // 3. Platform performance fee 0.1 SOL
  journal.postPlatformFee('evt-fee-1', 100_000_000n);
  assert.equal(journal.getBalance('Liabilities:CustomerEquity'), 9_900_000_000n);
  assert.equal(journal.getBalance('Revenue:PlatformPerformanceFee'), 100_000_000n);

  // 4. Verify fundamental conservation: Assets == Liabilities + Equity
  const conservation = journal.checkConservation();
  assert.equal(conservation.conserved, true);
  assert.equal(conservation.discrepancyLamports, 0n);

  // 5. Imbalanced transaction is strictly rejected
  assert.throws(() => {
    journal.post(
      'evt-bad',
      [
        { account: 'Assets:CustomerControlled', debitLamports: 100n, creditLamports: 0n },
        { account: 'Liabilities:CustomerEquity', debitLamports: 0n, creditLamports: 90n }, // Imbalanced!
      ],
      'Illegal imbalanced entry'
    );
  }, /Double-entry imbalance/);
});

test('DoubleEntryJournal: settlement replay is idempotent and conflicting reuse is rejected', () => {
  const journal = new DoubleEntryJournal();
  const first = journal.postSettlementPayout('settlement:sig-123', 250_000n, 'Confirmed chain settlement');
  const balances = journal.getAllBalances();

  const replay = journal.postSettlementPayout('settlement:sig-123', 250_000n, 'Confirmed chain settlement');
  assert.equal(replay, first, 'an identical replay must return the original journal entry');
  assert.deepEqual(journal.getAllBalances(), balances, 'an identical replay must not apply balances twice');

  assert.throws(
    () => journal.postSettlementPayout('settlement:sig-123', 250_001n, 'Confirmed chain settlement'),
    /Conflicting replay/
  );
  assert.throws(
    () => journal.postSettlementPayout('', 1n),
    /eventId is required/
  );
});

test('NavEngine: deposits do not count as profit and HWM governs performance fees', () => {
  const engine = new NavEngine({
    defaultPerformanceFeeBps: 2000, // 20% fee
    minProfitThresholdLamports: 10_000_000n,
  });

  // Initial State: 10 SOL deposit
  const initialNav = engine.calculateNav({
    vaultId: 'vlt-1',
    cashLamports: 10_000_000_000n,
    unrealizedPositionsValueLamports: 0n,
    startingNavLamports: 10_000_000_000n,
    peakNavLamports: 10_000_000_000n,
    highWaterMarkLamports: 10_000_000_000n,
    realizedPnlLamports: 0n,
    frictionCostsLamports: 0n,
    lifetimeFeesPaidLamports: 0n,
  });

  assert.equal(initialNav.currentNavLamports, 10_000_000_000n);
  assert.equal(initialNav.eligiblePerformanceFeeLamports, 0n, 'Deposits must never trigger performance fees');
  assert.equal(initialNav.drawdownBps, 0);

  // Scenario 1: Trading profit takes NAV to 12 SOL (+2 SOL gain above HWM)
  const profitableNav = engine.calculateNav({
    vaultId: 'vlt-1',
    cashLamports: 12_000_000_000n,
    unrealizedPositionsValueLamports: 0n,
    startingNavLamports: 10_000_000_000n,
    peakNavLamports: 12_000_000_000n,
    highWaterMarkLamports: 10_000_000_000n,
    realizedPnlLamports: 2_000_000_000n,
    frictionCostsLamports: 10_000_000n,
    lifetimeFeesPaidLamports: 0n,
  });

  // 20% of 2 SOL profit = 0.4 SOL fee (400,000,000 lamports)
  assert.equal(profitableNav.eligiblePerformanceFeeLamports, 400_000_000n);
  assert.equal(profitableNav.netSettlementValueLamports, 11_600_000_000n);

  // Crystallize fee -> HWM moves to 12 SOL
  const { feeLamports, newHwmLamports } = engine.crystallizePerformanceFee(profitableNav);
  assert.equal(feeLamports, 400_000_000n);
  assert.equal(newHwmLamports, 12_000_000_000n);

  // Scenario 2: Market drawdown drops NAV to 11 SOL
  const drawdownNav = engine.calculateNav({
    vaultId: 'vlt-1',
    cashLamports: 11_000_000_000n,
    unrealizedPositionsValueLamports: 0n,
    startingNavLamports: 10_000_000_000n,
    peakNavLamports: 12_000_000_000n,
    highWaterMarkLamports: newHwmLamports, // HWM is 12 SOL
    realizedPnlLamports: 1_000_000_000n,
    frictionCostsLamports: 10_000_000n,
    lifetimeFeesPaidLamports: 400_000_000n,
  });

  assert.equal(drawdownNav.eligiblePerformanceFeeLamports, 0n, 'No fee during drawdown below HWM');
  assert.equal(drawdownNav.drawdownBps, 833); // (1/12) = ~8.33%

  // Scenario 3: Recovery from 11 SOL back to 11.8 SOL (still below 12 SOL HWM)
  const recoveryNav = engine.calculateNav({
    vaultId: 'vlt-1',
    cashLamports: 11_800_000_000n,
    unrealizedPositionsValueLamports: 0n,
    startingNavLamports: 10_000_000_000n,
    peakNavLamports: 12_000_000_000n,
    highWaterMarkLamports: newHwmLamports, // HWM is 12 SOL
    realizedPnlLamports: 1_800_000_000n,
    frictionCostsLamports: 10_000_000n,
    lifetimeFeesPaidLamports: 400_000_000n,
  });

  assert.equal(recoveryNav.eligiblePerformanceFeeLamports, 0n, 'Recovery back toward HWM is NOT new profit');
});
