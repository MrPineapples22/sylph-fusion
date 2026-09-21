#!/usr/bin/env node
import http from 'node:http';
import {fileURLToPath} from 'node:url';

const PORT = Number(process.env.BRIDGE_PORT) || 8080;
const reports = new Map();
let slot = 0;

async function fetchRugcheck(mint) {
  const cached=reports.get(mint);if(cached && Date.now()-cached.at<60000)return cached.report;
  try { const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { headers: { Accept: 'application/json' },signal:AbortSignal.timeout(8000) }); if (!r.ok) return null; const report = await r.json(); reports.set(mint, {report,at:Date.now()}); return report; } catch { return null; }
}

export async function fetchMarketTick(mint) {
  const [dex, tokenReport] = await Promise.all([fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`,{signal:AbortSignal.timeout(8000)}).then(r => r.ok ? r.json() : null).catch(() => null), fetchRugcheck(mint)]);
  const pair = dex?.pairs?.filter(p => p.chainId === 'solana' && p.baseToken?.address === mint && p.quoteToken?.address === 'So11111111111111111111111111111111111111112').sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0))[0];
  const priceUsd = Number(pair?.priceUsd); const liquidityUsd = Number(pair?.liquidity?.usd);
  if (!pair || !Number.isFinite(priceUsd) || priceUsd <= 0 || !Number.isFinite(liquidityUsd) || liquidityUsd <= 0) return null;
  const solPriceUsd = Number(pair.priceNative) > 0 ? priceUsd / Number(pair.priceNative) : NaN;
  if(!Number.isFinite(solPriceUsd)||solPriceUsd<=0)return null;
  const sol = BigInt(Math.max(1, Math.round((liquidityUsd / 2 / solPriceUsd) * 1e9)));
  const token = BigInt(Math.max(1, Math.round((liquidityUsd / 2 / priceUsd) * 1e9)));
  return { mint, priceUsd, solPriceUsd, reserveSource: 'estimated-from-liquidity', tokenDecimals: 9, sequenceSource: 'local-poll-counter', reserves: { sol: sol.toString(), token: token.toString() }, slot: ++slot, timestamp: Date.now(), tokenReport };
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'live-market-bridge' }));
  }
  const match = /^\/pools\/([1-9A-HJ-NP-Za-km-z]+)$/.exec(req.url || '');
  if (!match) { res.writeHead(404); return res.end(); }
  const tick = await fetchMarketTick(match[1]);
  if (!tick) { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Failed to aggregate market tick' })); }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(tick));
});

if(process.argv[1]===fileURLToPath(import.meta.url))server.listen(PORT, '127.0.0.1', () => console.log(`Server listening on http://127.0.0.1:${PORT} (health: /health, pools: /pools/{mint})`));
