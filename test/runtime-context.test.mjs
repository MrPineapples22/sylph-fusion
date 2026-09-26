import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeContext, hasMatchingRuntimeContext } from '../dist/runtime-context.js';

const env = {
  MODE: 'paper', RPC_URLS: 'https://rpc-a.example,https://rpc-b.example', WS_URLS: 'wss://ws-a.example',
};

test('runtime context is immutable, deterministic, and contains no secrets', () => {
  const first = createRuntimeContext({...env, JITO_AUTH: 'must-not-appear'}, {now: 100, runtimeGeneration: 'run-1'});
  const second = createRuntimeContext(env, {now: 200, runtimeGeneration: 'run-2'});
  assert.equal(first.mode, 'PAPER');
  assert.equal(first.configHash, second.configHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.publicConfig), true);
  assert.equal(JSON.stringify(first).includes('must-not-appear'), false);
});

test('live configuration remains blocked without a reviewed coordinator', () => {
  const live = createRuntimeContext({...env, MODE: 'live', KEYPAIR_PATH: 'not-used'}, {now: 100, runtimeGeneration: 'run-live'});
  assert.equal(live.mode, 'LIVE_BLOCKED');
});

test('cross-plane joins require both runtime generation and configuration hash', () => {
  const context = createRuntimeContext(env, {now: 100, runtimeGeneration: 'run-1'});
  assert.equal(hasMatchingRuntimeContext(context, {...context}), true);
  assert.equal(hasMatchingRuntimeContext(context, {...context, runtimeGeneration: 'run-2'}), false);
  assert.equal(hasMatchingRuntimeContext(context, {...context, configHash: 'different'}), false);
});
