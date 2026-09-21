// Public discovery does not establish complete exchange coverage. Never certify it.
export function rankObservedPairs(rows,at=Date.now()){
 const unique=new Map();
 for(const p of rows){
  if(!p||typeof p!=='object')continue;
  if(p.chainId!=='solana'||!['raydium','meteora','orca','pumpfun','pumpswap'].includes(p.dexId)||!p.pairAddress)continue;
  const volume=p.volume?.h1,price=Number(p.priceUsd),liquidity=p.liquidity?.usd;
  if(!Number.isFinite(volume)||volume<0||!Number.isFinite(price)||price<=0)continue;
  const buys=p.txns?.m5?.buys,sells=p.txns?.m5?.sells;
  unique.set(p.pairAddress,{pair:p.pairAddress,mint:p.baseToken?.address,symbol:p.baseToken?.symbol||'?',dex:p.dexId,price,volume1h:volume,volume5m:Number.isFinite(p.volume?.m5)?p.volume.m5:null,change5m:Number.isFinite(p.priceChange?.m5)?p.priceChange.m5:null,liquidity:Number.isFinite(liquidity)&&liquidity>=0?liquidity:null,volumeLiquidity:Number.isFinite(liquidity)&&liquidity>0&&Number.isFinite(p.volume?.m5)?p.volume.m5/liquidity:null,countImbalance:Number.isFinite(buys)&&Number.isFinite(sells)&&buys+sells>0?(buys-sells)/(buys+sells):null,ofi:null,at});
 }
 return [...unique.values()].sort((a,b)=>b.volume1h-a.volume1h||a.pair.localeCompare(b.pair)).slice(0,10).map((p,i)=>({...p,rank:i+1}));
}
export function createAstraFeed(readLive){
 let cache=null,pending=null;
 return async()=>{
  if(cache&&Date.now()-cache.at<2000)return cache;
  if(pending)return pending;
  pending=(async()=>{
   const market=await readLive('/api/market');
   const mints=[...new Set([...(market.tokens||[]),...(market.launches||[])].map(t=>t.mint))].filter(m=>typeof m==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)).slice(0,30);
   if(!mints.length)throw Error('No discovery candidates');
   const response=await fetch('https://api.dexscreener.com/tokens/v1/solana/'+mints.join(','),{signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw Error('Volume source unavailable');const rows=await response.json();if(!Array.isArray(rows))throw Error('Invalid volume response');
   const at=Date.now();cache={at,refreshAt:at+2000,coverage:'observed-pools-only',verified:false,entryAllowed:false,reason:'Global top-ten coverage, contract checks, volume OFI and social confirmation are not verified.',pairs:rankObservedPairs(rows,at),signals:{pumpPortal:'Existing launch stream',moonshot:'Not connected',raydiumNewPools:'Not connected',kolscan:'Public snapshot only',twitter:'Not connected',telegram:'Not connected',mintAuthority:'Unknown',freezeAuthority:'Unknown',lpLock:'Unknown',tokenTax:'Unknown'}};
   return cache;
  })();try{return await pending;}finally{pending=null;}
 };
}
