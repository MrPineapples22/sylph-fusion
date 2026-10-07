import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../dist/config.js';
import {Feed} from '../dist/feed.js';
import {createTestIngress} from './support/ingress-fixtures.mjs';

test('duplicates, stale slots, and malformed messages cannot renew feed freshness', async t=>{
 let now=1700000000000;t.mock.method(Date,'now',()=>now);
 const cfg=config({RPC_URLS:'https://one.invalid,https://two.invalid',WS_URLS:'wss://one.invalid'});
 const ingress=createTestIngress({parser:{ *parseLogs(logs) { if (logs.some(l => l === null)) throw new Error('bad'); yield { name: 'tradeEvent', data: {} }; } }});
 const feed=new Feed(cfg,{},ingress);
 const logs=['Program log: valid'];await feed.accept('first',100,logs);const acceptedAt=feed.last;
 now+=cfg.FEED_STALE_MS+1;
 await feed.accept('first',100,logs);await feed.accept('old',1,logs);await feed.accept('bad',101,[null]);await feed.accept('negative',-1,logs);
 assert.equal(feed.last,acceptedAt);assert.equal(feed.healthy(),false);
 await feed.accept('fresh',101,logs);assert.equal(feed.last,now);assert.equal(feed.readySince,now);
});
test('stopping a feed disables health and rejects late messages', async ()=>{
 const cfg=config({RPC_URLS:'https://one.invalid,https://two.invalid',WS_URLS:'wss://one.invalid'});
 const ingress=createTestIngress({parser:{ *parseLogs() { yield { name: 'tradeEvent', data: {} }; } }});
 const feed=new Feed(cfg,{},ingress);
 await feed.accept('first',100,['Program log: valid']);const at=feed.last;
 feed.stop();await feed.accept('late',101,['Program log: valid']);assert.equal(feed.last,at);assert.equal(feed.slot,100);assert.equal(feed.healthy(),false);
});
