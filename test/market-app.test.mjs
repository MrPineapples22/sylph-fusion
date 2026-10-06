import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePairs, parseKolscan, MarketHub, marketHubAuthenticationRequirement } from '../dist/market-hub.js';
import { globalProviderHealthTracker } from '../dist/platform/ingestion/provider-health.js';
import {recordResult} from '../dist/core.js';
import {PaperPortfolio} from '../dist/paper.js';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';

test('MarketHub classifies only documented public provider endpoints as unauthenticated reads', () => {
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://pumpportal.fun/api/data'), 'NOT_REQUIRED');
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://pumpportal.fun/api/data?api-key=example'), 'NOT_REQUIRED');
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://custom.example/api/data'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://pumpportal.fun.evil.example/api/data'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://pumpportal.fun:8443/api/data'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://user:p@pumpportal.fun/api/data'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('PUMPPORTAL_WS', 'wss://pumpportal.fun/api/data?proxy=custom'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com'), 'NOT_REQUIRED');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://custom.example'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'http://api.dexscreener.com'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com:8443'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://user:p@api.dexscreener.com'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com?proxy=custom'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com?'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com#'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com/?'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com/#'), 'UNKNOWN');
  assert.equal(marketHubAuthenticationRequirement('DEXSCREENER_API', 'https://api.dexscreener.com/path-prefix'), 'UNKNOWN');
});
import {join} from 'node:path';
const mint='So11111111111111111111111111111111111111112';
test('market pairs use Solana addresses, retain unknown prices, and select highest liquidity',()=>{
 const base={chainId:'solana',baseToken:{address:mint,symbol:'SOL'}};
 const rows=normalizePairs([{...base,liquidity:{usd:20},priceUsd:'12'},{...base,liquidity:{usd:30}}, {...base,chainId:'ethereum',priceUsd:'500'}]);
 assert.equal(rows.length,1);assert.equal(rows[0].price,null);assert.equal(rows[0].liquidity,30);
});
test('Kolscan parser preserves transactions when later components contain empty arrays',()=>{
 const r={signature:'1'.repeat(88),wallet_address:mint,timestamp:1700000000,sol_change:2,in_token_address:mint,name:'Test'};
 const flight='3:'+JSON.stringify(['$',null,{transactions:[r]}])+'\n4:'+JSON.stringify({transactions:[]})+'\n';
 const rows=parseKolscan('<script>self.__next_f.push('+JSON.stringify([1,flight])+')</script>');
 assert.equal(rows.length,1);assert.equal(rows[0].side,'sell');assert.equal(rows[0].sol,2);
});
test('watchlist validates addresses and persists additions and removal',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sylph-watch-'));try{const hub=new MarketHub(join(dir,'watch.json'));await assert.rejects(hub.watch('invalid',true));await hub.watch(mint,true);assert.deepEqual(hub.watches,[mint]);await hub.watch(mint,false);assert.deepEqual(hub.watches,[]);}finally{await rm(dir,{recursive:true,force:true});}
});
test('cumulative performance survives journal truncation and includes failed fees',()=>{
 const s={};for(let i=0;i<305;i++) recordResult(s,mint,'sell',String(i),20n,10n);
 recordResult(s,mint,'failed','failed',-7n,-7n);
 assert.equal(s.performance.realized,'3043');assert.equal(s.performance.count,306);assert.equal(s.performance.fills.length,300);
});
test('paper portfolio opens, marks, scales at 2x, and persists', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sylph-paper-')); try {
  const file=join(dir,'paper.json'), p=new PaperPortfolio(file,3,100000000); await p.start();
  const token={mint:'Test111111111111111111111111111111111111111',address:'',symbol:'TEST',name:'Test',price:1,change:null,liquidity:1000,volume:1000,cap:10000,pair:'',dex:'',at:Date.now()};
  const sol={...token,mint:'So11111111111111111111111111111111111111112',symbol:'SOL',price:100};
  await p.buy(token,[token,sol]); let snap=p.snapshot([{...token,price:2},sol]); assert.equal(snap.positions.length,1);
  await p.tick([{...token,price:2},sol]); snap=p.snapshot([{...token,price:2},sol]); assert.equal(snap.positions[0].stage,1); assert.equal(snap.positions[0].cost,'50000000');
  const restored=new PaperPortfolio(file); await restored.start(); assert.equal(restored.snapshot([{...token,price:2},sol]).positions.length,1);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('paper auto mode enters only after safety approval and writes an analysis CSV', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sylph-paper-auto-')); try {
  const file=join(dir,'paper.json'), csv=join(dir,'paper_trades.csv'), p=new PaperPortfolio(file,3,100000000,csv); await p.start();
  const token={mint:'Auto111111111111111111111111111111111111111',symbol:'AUTO',name:'Auto token',price:1,change:12,liquidity:60000,volume:100000,cap:50000,pair:'pair',dex:'raydium',at:Date.now()};
  const sol={...token,mint:'So11111111111111111111111111111111111111112',symbol:'SOL',price:100};
  await p.setAutoPaper(true); await p.tick([token,sol],async()=>({safe:true})); const snap=p.snapshot([token,sol]);
  assert.equal(snap.positions.length,1); assert.equal(snap.positions[0].strategy,'auto-paper-cleared');
  const lines=(await readFile(csv,'utf8')).trim().split('\n'); assert.equal(lines.length,2); assert.match(lines[0],/price_usd.*liquidity_usd.*pnl_lamports/); assert.match(lines[1],/auto-paper/);
 } finally { await rm(dir,{recursive:true,force:true}); }
});
test('paper exit ladder realizes an early gain and protects the remainder', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sylph-paper-ladder-')); try {
  const p=new PaperPortfolio(join(dir,'paper.json'),3,100000000), token={mint:'Ladder1111111111111111111111111111111111111',symbol:'LAD',name:'Ladder',price:1,change:0,liquidity:60000,volume:100000,cap:50000,pair:'pair',dex:'raydium',at:Date.now()}, sol={...token,mint:'So11111111111111111111111111111111111111112',symbol:'SOL',price:100}; await p.start(); await p.buy(token,[token,sol]); await p.tick([{...token,price:1.2},sol]); const s=p.snapshot([{...token,price:1.2},sol]); assert.equal(s.positions[0].stage,1); assert.equal(s.positions[0].cost,'50000000'); assert.equal(BigInt(s.performance.realized)>0n,true);
 } finally { await rm(dir,{recursive:true,force:true}); }
});

