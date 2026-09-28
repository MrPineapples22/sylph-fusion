import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { hasUnsafeReportedTokenExtension, readLargestHolderSnapshot, rugReportRejectionReason } from '../dist/market.js';

test('a stale largest-holder list is refreshed once at a minimum context slot', async () => {
  const mint = new PublicKey('11111111111111111111111111111111');
  const staleAddress = new PublicKey('Vote111111111111111111111111111111111111111');
  const currentAddress = new PublicKey('Stake11111111111111111111111111111111111111');
  let largestCalls = 0;
  const accountReadConfigs = [];
  const fakeConnection = {
    async getTokenLargestAccounts() {
      largestCalls++;
      return { context: { slot: largestCalls }, value: [{ address: largestCalls === 1 ? staleAddress : currentAddress }] };
    },
    async getMultipleAccountsInfoAndContext(_addresses, config) {
      accountReadConfigs.push(config);
      return accountReadConfigs.length === 1
        ? { context: { slot: 1 }, value: [null] }
        : { context: { slot: 2 }, value: [{ data: Buffer.alloc(0) }] };
    },
  };
  const snapshot = await readLargestHolderSnapshot(fakeConnection, mint);
  assert.equal(largestCalls, 2);
  assert.equal(snapshot.accounts[0].address.toBase58(), currentAddress.toBase58());
  assert.ok(snapshot.infos[0]);
  assert.equal(accountReadConfigs[0].minContextSlot, 1);
  assert.equal(accountReadConfigs[1].minContextSlot, 2);
});

test('RugCheck null extension fields mean the extension is absent', () => {
  assert.equal(hasUnsafeReportedTokenExtension({
    nonTransferable: null,
    transferFeeConfig: null,
    defaultAccountState: null,
    permanentDelegate: null,
    transferHook: null,
  }), false);
});

test('inactive extension values do not trigger a false safety rejection', () => {
  assert.equal(hasUnsafeReportedTokenExtension({
    defaultAccountState: 'uninitialized',
    permanentDelegate: { authority: null, address: null },
    transferHook: { programId: null, authority: null },
  }), false);
});

test('configured unsafe extension values remain rejected', () => {
  assert.equal(hasUnsafeReportedTokenExtension({ permanentDelegate: 'Delegate111' }), true);
  assert.equal(hasUnsafeReportedTokenExtension({ transferHook: { programId: 'Hook111' } }), true);
  assert.equal(hasUnsafeReportedTokenExtension({ defaultAccountState: 'frozen' }), true);
  assert.equal(hasUnsafeReportedTokenExtension(['transferHook']), true);
});

test('unrelated extension metadata cannot match by value text alone', () => {
  assert.equal(hasUnsafeReportedTokenExtension({ description: 'transferHook: null' }), false);
});

test('RugCheck veto records the exact score and risk names that triggered it', () => {
  assert.equal(rugReportRejectionReason({ score: 1, rugged: false, risks: [] }, 1000), null);
  assert.equal(
    rugReportRejectionReason({ score: 28801, rugged: false, risks: [{ name: 'Creator history of rugged tokens', level: 'danger' }] }, 1000),
    'rug report rejected (score=28801>1000; risks=Creator history of rugged tokens)',
  );
  assert.equal(
    rugReportRejectionReason({ score: 12, rugged: true, risks: [] }, 1000),
    'rug report rejected (rugged=true)',
  );
});
