#!/usr/bin/env node
import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {ShadowRunner,evaluateStrategyTick} from './shadow-runner.mjs';import {verifyReplay} from './verify-replay.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sylph-edge-')),fixturePath=path.join(directory,'events.jsonl');
const mint='So11111111111111111111111111111111111111112';
const safe={score:1,token:{mintAuthority:null,freezeAuthority:null},markets:[{lp:{lpBurnedPct:100}}],topHolders:[]};
let mode='reject';const engine={execute:async order=>({report:{status:mode==='reject'?'REJECTED':'FILLED',orderId:order.orderId,failureReason:'SLIPPAGE_EXCEEDED',inputAmount:mode==='buy'?400000000n:mode==='sell'?40000000000n:0n,outputAmount:mode==='buy'?40000000000n:mode==='sell'?400000000n:0n,execPrice:.01,priorityFeeLamports:50000n,jitoTipLamports:0n},telemetry:{priceImpactPct:.25}})};
const runner=new ShadowRunner({engine,fixturePath,solPriceUsd:100,jitoService:{start(){},stop(){}}});
try{
 runner.start();const tick={mint,priceUsd:1,slot:10,timestamp:1,reserves:{sol:'1000000000',token:'1000000000'}};
 assert.equal(runner.onMarketTick(tick),true);const stale={...tick,slot:9,priceUsd:99,timestamp:2};assert.equal(runner.onMarketTick(stale),false);assert.equal(await evaluateStrategyTick(stale,runner),undefined);assert.equal(runner.state.assets.find(a=>a.id===mint).price,1);assert.equal(runner.lastSlot,10);
 const start=runner.state.cash;const reject=await runner.onTradeSignal({mint,direction:'BUY',sizeSol:1,tokenReport:safe});assert.equal(reject.event.type,'ORDER_REJECTED');assert.equal(runner.state.cash,start-.005);assert.equal(runner.state.positions.length,0);
 mode='buy';await runner.onTradeSignal({mint,direction:'BUY',sizeSol:1,tokenReport:safe});assert.equal(runner.state.positions[0].qty,40);assert.ok(Math.abs(runner.state.cash-(start-40-.01))<1e-9);
 mode='sell';await runner.onTradeSignal({mint,direction:'SELL',tokenQty:40});assert.equal(runner.state.positions.length,0);assert.ok(Math.abs(runner.state.cash-(start-.015))<1e-9);
 await runner.stop();runner.appendEvent({type:'SESSION_CHECKPOINT',payload:{cash:runner.state.cash,positions:runner.state.positions}});
 assert.equal((await verifyReplay(fixturePath)).isDeterministicMatch,true);
 assert.equal((await verifyReplay(fixturePath,{cash:runner.state.cash,positions:[{asset:mint,qty:1}]})).isDeterministicMatch,false);
 fs.appendFileSync(fixturePath,'bad JSON\n');assert.equal((await verifyReplay(fixturePath)).isDeterministicMatch,false);
 console.log('5/5 edge checks passed: stale ticks, rejection fees, partial settlement, exact liquidation, replay corruption');
}finally{await runner.stop();fs.unlinkSync(fixturePath);fs.rmdirSync(directory);}
