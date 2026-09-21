import { evaluateTokenSafety } from '../../terminal/src/filters/preflight.js';
import { buildDeepLinks } from '../../terminal/src/utils/deep-links.js';
// Public quantities are tokens/SOL; the engine consumes atomic integers.
export async function executePaperOrder({engine,tokenReport,mint,pool=mint,direction='BUY',sizeSol=1,tokenQty,tokenDecimals=9,solPriceUsd=150,maxSlippageBps=300,emergency=false,config={},dispatch}) {
 const reject=(reason,extra={})=>({type:'ORDER_REJECTED',payload:{mint,direction,reason,feeUsd:0,timestamp:Date.now(),...extra}});
 let event;
 try {
  if(!['BUY','SELL'].includes(direction)||!Number.isFinite(solPriceUsd)||solPriceUsd<=0||!Number.isInteger(tokenDecimals)||tokenDecimals<0||tokenDecimals>12)throw Error('Invalid order units');
  if(direction==='BUY'){
   const safety=evaluateTokenSafety(tokenReport,config);
   if(!safety.pass){const tags=[[/mint authority/i,'MINT_AUTHORITY_ACTIVE'],[/freeze authority/i,'FREEZE_AUTHORITY_ACTIVE'],[/lp burned/i,'INSUFFICIENT_LP_BURN'],[/concentration/i,'INSIDER_CONCENTRATION_EXCEEDED'],[/risk score/i,'RISK_SCORE_EXCEEDED']];event=reject(safety.reasons.join('; '),{score:safety.score,violations:tags.filter(([r])=>safety.reasons.some(x=>r.test(x))).map(([,tag])=>tag)});}
  }
  if(!event){
   const quantity=direction==='BUY'?sizeSol:tokenQty;
   if(!Number.isFinite(quantity)||quantity<=0)throw Error('Invalid order quantity');
   const amount=BigInt(Math.round(quantity*10**(direction==='BUY'?9:tokenDecimals)));
   const result=await engine.execute({orderId:'paper-'+Date.now(),tokenMint:mint,poolAddress:pool,side:direction,amountLamports:amount,amountDecimals:direction==='SELL'?tokenDecimals:9,maxSlippageBps,triggerTimestamp:Date.now(),emergency});
   const f=result.report,tip=BigInt(f.jitoTipLamports??0),priority=BigInt(f.priorityFeeLamports??0),feeUsd=Number(tip+priority)/1e9*solPriceUsd;
   if(f.status!=='FILLED')event=reject(f.failureReason||'EXECUTION_REJECTED',{feeUsd,solPriceUsd,overhead:{tipLamports:tip,priorityFeeLamports:priority}});
   else {
    const qty=Number(direction==='BUY'?f.outputAmount:f.inputAmount)/10**tokenDecimals;
    const usdCost=Number(direction==='BUY'?f.inputAmount:f.outputAmount)/1e9*solPriceUsd;
    if(!Number.isFinite(qty)||qty<=0||!Number.isFinite(usdCost)||usdCost<=0)throw Error('Invalid confirmed fill');
    event={type:'ORDER_FILLED',payload:{orderId:f.orderId,mint,symbol:mint.slice(0,6),direction,tokenDecimals,tokensReceived:qty,fillPriceUsd:usdCost/qty,usdCost,feeUsd,solPriceUsd,overhead:{tipLamports:tip,tipSol:Number(tip)/1e9,priorityFeeLamports:priority,slippageBps:result.telemetry?.priceImpactPct!=null?result.telemetry.priceImpactPct*100:f.effectiveSlippageBps??0},telemetry:result.telemetry,links:buildDeepLinks({mint,pool,signature:f.simulatedSignature}),timestamp:Date.now()}};
   }
  }
 }catch(error){event=reject(error.message);}
 dispatch?.(event);return event;
}
