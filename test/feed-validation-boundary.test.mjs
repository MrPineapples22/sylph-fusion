import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Feed} from '../dist/feed.js';
import {config} from '../dist/config.js';
const cfg = () => config({RPC_URLS:'https://rpc.invalid',WS_URLS:'wss://rpc.invalid'});
const feed = consume => new Feed(cfg(), {}, consume || (()=>{}));

test('unrelated or invalid logs cannot renew freshness or advance reconciliation', () => {
  const f = feed();
  f.accept('unrelated', 100, ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 success']);
  f.accept('malformed', 9000, null);
  assert.equal(f.last, 0); assert.equal(f.slot, 0);
  assert.equal(f.gapReconciler.getReport().circularBufferSize, 0);
});

test('partially decoded malformed transactions are atomic at the feed boundary', () => {
  const events=[];const f=feed(e=>events.push(e));
  f.parser={*parseLogs(){yield {name:'createEvent',data:{}};throw Error('truncated');}};
  f.accept('truncated', 100, ['fixture']);
  assert.equal(events.length,0);assert.equal(f.last,0);
});

test('consumer failure locks freshness and cannot produce a healthy feed', () => {
  const f=feed(()=>{throw Error('queue failure');});
  f.parser={*parseLogs(){yield {name:'tradeEvent',data:{}};}};
  f.last=Date.now(); f.readySince=Date.now()-100000;
  f.accept('consumer-failure',100,['fixture']);
  assert.equal(f.healthy(),false);assert.equal(f.last,0);
});

test('decoded transaction event count is bounded before any consumer mutation', () => {
  let consumed=0;const f=feed(()=>consumed++);
  f.parser={*parseLogs(){for(let i=0;i<257;i++)yield {name:'tradeEvent',data:{}};}};
  f.accept('oversized',100,['fixture']);
  assert.equal(consumed,0);assert.equal(f.last,0);
});
