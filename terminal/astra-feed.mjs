// Public discovery does not establish complete exchange coverage. Never certify it.
export function rankObservedPairs(rows,at=Date.now()){
 const unique=new Map();
 for(const p of rows){
  if(!p||typeof p!=='object')continue;
  if(p.chainId!=='solana'||!['raydium','meteora','orca','pumpfun','pumpswap'].includes(p.dexId)||!p.pairAddress)continue;
  const volume=p.volume?.h1,price=Number(p.priceUsd),liquidity=p.liquidity?.usd;
  if(!Number.isFinite(volume)||volume<0||!Number.isFinite(price)||price<=0)continue;
  const buys=p.txns?.m5?.buys,sells=p.txns?.m5?.sells;
  unique.set(p.pairAddress,{pair:p.pairAddress,mint:p.baseToken?.address,symbol:p.baseToken?.symbol||'?',dex:p.dexId,price,volume1h:volume,volume5m:Number.isFinite(p.volume?.m5)?p.volume.m5:null,change5m:Number.isFinite(p.priceChange?.m5)?p.priceChange.m5:null,liquidity:Number.isFinite(liquidity)&&liquidity>=0?liquidity:null,volumeLiquidity:Number.isFinite(liquidity)&&liquidity>0&&Number.isFinite(p.volume?.m5)?p.volume.m5/liquidity:null,countImbalance:Number.isFinite(buys)&&Number.isFinite(sells)&&buys+sells>0?(buys-sells)/(buys+sells):null,ofi:null,source:'DEXSCREENER_HTTP',at});
 }
  return [...unique.values()].sort((a,b)=>b.volume1h-a.volume1h||a.pair.localeCompare(b.pair)).slice(0,50).map((p,i)=>({...p,rank:i+1}));
}
export function createAstraFeed(readLive){
 let cache=null,pending=null;
 return async()=>{
  if(cache&&Date.now()-cache.at<2000)return cache;
  if(pending)return pending;
  pending=(async()=>{
   const market=await readLive('/api/market');
   const mints=[...new Set([...(market.tokens||[]),...(market.launches||[])].map(t=>t.mint))].filter(m=>typeof m==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0,50);
   if(!mints.length)throw Error('No discovery candidates');
   let rows=[],providerResponseOk=false,providerError='';
   try {
     const response=await fetch('https://api.dexscreener.com/tokens/v1/solana/'+mints.join(','),{signal:AbortSignal.timeout(15000)});
     if(response.ok) {
       const body=await response.json();
       if(Array.isArray(body)){rows=body;providerResponseOk=true;}else providerError='INVALID_PROVIDER_RESPONSE';
     } else providerError=`PROVIDER_HTTP_${response.status}`;
   } catch (error) {
     providerError=error?.name==='TimeoutError'?'PROVIDER_TIMEOUT':'PROVIDER_UNAVAILABLE';
   }
   const at=Date.now();
   const pairs=rankObservedPairs(rows,at);
   const verified=providerResponseOk&&pairs.length>0&&pairs.every(p=>Number.isFinite(p.liquidity)&&p.liquidity>0);
   cache={at,refreshAt:at+2000,coverage:'observed-pools-only',verified,entryAllowed:false,reason:verified?'Fresh DexScreener observations are available; discovery data alone does not authorize entries.':`${providerError||'NO_QUALIFYING_LIVE_POOLS'}; market coverage, execution quotes, and required risk signals are not verified.`,pairs,signals:{pumpPortal:'Separate launch stream; not used as DexScreener fallback',dexScreener:providerResponseOk?'Live response received':'Unavailable',moonshot:'Not connected',raydiumNewPools:'Observed only when present in provider response',kolscan:'Public snapshot only',twitter:'Not connected',telegram:'Not connected',mintAuthority:'Unknown',freezeAuthority:'Unknown',lpLock:'Unknown',tokenTax:'Unknown'}};
   return cache;
  })();try{return await pending;}finally{pending=null;}
 };
}
