/**
 * Credential-free execution boundary for paper/live parity. No signing or write RPC exists here.
 * NOTE: SimulatedEngine uses an approximate constant-product pool (25 bps fee retained in pool)
 * calibrated for generic telemetry/shadowing, rather than Pump.fun's exact dynamic fee schedule
 * and on-chain protocol fee diversion (handled authoritatively by @pump-fun/pump-sdk in Market).
 *
 * Implements the formal 6-stage lifecycle:
 * IDLE -> VALIDATING -> QUOTING -> SIGNING -> SUBMITTING -> SETTLED
 */
import { globalProviderHealthTracker } from './platform/ingestion/provider-health.js';

export type OrderSide = 'BUY'|'SELL';
export interface PoolState { timestamp:number; slot:number; reserves:{sol:bigint;token:bigint}; price:number; volatility:number; migrated?:boolean; }
export interface OptimisticOverlay { poolAddress:string; reserves:{sol:bigint;token:bigint}; appliedAtTimestamp:number; appliedAtSlot:number; }
export interface DriftTelemetry { poolAddress:string; reconciledAtSlot:number; deltaSolLamports:bigint; deltaTokenUnits:bigint; priceDriftPct:number; adverseSelectionDetected:boolean; }
export type DriftCallback=(drift:DriftTelemetry)=>void;

export type ExecutionLifecycleStage =
  | 'IDLE'
  | 'VALIDATING'
  | 'QUOTING'
  | 'SIGNING'
  | 'SUBMITTING'
  | 'SETTLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'FAILED';

export interface StageTransitionRecord {
  stage: ExecutionLifecycleStage;
  timestampMs: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export class AdverseSelectionTracker { private score=0; constructor(private readonly alpha=.35){} registerDrift(d:DriftTelemetry){const penalty=d.priceDriftPct<0?Math.min(100,Math.abs(d.priceDriftPct)*25):0;this.score=this.alpha*penalty+(1-this.alpha)*this.score;return Math.round(this.score);} getScore(){return Math.round(this.score);} reset(){this.score=0;} }
export interface OrderRequest { orderId:string; tokenMint:string; poolAddress:string; side:OrderSide; amountLamports:bigint; /** BUY: SOL lamports; SELL: raw token base units. */ amountDecimals?:number; maxSlippageBps:number; triggerTimestamp:number; emergency?:boolean; fallbackPriceSol?:number; }
export interface FillReport {
  orderId:string;
  status:'FILLED'|'REJECTED'|'EXPIRED';
  execPrice:number;
  inputAmount:bigint;
  outputAmount:bigint;
  priorityFeeLamports:bigint;
  jitoTipLamports:bigint;
  slotLatency:number;
  failureReason?:'SLIPPAGE_EXCEEDED'|'AUCTION_LOST'|'STALE_STATE'|'PRE_TRADE_RISK_REJECTED'|'CIRCUIT_BREAKER_HALTED';
  lifecycleHistory?: StageTransitionRecord[];
  currentStage?: ExecutionLifecycleStage;
}
export interface Telemetry { engineMode:'PAPER'|'LIVE_JITO_QUIC'; simulatedSlotLagMs:number; priceImpactPct:number; preTradeReserves:{sol:bigint;token:bigint}; postTradeReserves:{sol:bigint;token:bigint}; }
export interface ExecutionEngine {
  execute(order:OrderRequest):Promise<{report:FillReport;telemetry:Telemetry}>;
  getLifecycleHistory?(orderId:string):StageTransitionRecord[];
}
export type EngineMode='PAPER'|'LIVE';
export interface EngineConfig { mode:EngineMode; paper?:{seed?:number;tipFloorLamports?:bigint;tipCeilingLamports?:bigint}; live?:{grpcEndpoint:string;jitoBlockEngineUrl:string;rpcUrl:string;privateKeyBase58:string}; }
const BPS=10_000n, FEE_BPS=25n, SLOT_MS=400;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
/** Expands tranche tolerance with cumulative depth usage, bounded by a hard cap. */
export function computeTrancheSlippageBps(trancheIndex:number,cumulativeTokenAmount:bigint,poolTokenReserve:bigint,baseSlippageBps=150,maxSlippageBps=1500){if(poolTokenReserve<=0n||cumulativeTokenAmount<=0n)return baseSlippageBps;const depthRatioBps=Number((cumulativeTokenAmount*10_000n)/poolTokenReserve);return Math.min(maxSlippageBps,baseSlippageBps+Math.round(depthRatioBps*1.35));}
function quote(state:PoolState,side:OrderSide,input:bigint){const x=state.reserves.sol,y=state.reserves.token;if(x<=0n||y<=0n||input<=0n)throw Error('invalid reserves');const fee=input*FEE_BPS/BPS,eff=input-fee;if(side==='BUY'){const out=y*eff/(x+eff);return {out,post:{sol:x+input,token:y-out},spot:Number(x)/Number(y),realized:Number(input)/Number(out)};}const out=x*eff/(y+eff);return {out,post:{sol:x-out,token:y+input},spot:Number(x)/Number(y),realized:Number(out)/Number(input)};}

export class SimulatedEngine implements ExecutionEngine {
 private readonly statesByPool=new Map<string,PoolState[]>();
 private readonly overlays=new Map<string,OptimisticOverlay>();
 private readonly random:()=>number;
 private readonly pending=new Map<string,AbortController>();
 private onDriftCallback?:DriftCallback;
 readonly adverseSelection=new AdverseSelectionTracker();
 private readonly lifecycleAudits = new Map<string, StageTransitionRecord[]>();

