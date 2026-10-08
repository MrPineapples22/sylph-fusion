import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeContext} from '../dist/runtime-context.js';
import {composePaperRuntime} from '../dist/runtime-composition.js';
const env={MODE:'paper',RPC_URLS:'https://rpc-a.example,https://rpc-b.example',WS_URLS:'wss://ws-a.example'};
test('composition preserves one injected paper runtime identity',()=>{
 const context=createRuntimeContext(env,{now:1,runtimeGeneration:'r'});
 const composed=composePaperRuntime({context,market:{},execution:{},reconciliation:{}});
 assert.equal(composed.context.runtimeGeneration,'r'); assert.equal(Object.isFrozen(composed),true);
 assert.ok(composed.unit);
 assert.ok(composed.divergenceAuditor);
});
test('composition cannot promote a live configuration',()=>{
 const context=createRuntimeContext({...env,MODE:'live',KEYPAIR_PATH:'unused'});
 assert.throws(()=>composePaperRuntime({context,market:{},execution:{},reconciliation:{}}),/LIVE_RUNTIME_COMPOSITION_UNAVAILABLE/);
});

test('composition requires feed to be paired with its bound ingress', () => {
  const context = createRuntimeContext(env, { now: 1, runtimeGeneration: 'r' });
  const mockIngressA = { submit: async () => ({}) };
  const mockIngressB = { submit: async () => ({}) };
  const mockFeed = { isIngressBound: (port) => port === mockIngressA };

  const composed = composePaperRuntime({
    context, market: {}, execution: {}, reconciliation: {},
    feed: mockFeed, ingress: mockIngressA,
  });
  assert.equal(composed.feed, mockFeed);
  assert.equal(composed.ingress, mockIngressA);

  assert.throws(
    () => composePaperRuntime({
      context, market: {}, execution: {}, reconciliation: {},
      feed: mockFeed, ingress: mockIngressB,
    }),
    /FEED_INGRESS_MISMATCH/
  );

  assert.throws(
    () => composePaperRuntime({
      context, market: {}, execution: {}, reconciliation: {},
      feed: mockFeed,
    }),
    /FEED_REQUIRES_COMPOSITION_INGRESS/
  );
});
