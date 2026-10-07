import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Feed} from '../dist/feed.js';
import {config} from '../dist/config.js';
import {createCanonicalSolanaIngress,InMemoryIngressJournal} from '../dist/platform/ingress/canonical-ingress.js';

const cfg = () => config({RPC_URLS:'https://rpc.invalid',WS_URLS:'wss://rpc.invalid'});
const feed = consume => {
  const ingress = createCanonicalSolanaIngress({
    journal: new InMemoryIngressJournal(),
    onCommitted: (committed) => {
      if (consume) {
        for (const ev of committed.validatedEnvelope.compiledEnvelope.decodedEvents) {
          consume(ev);
        }
      }
    }
  });
  return new Feed(cfg(), {}, ingress);
};

test('unrelated or invalid logs cannot renew freshness or advance reconciliation', async () => {
  const f = feed();
  await f.accept('unrelated', 100, ['Program 11111111111111111111111111111111 invoke [1]', 'Program 11111111111111111111111111111111 success']);
  await f.accept('malformed', 9000, null);
  assert.equal(f.last, 0); assert.equal(f.slot, 0);
  assert.equal(f.gapReconciler.getReport().circularBufferSize, 0);
});

test('partially decoded malformed transactions are atomic at the feed boundary', async () => {
  const events=[];const f=feed(e=>events.push(e));
  f.parser={*parseLogs(){yield {name:'createEvent',data:{}};throw Error('truncated');}};
  await f.accept('truncated', 100, ['fixture']);
  assert.equal(events.length,0);assert.equal(f.last,0);
});

test('consumer failure locks freshness and cannot produce a healthy feed', async () => {
  const f=feed(()=>{throw Error('queue failure');});
  f.parser={*parseLogs(){yield {name:'tradeEvent',data:{}};}};
  f.last=Date.now(); f.readySince=Date.now()-100000;
  await f.accept('consumer-failure',100,['fixture']);
  assert.equal(f.healthy(),false);assert.equal(f.last,0);
});

test('decoded transaction event count is bounded before any consumer mutation', async () => {
  let consumed=0;const f=feed(()=>consumed++);
  f.parser={*parseLogs(){for(let i=0;i<257;i++)yield {name:'tradeEvent',data:{}};}};
  await f.accept('oversized',100,['fixture']);
  assert.equal(consumed,0);assert.equal(f.last,0);
});

test('accepted provider observations carry immutable provenance and a payload hash', async () => {
  const events=[];const f=feed(e=>events.push(e));
  f.parser={*parseLogs(){yield {name:'tradeEvent',data:{}};}};
  await f.accept('signature-provenance',101,['Program log: valid'],{sourceId:'geyser-a',providerId:'https://provider.invalid',transport:'websocket.logsSubscribe',commitment:'confirmed'});
  const observation=events[0].observation;
  assert.equal(observation.signature,'signature-provenance');
  assert.equal(observation.slot,101);
  assert.equal(observation.commitment,'confirmed');
  assert.equal(observation.providerId,'https://provider.invalid');
  assert.match(observation.rawPayloadHash,/^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(observation),true);
  assert.equal(observation.transactionVersion,'unknown');
  assert.equal(observation.schemaVersion,'solana-program-logs/v1');
});

test('observation identity binds provider and transport, and unsafe source metadata is rejected', async () => {
  const a=[];const b=[];const first=feed(e=>a.push(e));const second=feed(e=>b.push(e));
  first.parser=second.parser={*parseLogs(){yield {name:'tradeEvent',data:{}};}};
  const logs=['Program log: valid'];
  await first.accept('same-signature',103,logs,{sourceId:'ws-1',providerId:'https://one.invalid',transport:'websocket.logsSubscribe',commitment:'confirmed'});
  await second.accept('same-signature',103,logs,{sourceId:'ws-1',providerId:'https://two.invalid',transport:'websocket.logsSubscribe',commitment:'confirmed'});
  assert.notEqual(a[0].observation.observationId,b[0].observation.observationId);
  const rejected=feed();rejected.parser={*parseLogs(){yield {name:'tradeEvent',data:{}};}};
  await rejected.accept('bad-source',104,logs,{sourceId:'ws-1',providerId:'https://user:secret@rpc.invalid/path?token=secret',transport:'websocket.logsSubscribe',commitment:'confirmed'});
  await rejected.accept('bad-commitment',104,logs,{sourceId:'ws-1',providerId:'rpc-1',transport:'websocket.logsSubscribe',commitment:'optimistic'});
  await rejected.accept('missing-source',104,logs,{});
  assert.equal(rejected.last,0);
});

test('stopping a feed interrupts reconnect backoff immediately', async () => {
  const f=feed();
  const waiting=f.reconnectDelay(10000);
  f.stop();
  const timeout=new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Backoff did not stop')),500);timer.unref();});
  await Promise.race([waiting,timeout]);
  assert.equal(f.healthy(),false);
});