 constructor(seed=7,private readonly tipFloor=100_000n,private readonly tipCeiling=10_000_000n){
  let s=seed>>>0;
  this.random=()=>{s=(1664525*s+1013904223)>>>0;return s/0x1_0000_0000;};
 }

 setDriftListener(callback:DriftCallback){this.onDriftCallback=callback;}

 private recordStage(orderId: string, stage: ExecutionLifecycleStage, reason?: string, metadata?: Record<string, unknown>): StageTransitionRecord[] {
  let records = this.lifecycleAudits.get(orderId);
  if (!records) {
    records = [];
    this.lifecycleAudits.set(orderId, records);
    if (this.lifecycleAudits.size > 200) {
      this.lifecycleAudits.delete(this.lifecycleAudits.keys().next().value!);
    }
  }
  records.push({
    stage,
    timestampMs: Date.now(),
    reason,
    metadata,
  });
  return records;
 }

 public enforceLiveFeedFreshness = false;

 public setEnforceLiveFeedFreshness(enforce: boolean): void {
  this.enforceLiveFeedFreshness = enforce;
 }

 public getLifecycleHistory(orderId: string): StageTransitionRecord[] {
  return this.lifecycleAudits.get(orderId) || [];
 }

 public getRecentLifecycleAudits(limit = 50): Array<{ orderId: string; history: StageTransitionRecord[] }> {
  return [...this.lifecycleAudits.entries()].slice(-limit).map(([orderId, history]) => ({ orderId, history }));
 }

