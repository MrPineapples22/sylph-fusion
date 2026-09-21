#!/usr/bin/env node
import http from 'node:http';import assert from 'node:assert/strict';
import {fetchMarketTick} from './live-market-bridge.mjs';
const mint=process.argv[2]||'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const server=http.createServer(async(req,res)=>{try{const tick=await fetchMarketTick(mint);res.writeHead(tick?200:502,{'Content-Type':'application/json'});res.end(JSON.stringify(tick||{error:'No usable SOL-quoted market data'}));}catch(e){res.writeHead(502);res.end(JSON.stringify({error:e.message}));}});
try {
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const response=await fetch('http://127.0.0.1:'+server.address().port,{signal:AbortSignal.timeout(12000)});
 assert.equal(response.status,200,'Upstream bridge failed');const d=await response.json();
 assert.ok(Number.isFinite(d.priceUsd)&&d.priceUsd>0);assert.ok(BigInt(d.reserves.sol)>0n&&BigInt(d.reserves.token)>0n);
 console.log(JSON.stringify({status:response.status,mint:d.mint,priceUsd:d.priceUsd,reserveSource:d.reserveSource,hasTokenReport:Boolean(d.tokenReport)},null,2));
 if(!d.tokenReport)throw Error('Rugcheck report unavailable; entry gates must remain closed');
} catch(e){console.error('Verification failed: '+e.message);process.exitCode=1;}
finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
