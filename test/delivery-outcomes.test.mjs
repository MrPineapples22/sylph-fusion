import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { Executor } from '../dist/execution.js';
import { Engine } from '../dist/fusion.js';

const config = () => ({ JITO_URL: 'https://jito.invalid', JITO_AUTH: '', RPC_TIMEOUT_MS: 10 });
const order = () => ({ id: 'id', mint: 'mint', side: 'buy', signature: 'signature', wire: 'identical-wire', lastValidBlockHeight: 1, created: 1, creator: 'creator', tokenProgram: 'program', stage: 0, reserve: '1', reason: 'test', requested: '1' });

test('legacy broadcast rejects before a timeout-capable transport can run', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new DOMException('timed out after request transmission', 'TimeoutError'); };
  try {
    await assert.rejects(new Executor(config(), {}, {}, Keypair.generate()).broadcast(order()), /QUARANTINED_LEGACY_BROADCAST/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('legacy broadcast rejects every attempt without reaching a transport', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ result: 'bundle' })); };
  try {
    const executor = new Executor(config(), {}, {}, Keypair.generate());
    await assert.rejects(executor.broadcast(order()), /QUARANTINED_LEGACY_BROADCAST/);
    await assert.rejects(executor.broadcast(order()), /QUARANTINED_LEGACY_BROADCAST/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('delivery bookkeeping with a fake authority preserves identical wire and pending identity', async () => {
  const engine = Object.create(Engine.prototype);
  const pending = order();
  engine.state = { pending };
  const wires = [], events = [];
  engine.store = { save: async (_state, event) => events.push(event) };
  engine.executor = { broadcast: async sent => {
    wires.push(sent.wire);
    return { status: wires.length === 1 ? 'UNKNOWN' : 'ACCEPTED', signature: sent.signature, attemptedAt: wires.length, ...(wires.length === 2 ? { bundleId: 'bundle' } : {}) };
  } };
  assert.equal((await engine.persistAndBroadcast(pending)).status, 'UNKNOWN');
  assert.equal((await engine.persistAndBroadcast(pending)).status, 'ACCEPTED');
  assert.deepEqual(wires, ['identical-wire', 'identical-wire']);
  assert.equal(engine.state.pending, pending);
  assert.deepEqual(pending.deliveryAttempts.map(x => x.status), ['UNKNOWN', 'ACCEPTED']);
  assert.deepEqual(events, ['prepared:signature', 'delivery:UNKNOWN:signature', 'prepared:signature', 'delivery:ACCEPTED:signature']);
});