 pushState(state:PoolState,poolAddress=''){if(!Number.isFinite(state.timestamp)||!Number.isFinite(state.slot)||state.reserves.sol<=0n||state.reserves.token<=0n)return;const existing=this.statesByPool.get(poolAddress);if(existing?.length&&state.timestamp<=existing[existing.length-1].timestamp)return;const overlay=this.overlays.get(poolAddress);if(overlay&&(state.migrated||state.slot>=overlay.appliedAtSlot)){const a=Number(overlay.reserves.sol)/Number(overlay.reserves.token),b=Number(state.reserves.sol)/Number(state.reserves.token),priceDriftPct=a>0?((b-a)/a)*100:0;this.onDriftCallback?.({poolAddress,reconciledAtSlot:state.slot,deltaSolLamports:state.reserves.sol-overlay.reserves.sol,deltaTokenUnits:state.reserves.token-overlay.reserves.token,priceDriftPct,adverseSelectionDetected:priceDriftPct<-.75});this.overlays.delete(poolAddress);}const states=this.statesByPool.get(poolAddress)||[];if(states.length&&state.timestamp<=states[states.length-1].timestamp)return;states.push(state);if(states.length>300)states.shift();this.statesByPool.set(poolAddress,states);}
 exportState(){return {adverseSelectionScore:this.adverseSelection.getScore(),overlays:[...this.overlays.values()].map(o=>({poolAddress:o.poolAddress,reserves:{sol:o.reserves.sol.toString(),token:o.reserves.token.toString()},appliedAtTimestamp:o.appliedAtTimestamp,appliedAtSlot:o.appliedAtSlot}))};}
 hydrateState(state: ReturnType<SimulatedEngine['exportState']>){if(!state||!Array.isArray(state.overlays))return;this.overlays.clear();for(const o of state.overlays){try{if(o?.poolAddress&&o.reserves?.sol&&o.reserves?.token)this.overlays.set(o.poolAddress,{...o,reserves:{sol:BigInt(o.reserves.sol),token:BigInt(o.reserves.token)}});}catch{}}}
 clearOverlay(poolAddress?:string){if(poolAddress)this.overlays.delete(poolAddress);else this.overlays.clear();}
 getOverlay(poolAddress:string){return this.overlays.get(poolAddress);}
 hasActiveOverlay(poolAddress:string){return this.overlays.has(poolAddress); }

