import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulatedEngine } from '../../dist/execution-engine.js';
import { reducer, initialState } from '../src/engine.js';
import { createAutomationController } from '../src/automation-controller.js';
import { submitPaperOrder } from '../src/submit-paper-order.js';
import { assetToPoolState } from '../src/pool-sync.js';

test('Auto-Simulate fills a breakout, takes one TP slice, and sweeps a trailing exit', async () => {
  const engine = new SimulatedEngine(7, 100000n, 100000n);
  const controller = createAutomationController();
  let s = { ...initialState(), executionMode: 'external', running: true, liveMode: true, eligibleIds: ['POOL'], positions: [] };
  s.config = { ...s.config, maxPositions: 1, size: .1, interval: 0 };
  s.assets = [{ id: 'POOL', mint: 'TOKEN', price: 1.02, liquidity: 300000, sigma: 0, observedAt: s.now, history: [{ time: s.now/1000-2, value: .98 }, { time: s.now/1000, value: 1.02 }], volume: 4 }];
  const tasks = [], fills = [];
  const execution = {
    submitUsdOrder(input) {
      const task = submitPaperOrder(engine, action => { s = reducer(s, action); }, 150, {...input, allowLocalSimulationFallback: true}).then(r => { fills.push(r); return r; });
      tasks.push(task); return task;
    },
    panicCloseUsd(poolAddress, tokenMint, tokenQty) { return this.submitUsdOrder({ poolAddress, tokenMint, tokenQty, side: 'SELL', maxSlippageBps: 5000, emergency: true }); }
  };
  async function cycle() {
    s.now = Date.now(); s.assets[0].observedAt = s.now;
    engine.pushState(assetToPoolState(s.assets[0],150,s.now), 'POOL');
    // An unrelated pool must never supply this order's reserve quote.
    engine.pushState({ ...assetToPoolState({...s.assets[0],price:1000},150,s.now), timestamp:s.now+1 }, 'OTHER');
    controller.evaluate(s, execution,150);
    await new Promise(resolve => setImmediate(resolve));
    await Promise.all(tasks);
    await new Promise(resolve => setImmediate(resolve));
  }
  await cycle();
  assert.equal(fills[0]?.report.status,'FILLED');
  assert.equal(s.positions.length,1);
  assert.ok(s.positions[0].entry < 1.1 && s.positions[0].entry > 1);
  assert.ok(s.cash < s.initial - 15, 'actual execution fees are charged');
  const originalQty=s.positions[0].qty;
  s.assets[0].price=s.positions[0].entry*1.2;
  await cycle();
  assert.equal(fills[1]?.report.status,'FILLED');
  assert.deepEqual(s.positions[0].tiers,[0]);
  assert.ok(s.positions[0].qty < originalQty);
  // The reducer owns trailing high-water marks and stops.
  s=reducer(s,{type:'TICK',now:Date.now()});
  s.assets[0].price=s.positions[0].high*.9;
  await cycle();
  assert.equal(fills[2]?.report.status,'FILLED');
  assert.equal(s.positions.length,0);
  assert.equal(fills.length,3);
  assert.ok(Number.isFinite(s.cash));
});

test('in-flight entries consume capacity and paused automation submits nothing', async () => {
  let count=0, release;
  const controller=createAutomationController();
  const now=Date.now();
  const s={...initialState(now),executionMode:'external',running:true};
  s.config.maxPositions=1;
  s.assets=['A','B'].map(id=>({id,price:1.02,liquidity:100000,volume:4,history:[{time:now/1000-1,value:1},{time:now/1000,value:1.02}]}));
  const execution={submitUsdOrder(){count++; return new Promise(resolve=>{release=resolve;});}};
  controller.evaluate(s,execution,150);
  await new Promise(resolve=>setImmediate(resolve));
  controller.evaluate({...s,now:now+1000},execution,150);
  assert.equal(count,1);
  release({report:{status:'REJECTED'}});
  await new Promise(resolve=>setImmediate(resolve));
  controller.evaluate({...s,running:false,now:now+20000},execution,150);
  assert.equal(count,1);
});

test('browser command-gateway outage cannot silently execute through a local paper engine', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  let executed = false;
  const actions = [];
  try {
    const result = await submitPaperOrder({ execute: async () => { executed = true; } }, action => actions.push(action), 150, {
      poolAddress: 'POOL', tokenMint: 'TOKEN', side: 'BUY', usdAmount: 10,
    });
    assert.equal(result, null);
    assert.equal(executed, false);
    assert.equal(actions.at(-1).payload.reason, 'COMMAND_GATEWAY_UNAVAILABLE');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed TP remains retryable and does not complete its tier', async () => {
  let count=0;
  const controller=createAutomationController(), now=Date.now();
  const s={...initialState(now),running:true,executionMode:'external'};
  s.assets=[{id:'P',price:1.2,liquidity:100000}];
  s.positions=[{asset:'P',qty:100,initialQty:100,entry:1,stop:.93,tiers:[]}];
  const execution={submitUsdOrder:async()=>{count++;throw Error('temporary failure');}};
  controller.evaluate(s,execution,150);
  await new Promise(resolve=>setImmediate(resolve));
  controller.evaluate({...s,now:now+1000},execution,150);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(count,2);
  assert.deepEqual(s.positions[0].tiers,[]);
});

