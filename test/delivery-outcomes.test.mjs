import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { Executor } from '../dist/execution.js';
import { Engine } from '../dist/fusion.js';

const config = () => ({ JITO_URL: 'https://jito.invalid', JITO_AUTH: '', RPC_TIMEOUT_MS: 10 });
const order = () => ({ id: 'id', mint: 'mint', side: 'buy', signature: 'signature', wire: 'identical-wire', lastValidBlockHeight: 1, created: 1, creator: 'creator', tokenProgram: 'program', stage: 0, reserve: '1', reason: 'test', requested: '1' });

test('timeout after possible Jito acceptance is explicit UNKNOWN', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new DOMException('timed out after request transmission', 'TimeoutError'); };
  try {
    const result = await new Executor(config(), {}, {}, Keypair.generate()).broadcast(order());
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(result.signature, 'signature');
  } finally { globalThis.fetch = original; }
});

test('submission throttle is explicit NOT_SENT and does not call transport', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ result: 'bundle' })); };
  try {
    const executor = new Executor(config(), {}, {}, Keypair.generate());
    assert.equal((await executor.broadcast(order())).status, 'ACCEPTED');
    const throttled = await executor.broadcast(order());
    assert.equal(throttled.status, 'NOT_SENT');
    assert.equal(throttled.reason, 'THROTTLED');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('identical-wire retry records explicit delivery evidence without replacing pending order', async () => {
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