 async execute(order:OrderRequest):Promise<{report:FillReport;telemetry:Telemetry}>{
  // Stage 1: IDLE -> Initial entry
  this.recordStage(order.orderId, 'IDLE', 'Order received');

  // Stage 2: VALIDATING -> Strict Pre-trade Risk Authorization
  this.recordStage(order.orderId, 'VALIDATING', 'Pre-trade risk & invariant check');
  if (order.amountLamports <= 0n) {
    return this.reject(order, 'PRE_TRADE_RISK_REJECTED', 0, 0, 0n, 'Invalid order amount (zero or negative)');
  }

  // Pre-trade feed freshness authorization: if feed is stale, fail closed on new entries
  if (this.enforceLiveFeedFreshness && order.side === 'BUY' && !order.emergency && globalProviderHealthTracker.isMarketFeedStale()) {
    return this.reject(order, 'STALE_STATE', 0, 0, 0n, 'Market feed stale: buy order rejected for safety');
  }

  const delay=400+Math.floor(this.random()*401);
  const target=order.triggerTimestamp+delay;
  const controller=new AbortController();
  this.pending.set(order.orderId,controller);

  try {
   await this.sleep(delay,controller.signal);
   const frames=this.statesByPool.get(order.poolAddress)||this.statesByPool.get('')||[];
   const state=frames.find(x=>x.timestamp>=target)||frames[frames.length-1];

   if(order.side==='SELL'||order.emergency){
    this.recordStage(order.orderId, 'QUOTING', 'Emergency or sell exit quote');
    this.overlays.delete(order.poolAddress);
    const overlay=this.overlays.get(order.poolAddress);
    const preTradeReserves=overlay?overlay.reserves:(state?state.reserves:{sol:100_000_000_000n,token:1_000_000_000_000_000n});
    let realized=0,outSol=0n,postReserves={sol:preTradeReserves.sol,token:preTradeReserves.token},impact=0;
    if(state&&preTradeReserves.sol>0n&&preTradeReserves.token>0n&&order.amountLamports>0n){
     try{
      const q=quote({...state,reserves:preTradeReserves},'SELL',order.amountLamports);
      realized=q.realized;outSol=q.out;postReserves=q.post;const ratio=q.realized/q.spot;impact=Math.max(0,(1-ratio)*100);
     }catch{}
    }
    if(outSol<=0n||realized<=0){
     const fallbackPriceSol=(order.fallbackPriceSol&&order.fallbackPriceSol>0)?order.fallbackPriceSol:(state?.price||0.0000001);
     const decimals=order.amountDecimals??9;
     const tokenUnits=Number(order.amountLamports)/10**decimals;
     outSol=BigInt(Math.max(1,Math.round(tokenUnits*fallbackPriceSol*1e9)));
     realized=fallbackPriceSol;
     impact=0;
    }
    const lag=state?Math.max(delay,state.timestamp-order.triggerTimestamp):delay;

    // Stage 3 & 4: SIGNING -> SUBMITTING
    this.recordStage(order.orderId, 'SIGNING', 'Packing and signing exit transaction');
    this.recordStage(order.orderId, 'SUBMITTING', 'Submitting exit bundle');

    // Stage 5: SETTLED
    const history = this.recordStage(order.orderId, 'SETTLED', 'Exit filled and settled');
    const report:FillReport={
      orderId:order.orderId,
      status:'FILLED',
      execPrice:realized,
      inputAmount:order.amountLamports,
      outputAmount:outSol,
      priorityFeeLamports:50_000n,
      jitoTipLamports:100_000n,
      slotLatency:Math.max(1,Math.round(lag/SLOT_MS)),
      lifecycleHistory: history,
      currentStage: 'SETTLED',
    };
    return {report,telemetry:{engineMode:'PAPER' as const,simulatedSlotLagMs:lag,priceImpactPct:impact,preTradeReserves,postTradeReserves:postReserves}};
   }

   if(!state) {
     return this.reject(order,'STALE_STATE',Math.max(delay,Date.now()-order.triggerTimestamp),0n,0n);
   }

   const lag=Math.max(delay,state.timestamp-order.triggerTimestamp);
   if(Date.now()-state.timestamp>15000||lag>60_000||state.migrated) {
     return this.reject(order,'STALE_STATE',lag,state.slot,0n);
   }

   // Stage 3: QUOTING -> Price impact and slippage bounds check
   this.recordStage(order.orderId, 'QUOTING', 'Calculating executable SDK curve quote');
   const overlay=this.overlays.get(order.poolAddress);
   const preTradeReserves=overlay?overlay.reserves:state.reserves;
   const q=quote({...state,reserves:preTradeReserves},order.side,order.amountLamports);
   const ratio=q.realized/q.spot;
   const impact=order.side==='BUY'?Math.max(0,(ratio-1)*100):Math.max(0,(1-ratio)*100);
   const tip=BigInt(Math.round(clamp(Number(order.amountLamports)*.02*(1+state.volatility),Number(this.tipFloor),Number(this.tipCeiling))));
   const priority=50_000n;
   const allowedSlippage=Math.max(order.maxSlippageBps,order.emergency?5000:order.maxSlippageBps);

   if(impact*100>allowedSlippage) {
     return this.reject(order,'SLIPPAGE_EXCEEDED',lag,state.slot,tip);
   }

   // Stage 4: SIGNING -> Assemble and simulate signed bundle
   this.recordStage(order.orderId, 'SIGNING', 'Building and signing transaction with tip instruction');

   // Stage 5: SUBMITTING -> Send bundle via Jito / RPC
   this.recordStage(order.orderId, 'SUBMITTING', 'Transmitting bundle with auction priority');
   const drop=Math.min(.35,Math.max(0,state.volatility*.08));
   if(this.random()<drop) {
     return this.reject(order,'AUCTION_LOST',lag,state.slot,tip);
   }

   this.overlays.set(order.poolAddress,{poolAddress:order.poolAddress,reserves:q.post,appliedAtTimestamp:target,appliedAtSlot:state.slot+Math.round(lag/SLOT_MS)});

   // Stage 6: SETTLED
   const history = this.recordStage(order.orderId, 'SETTLED', 'Confirmed fill settled on chain');
   const report:FillReport={
     orderId:order.orderId,
     status:'FILLED',
     execPrice:q.realized,
     inputAmount:order.amountLamports,
     outputAmount:q.out,
     priorityFeeLamports:priority,
     jitoTipLamports:tip,
     slotLatency:Math.round(lag/SLOT_MS),
     lifecycleHistory: history,
     currentStage: 'SETTLED',
   };
   return {report,telemetry:{engineMode:'PAPER' as const,simulatedSlotLagMs:lag,priceImpactPct:impact,preTradeReserves,postTradeReserves:q.post}};
  } catch {
   this.adverseSelection.registerDrift({poolAddress:order.poolAddress,reconciledAtSlot:0,deltaSolLamports:0n,deltaTokenUnits:0n,priceDriftPct:-4,adverseSelectionDetected:true});
   if(order.side==='SELL'||order.emergency){
    this.overlays.delete(order.poolAddress);
    const fallbackPriceSol=order.fallbackPriceSol||0.0000001;
    const decimals=order.amountDecimals??9;
    const tokenUnits=Number(order.amountLamports)/10**decimals;
    const outSol=BigInt(Math.max(1,Math.round(tokenUnits*fallbackPriceSol*1e9)));
    const history = this.recordStage(order.orderId, 'SETTLED', 'Fallback sell executed');
    return {report:{orderId:order.orderId,status:'FILLED',execPrice:fallbackPriceSol,inputAmount:order.amountLamports,outputAmount:outSol,priorityFeeLamports:50_000n,jitoTipLamports:0n,slotLatency:1,lifecycleHistory:history,currentStage:'SETTLED'},telemetry:{engineMode:'PAPER' as const,simulatedSlotLagMs:0,priceImpactPct:0,preTradeReserves:{sol:0n,token:0n},postTradeReserves:{sol:0n,token:0n}}};
   }
   this.recordStage(order.orderId, 'FAILED', 'Execution timeout or cancelled');
   return this.reject(order,'STALE_STATE',Date.now()-order.triggerTimestamp,0n,0n);
  } finally {
   this.pending.delete(order.orderId);
  }
 }

