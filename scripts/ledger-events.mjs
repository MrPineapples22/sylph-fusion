// Shared translation; no polling, random ticks, or wall-clock reads during replay.
export function applyLedgerEvent(state,event,reducer){
 const p=event.payload||{};
 if(event.type==='TICK'){
  const id=event.asset||p.mint,price=event.price??p.priceUsd,now=event.timestamp??p.timestamp;
  if(!id||!Number.isFinite(price)||price<=0||!Number.isFinite(now))throw Error('Invalid market tick');
  const old=state.assets.find(a=>a.id===id);
  const asset={...old,id,price,history:[...(old?.history||[]),{time:now/1000,value:price}].slice(-120)};
  return {...state,now,assets:old?state.assets.map(a=>a.id===id?asset:a):[...state.assets,asset],positions:state.positions.map(p=>p.asset===id?{...p,high:Math.max(p.high,price)}:p)};
 }
 if(event.type==='ORDER_FILLED')return reducer(state,{type:'EXTERNAL_FILL',now:p.timestamp,payload:{asset:p.mint,side:p.direction,price:p.fillPriceUsd,qty:p.tokensReceived,totalUsd:p.usdCost,feeUsd:p.feeUsd??0,orderId:p.orderId,priceImpactPct:(p.overhead?.slippageBps??0)/100}});
 if(event.type==='ORDER_REJECTED'&&p.feeUsd)return reducer(state,{type:'REJECT',now:p.timestamp,payload:{asset:p.mint,side:p.direction,reason:p.reason,feeUsd:p.feeUsd}});
 return state;
}
