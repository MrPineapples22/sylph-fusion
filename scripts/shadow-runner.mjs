import {executePaperOrder} from '../src/adapters/paper-execution-adapter.js';
import {createEventStreamWriter} from './event-stream-writer.mjs';
import {JitoTipFloorService} from '../terminal/src/services/jito-floor.js';
import {reducer,initialState} from '../terminal/src/engine.js';
import {calculateVelocityBps,isTrailingStopTriggered} from '../terminal/src/strategy-math.js';
import {normalizeToRugcheckReport} from '../terminal/src/preflight-adapter.js';
import {applyLedgerEvent} from './ledger-events.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import fs from 'node:fs';import path from 'node:path';
import {DashboardUI} from './ui-dashboard.mjs';
const jsonl=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v);
export class ShadowRunner {
 constructor({fixturePath='./data/shadow-session.jsonl',solPriceUsd=150,config={},engine,jitoService}={}){
  this.state=initialState();this.solPriceUsd=solPriceUsd;this.appendEvent=createEventStreamWriter(fixturePath);this.jitoService=jitoService||new JitoTipFloorService();this.engine=engine;this.config=config;this.active=false;this.lastSlot=-1;this.slots=new Map();this.observations=new Map();this.trackers=new Map();this.pending=new Map();
 }
 start(){this.active=true;this.jitoService.start?.();}
 async stop(){this.active=false;this.jitoService.stop?.();await Promise.allSettled([...this.pending.values()]);}
 onTradeSignal(o){
  if(!this.active||!this.engine||this.pending.has(o.mint))return Promise.resolve();
  const task=this.executeSignal(o).finally(()=>this.pending.delete(o.mint));this.pending.set(o.mint,task);return task;
 }
 async executeSignal(o){
  const tick=this.observations.get(o.mint),position=this.state.positions.find(p=>p.asset===o.mint);
  let event;
  if(o.direction==='SELL'&&(!position||!Number.isFinite(o.tokenQty)||o.tokenQty>position.qty+1e-9))event={type:'ORDER_REJECTED',payload:{mint:o.mint,reason:'Insufficient confirmed token balance',feeUsd:0,timestamp:Date.now()}};
  else if(o.direction!=='SELL'&&o.sizeSol*this.solPriceUsd>this.state.cash)event={type:'ORDER_REJECTED',payload:{mint:o.mint,reason:'Insufficient paper cash',feeUsd:0,timestamp:Date.now()}};
  else event=await executePaperOrder({...o,config:this.config,tokenDecimals:o.tokenDecimals??tick?.tokenDecimals??9,solPriceUsd:tick?.solPriceUsd??this.solPriceUsd,engine:this.engine,jitoService:this.jitoService,tokenReport:normalizeToRugcheckReport(o.tokenReport??tick?.tokenReport)});
  this.state=applyLedgerEvent(this.state,event,reducer);this.appendEvent(event);return {event,currentState:this.state};
 }
 onMarketTick(tick){
  if(!this.active||!tick.mint||!Number.isFinite(tick.priceUsd)||tick.priceUsd<=0||!Number.isFinite(tick.timestamp)||!Number.isFinite(tick.slot)||tick.slot<=(this.slots.get(tick.mint)??-1))return false;
  const previous=this.observations.get(tick.mint);if(previous&&tick.timestamp<=previous.timestamp)return false;
  let reserves;try{reserves={sol:BigInt(tick.reserves.sol),token:BigInt(tick.reserves.token)};if(reserves.sol<=0n||reserves.token<=0n)return false;}catch{return false;}
  this.slots.set(tick.mint,tick.slot);this.lastSlot=Math.max(this.lastSlot,tick.slot);this.observations.set(tick.mint,tick);
  this.engine?.pushState?.({timestamp:tick.timestamp,slot:tick.slot,reserves,price:tick.priceUsd,volatility:Number(tick.volatility)||0},tick.pool||tick.mint);
  const event={type:'TICK',asset:tick.mint,price:tick.priceUsd,reserves:tick.reserves,slot:tick.slot,timestamp:tick.timestamp};
  this.state=applyLedgerEvent(this.state,event,reducer);this.appendEvent(event);return true;
 }
}
export async function evaluateStrategyTick(tick,runner){
 if(runner.observations.get(tick.mint)!==tick)return;
 const old=runner.trackers.get(tick.mint),p=runner.state.positions.find(p=>p.asset===tick.mint);
 const next={prevPrice:tick.priceUsd,prevTimestamp:tick.timestamp,highWaterMark:p?Math.max(old?.highWaterMark??p.entry,tick.priceUsd):tick.priceUsd};
 runner.trackers.set(tick.mint,next);if(!old||runner.pending.has(tick.mint))return;
 const dt=tick.timestamp-old.prevTimestamp;if(dt<=0)return;
 const v=calculateVelocityBps(tick.priceUsd,old.prevPrice,dt,true);
 if(!p&&v>=(Number(process.env.ENTRY_VELOCITY_BPS)||150)&&Math.abs(v)<=(Number(process.env.MAX_VOLATILITY_BPS)||800))return runner.onTradeSignal({mint:tick.mint,pool:tick.pool||tick.mint,direction:'BUY',sizeSol:(Number(process.env.TRADE_USD)||100)/(tick.solPriceUsd??runner.solPriceUsd),tokenReport:tick.tokenReport});
 if(p&&isTrailingStopTriggered(tick.priceUsd,next.highWaterMark,Number(process.env.TRAILING_STOP_BPS)||650))return runner.onTradeSignal({mint:tick.mint,pool:tick.pool||tick.mint,direction:'SELL',tokenQty:p.qty});
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const enginePath = fs.existsSync(path.resolve(here, '../dist/execution-engine.js'))
    ? path.resolve(here, '../dist/execution-engine.js')
    : path.resolve(here, '../terminal/dist/execution-engine.js');
  if (!fs.existsSync(enginePath)) { console.error(`[Build Error] Missing ${enginePath}. Run pnpm build first.`); process.exitCode = 1; }
  else {
  const { SimulatedEngine } = await import(pathToFileURL(enginePath).href);
  const duration = Number(process.env.DURATION_SEC) || 0;
  const runner = new ShadowRunner({ fixturePath: process.env.SESSION_FIXTURE || './data/shadow-session.jsonl', engine: new SimulatedEngine() });
  const dashboard = process.argv.includes('--dashboard') && process.stderr.isTTY ? new DashboardUI() : null;
  if (dashboard) {
    const ingest = runner.onMarketTick.bind(runner);
    runner.onMarketTick = tick => {
      const previousSlot = runner.lastSlot;
      const result = ingest(tick);
      if (runner.lastSlot > previousSlot) Object.assign(dashboard.data, { rugReport: tick.tokenReport, solPriceUsd: tick.solPriceUsd, tokenDecimals: tick.tokenDecimals });
      return result;
    };
  }
  const emit = event => { dashboard?.observe(event); process.stdout.write(`${jsonl(event)}\n`); };
  const dashboardTimer = dashboard ? setInterval(() => dashboard.render({ cash: runner.state.cash, positions: runner.state.positions, realizedPnl: runner.state.realized }), 500) : null;
  runner.appendEvent = emit;
  emit({ type: 'SESSION_START', timestamp: Date.now(), payload: { pollIntervalMs: Number(process.env.POLL_INTERVAL_MS) || 1200 } });
  runner.start();
  const pollUrl = process.env.POLL_URL;
  const pollMint = process.env.POLL_MINT || '';
  let polling=null;
  const pollOnce = async () => { if (!pollUrl) return; try { const res = await fetch(pollUrl.replace('{mint}', encodeURIComponent(pollMint)), {signal:AbortSignal.timeout(5000)}); if (!res.ok) return; const d = await res.json(); const x = d.tick || d; if (x.mint && Number.isFinite(Number(x.priceUsd)) && x.reserves?.sol != null && x.reserves?.token != null) { if(runner.onMarketTick(x)) await evaluateStrategyTick(x, runner); } } catch { /* dropped polls are neutral */ } };
  const poll = () => { if(stopping||polling)return; polling=pollOnce().finally(()=>{polling=null;}); };
  const pollTimer = pollUrl ? setInterval(poll, Number(process.env.POLL_INTERVAL_MS) || 1200) : null;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    if (pollTimer) clearInterval(pollTimer);
    await polling;
    await runner.stop();
    if (durationTimer) clearTimeout(durationTimer);
    if (dashboardTimer) clearInterval(dashboardTimer);
    if (pollTimer) clearInterval(pollTimer);
    const state = runner.state || {};
    emit({ type: 'SESSION_CHECKPOINT', timestamp: Date.now(), payload: { cashUsd: Number(state.cash ?? 0), positions: state.positions || [] } });
    dashboard?.render({ cash: state.cash, positions: state.positions, realizedPnl: state.realized });
    process.exitCode = 0;
  };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  const durationTimer = duration > 0 ? setTimeout(shutdown, duration * 1000) : null;
  }
}


