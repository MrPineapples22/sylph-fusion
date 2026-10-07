import assert from 'node:assert/strict';
import test from 'node:test';
import { StartSealAuthority } from '../../dist/platform/lifecycle/start-seal.js';

test('STARTSEAL: enforces strict 12-stage sequential startup and forbids illegal shortcuts', () => {
  const startSeal = new StartSealAuthority();
  assert.equal(startSeal.getPhase(), 'BOOT');

  // Attempting to jump directly from BOOT to ENTRY_READY or PROVIDER_SYNC must throw
  assert.throws(
    () => startSeal.advancePhase('ENTRY_READY', 'Illegal shortcut'),
    /STARTSEAL_SEQUENCE_VIOLATION/
  );
  assert.throws(
    () => startSeal.advancePhase('PROVIDER_SYNC', 'Illegal shortcut'),
    /STARTSEAL_SEQUENCE_VIOLATION/
  );
});

test('STARTSEAL: executes full sequence and conducts whole-wallet inventory census', () => {
  const startSeal = new StartSealAuthority();
  const wallet = 'Wallet111111111111111111111111111111111111';

  // 1. BOOT -> RELEASE_VERIFY
  startSeal.verifyRelease('sha256-abc123valid', 'sha256-abc123valid');
  assert.equal(startSeal.getPhase(), 'RELEASE_VERIFY');

  // 2. RELEASE_VERIFY -> FENCE_ACQUIRE
  startSeal.acquireFence(42);
  assert.equal(startSeal.getPhase(), 'FENCE_ACQUIRE');
  assert.equal(startSeal.getFenceEpoch(), 42);

  // 3. FENCE_ACQUIRE -> PROVIDER_SYNC
  startSeal.advancePhase('PROVIDER_SYNC', 'RPC and Yellowstone synchronized at slot 320000000');

  // 4. PROVIDER_SYNC -> JOURNAL_RECOVERY
  startSeal.advancePhase('JOURNAL_RECOVERY', 'Recovered 1500 journal events');

  // 5. JOURNAL_RECOVERY -> PENDING_TX_RECONCILIATION
  startSeal.advancePhase('PENDING_TX_RECONCILIATION', '0 pending transactions found');

  // 6. PENDING_TX_RECONCILIATION -> FULL_WALLET_INVENTORY_CENSUS
  const onChainAccounts = [
    {
      mint: 'MintMatched',
      tokenProgram: 'TOKEN_PROGRAM',
      ataAddress: 'AtaMatched',
      rawBalance: 100_000n,
    },
    {
      mint: 'MintAirdrop',
      tokenProgram: 'TOKEN_2022_PROGRAM',
      ataAddress: 'AtaAirdrop',
      rawBalance: 5_000n, // Unsolicited airdrop token
    },
    {
      mint: 'MintDiscrepancy',
      tokenProgram: 'TOKEN_PROGRAM',
      ataAddress: 'AtaDiscrepancy',
      rawBalance: 40_000n, // On-chain is 40k, local thinks 50k
    },
  ];

  const localPositions = {
    MintMatched: { qty: '100000' },
    MintDiscrepancy: { qty: '50000' },
    MintMissing: { qty: '20000' }, // Local has position, but ATA is absent on-chain!
  };

  const census = startSeal.executeWalletCensus({
    onChainAccounts,
    localKnownPositions: localPositions,
  });

  assert.equal(census.length, 4);
  assert.equal(startSeal.getPhase(), 'FULL_WALLET_INVENTORY_CENSUS');

  // Item 1: Matched Position
  const matched = census.find(i => i.mint === 'MintMatched');
  assert.ok(matched);
  assert.equal(matched.classification, 'MATCHED_POSITION');
  assert.equal(matched.requiresManualReview, false);

  // Item 2: Unsolicited Token
  const airdrop = census.find(i => i.mint === 'MintAirdrop');
  assert.ok(airdrop);
  assert.equal(airdrop.classification, 'UNSOLICITED_TOKEN');
  assert.equal(airdrop.requiresManualReview, true);

  // Item 3: Manual Discrepancy
  const discrepancy = census.find(i => i.mint === 'MintDiscrepancy');
  assert.ok(discrepancy);
  assert.equal(discrepancy.classification, 'MANUAL_DISCREPANCY');
  assert.equal(discrepancy.requiresManualReview, true);

  // Item 4: Missing Inventory
  const missing = census.find(i => i.mint === 'MintMissing');
  assert.ok(missing);
  assert.equal(missing.classification, 'MISSING_INVENTORY');
  assert.equal(missing.requiresManualReview, true);

  // Continue through remaining phases
  startSeal.advancePhase('CAPITAL_CONSERVATION', 'Conserved ledger postings');
  startSeal.advancePhase('TOKEN_SEMANTICS_REFRESH', 'Refreshed active mint certificates');
  startSeal.advancePhase('EVENT_CATCHUP', 'Catchup stream up to date');
  startSeal.advancePhase('REDUCE_ONLY', 'Enforced REDUCE_ONLY mode');
  startSeal.advancePhase('ENTRY_READY', 'System ready');

  // Generate StartSeal certificate
  const cert = startSeal.generateSealCertificate(wallet, 15_000_000_000n);
  assert.equal(cert.fenceEpoch, 42);
  assert.equal(cert.discrepancyCount, 3);
  // Entry is NOT permitted because discrepancies exist!
  assert.equal(cert.isEntryPermitted, false);
  assert.match(cert.reason, /3 wallet inventory discrepancies requiring manual reconciliation/);
});

test('STARTSEAL: caller-asserted clean inventory and phase sequence cannot permit entry', () => {
  const startSeal = new StartSealAuthority();
  const wallet = 'Wallet222222222222222222222222222222222222';

  startSeal.verifyRelease('valid-hash', 'valid-hash');
  startSeal.acquireFence(100);
  startSeal.advancePhase('PROVIDER_SYNC', 'ok');
  startSeal.advancePhase('JOURNAL_RECOVERY', 'ok');
  startSeal.advancePhase('PENDING_TX_RECONCILIATION', 'ok');

  // Clean census: perfect 1:1 match
  startSeal.executeWalletCensus({
    onChainAccounts: [
      {
        mint: 'CleanMint1',
        tokenProgram: 'TOKEN_PROGRAM',
        ataAddress: 'CleanAta1',
        rawBalance: 10_000n,
      },
    ],
    localKnownPositions: {
      CleanMint1: { qty: '10000' },
    },
  });

  startSeal.advancePhase('CAPITAL_CONSERVATION', 'ok');
  startSeal.advancePhase('TOKEN_SEMANTICS_REFRESH', 'ok');
  startSeal.advancePhase('EVENT_CATCHUP', 'ok');
  startSeal.advancePhase('REDUCE_ONLY', 'ok');
  startSeal.advancePhase('ENTRY_READY', 'ok');

  const cert = startSeal.generateSealCertificate(wallet, 20_000_000_000n);
  assert.equal(cert.discrepancyCount, 0);
  assert.equal(cert.isEntryPermitted, false);
  assert.match(cert.reason, /trusted evidence verification is unavailable/);
});
