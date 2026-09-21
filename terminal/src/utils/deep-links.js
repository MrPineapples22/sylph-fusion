const BASE58=/^[1-9A-HJ-NP-Za-km-z]{16,64}$/;
function target(value,name='target'){if(typeof value!=='string'||!BASE58.test(value))throw new Error(`Invalid ${name}`);return encodeURIComponent(value)}
export const deepLinks={
 dexScreener:(mint)=>`https://dexscreener.com/solana/${target(mint,'mint')}`,
 birdeye:(mint)=>`https://birdeye.so/token/${target(mint,'mint')}`,
 rugcheck:(mint)=>`https://rugcheck.xyz/tokens/${target(mint,'mint')}`,
 solscanToken:(mint)=>`https://solscan.io/token/${target(mint,'mint')}`,
 solscanTx:(signature)=>`https://solscan.io/tx/${target(signature,'signature')}`,
 jupiter:(mint)=>`https://jup.ag/swap/SOL-${target(mint,'mint')}`,
 pump:(mint)=>`https://pump.fun/coin/${target(mint,'mint')}`,
 bubblemaps:(mint)=>`https://app.bubblemaps.io/sol/token/${target(mint,'mint')}`
};

export function buildDeepLinks({mint,signature}={}){const links={}; if(mint){links.rugcheck=deepLinks.rugcheck(mint);links.birdeye="https://birdeye.so/token/"+target(mint,"mint")+"?chain=solana";links.jupiter=deepLinks.jupiter(mint);links.pumpfun="https://pump.fun/"+target(mint,"mint");links.bubblemaps=deepLinks.bubblemaps(mint);links.solscanToken=deepLinks.solscanToken(mint);} if(signature)links.solscanTx=deepLinks.solscanTx(signature); return links;}