 cancel(orderId:string){
  this.recordStage(orderId, 'REJECTED', 'Order explicitly cancelled by operator');
  this.pending.get(orderId)?.abort();
 }
 cancelAllBuys(){for(const id of this.pending.keys())this.pending.get(id)?.abort();this.clearOverlay();}
 panicClose(poolAddress:string){this.clearOverlay(poolAddress);}

 private sleep(ms:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,Math.min(ms,3000));const stop=()=>{clearTimeout(timer);reject(new Error('STALE_STATE'));};if(signal.aborted)stop();else signal.addEventListener('abort',stop,{once:true});});}

 private reject(order:OrderRequest,reason:'SLIPPAGE_EXCEEDED'|'AUCTION_LOST'|'STALE_STATE'|'PRE_TRADE_RISK_REJECTED'|'CIRCUIT_BREAKER_HALTED',lag:number,slot:bigint|number,tip:bigint,stageDetail?:string){
  const history = this.recordStage(order.orderId, reason==='STALE_STATE'?'EXPIRED':'REJECTED', stageDetail || reason);
  const report:FillReport={
    orderId:order.orderId,
    status:reason==='STALE_STATE'?'EXPIRED':'REJECTED',
    execPrice:0,
    inputAmount:order.amountLamports,
    outputAmount:0n,
    priorityFeeLamports:reason==='SLIPPAGE_EXCEEDED'?50_000n:0n,
    jitoTipLamports:0n,
    slotLatency:Math.round(lag/SLOT_MS),
    failureReason:reason,
    lifecycleHistory: history,
    currentStage: reason === 'STALE_STATE' ? 'EXPIRED' : 'REJECTED',
  };
  return {report,telemetry:{engineMode:'PAPER' as const,simulatedSlotLagMs:lag,priceImpactPct:0,preTradeReserves:{sol:0n,token:0n},postTradeReserves:{sol:0n,token:0n}}};
 }
}

export class EngineFactory {
 static create(config:EngineConfig,onDrift?:DriftCallback):ExecutionEngine {
  if(config.mode==='PAPER'){const p=config.paper??{};const engine=new SimulatedEngine(p.seed??7,p.tipFloorLamports??100_000n,p.tipCeilingLamports??10_000_000n);if(onDrift)engine.setDriftListener(onDrift);return engine;}
  if(config.mode==='LIVE')throw new Error('Live execution transport is intentionally unavailable in this credential-free build.');
  throw new Error(`Unsupported engine mode: ${String(config.mode)}`);
 }
}

