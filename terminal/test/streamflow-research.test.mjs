import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {StreamflowResearchService} from '../streamflow-research.mjs';

const mint = 'So11111111111111111111111111111111111111112';
const rpcUrl = 'https://rpc.example.invalid/?api-key=private-test-key';
const entry = (id, account) => ({publicKey: {toBase58: () => id}, account});
const stream = (overrides = {}) => ({mint, depositedAmount: 1000n, withdrawnAmount: 100n,
  start: 1_700_000_000, end: 1_800_000_000, canceledAt: 0, closed: false,
  cancelableBySender: false, unlocked: seconds => BigInt(seconds > 20 ? 300 : 200), ...overrides});

test('Streamflow uses the official mint-scoped SDK search and reports only read-only schedule facts', async () => {
  let clientMint;
  const service = new StreamflowResearchService({rpcUrl, now: () => 10_000, clientFactory: async receivedRpc => {
    assert.equal(receivedRpc, rpcUrl);
    return {searchStreams: async filters => {
      clientMint = filters.mint;
      return [entry('stream-a', stream({cancelableBySender: true})),
        entry('stream-closed', stream({closed: true})),
        entry('stream-other', stream({mint: '11111111111111111111111111111111'}))];
    }};
  }});
  const result = await service.lookupMint(mint);
  assert.equal(clientMint, mint);
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.provider, 'STREAMFLOW');
  assert.equal(result.authority, 'RESEARCH_ONLY');
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.programId, 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m');
  assert.equal(result.scheduleCount, 1);
  assert.equal(result.remainingRawTotal, '900');
  assert.equal(result.unlockNext7dRawTotal, '100');
  assert.equal(result.cancelableBySenderCount, 1);
  assert.equal(result.schedules[0].streamId, 'stream-a');
  assert.equal(JSON.stringify(result).includes('private-test-key'), false);
});

test('Streamflow stays unavailable without a configured RPC and rejects invalid URLs or mints', async () => {
  let calls = 0;
  const noRpc = new StreamflowResearchService({clientFactory: async () => {calls += 1;}});
  assert.equal((await noRpc.lookupMint(mint)).errorCode, 'STREAMFLOW_RPC_UNCONFIGURED');
  const invalid = new StreamflowResearchService({rpcUrl: 'http://public-rpc.example.invalid', clientFactory: async () => {calls += 1;}});
  assert.equal((await invalid.lookupMint(mint)).errorCode, 'STREAMFLOW_RPC_URL_INVALID');
  const invalidMint = new StreamflowResearchService({rpcUrl, clientFactory: async () => {calls += 1;}});
  assert.equal((await invalidMint.lookupMint('bad mint')).errorCode, 'STREAMFLOW_MINT_INVALID');
  assert.equal(calls, 0);
});

test('Streamflow coalesces concurrent requests, caches briefly, and fails without leaking RPC errors', async () => {
  let calls = 0;
  const service = new StreamflowResearchService({rpcUrl, clientFactory: async () => ({searchStreams: async () => {
    calls += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return [];
  }})});
  const [first, concurrent] = await Promise.all([service.lookupMint(mint), service.lookupMint(mint)]);
  assert.equal(first, concurrent);
  assert.equal((await service.lookupMint(mint)).scheduleCount, 0);
  assert.equal(calls, 1);
  const failure = new StreamflowResearchService({rpcUrl, clientFactory: async () => ({searchStreams: async () => { throw new Error('secret rpc detail'); }})});
  const failed = await failure.lookupMint(mint);
  assert.equal(failed.errorCode, 'STREAMFLOW_RPC_OR_DECODE_FAILURE');
  assert.equal(JSON.stringify(failed).includes('secret rpc detail'), false);
});

test('the pinned Streamflow SDK is available and the lookup is exposed as a manual Astra action', async () => {
  const sdk = await import('@streamflow/stream');
  assert.equal(typeof sdk.SolanaStreamClient, 'function');
  const [server, ui] = await Promise.all([
    readFile(new URL('../server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/Astra.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(server, /\/api\/research\/streamflow-vesting/);
  assert.match(server, /streamflowResearch\.lookupMint\(mint\)/);
  assert.match(ui, /requestStreamflowOverview/);
  assert.match(ui, /Check Streamflow vesting/);
  assert.match(ui, /read-only on-chain lookup/);
});