test('Kolscan buy direction comes from token output, not unsigned SOL volume',()=>{
 const r={signature:'2'.repeat(88),wallet_address:mint,timestamp:1700000000,sol_change:2,out_amount:10,out_token_address:mint};
 const flight='3:'+JSON.stringify({transactions:[r]})+'\n';
 assert.equal(parseKolscan('<script>self.__next_f.push('+JSON.stringify([1,flight])+')</script>')[0].side,'buy');
});

test('Solana poller rejects negative slots and does not classify error text as HTTP 429', async t => {
 let success=0, failure=0, rateLimit=0, calls=0;
 t.mock.method(globalProviderHealthTracker,'recordSuccess',()=>{success++;});
 t.mock.method(globalProviderHealthTracker,'recordFailure',()=>{failure++;});
 t.mock.method(globalProviderHealthTracker,'recordRateLimit',()=>{rateLimit++;});
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{
  calls++;
  if(calls===1) return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:-1}));
  if(calls===2) throw new Error('socket 429 timeout');
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:99}));
 };
 try {
  const hub=new MarketHub('unused-watchlist.json','https://rpc.example');
  await hub.solana();
  assert.equal(hub.network.slot,null);
  assert.equal(hub.status.solana.state,'unavailable');
  await hub.solana();
  assert.equal(hub.network.slot,null);
  assert.equal(hub.status.solana.state,'unavailable');
  assert.equal(success,0);
  assert.equal(failure,2);
  assert.equal(rateLimit,0);
  await hub.solana();
  assert.equal(hub.network.slot,99);
  assert.equal(hub.status.solana.state,'live');
  assert.equal(success,1);
  assert.equal(failure,2);
  assert.equal(rateLimit,0);
 } finally { globalThis.fetch=original; }
});
