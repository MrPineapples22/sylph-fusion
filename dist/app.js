import { startDashboard } from './dashboard.js';
import { MarketHub } from './market-hub.js';
import { resolve } from 'node:path';
import { PaperPortfolio } from './paper.js';
import { validMint } from './market-hub.js';
import { strategyStatuses } from './strategy.js';
const port = Number(process.env.APP_PORT || 8788);
const enginePort = Number(process.env.ENGINE_UI_PORT || 8787);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(enginePort) || enginePort < 1024 || enginePort > 65535 || port === enginePort)
    throw new Error('Invalid app / engine ports');
const marketRpcUrl = process.env.MARKET_RPC_URL?.trim();
const marketRugcheckUrl = process.env.RUGCHECK_URL?.trim();
const marketDexUrl = process.env.DEXSCREENER_URL?.trim();
const marketKolUrl = process.env.KOLSCAN_URL?.trim();
const marketPumpUrl = process.env.PUMPPORTAL_WS_URL?.trim();
if (!marketRpcUrl || !marketRugcheckUrl || !marketDexUrl || !marketKolUrl || !marketPumpUrl)
    throw new Error('MARKET_ADAPTER_CONFIGURATION_UNAVAILABLE: all market adapter endpoints are required');
const hub = new MarketHub(resolve('data/watchlist.json'), marketRpcUrl, resolve('data/kol_wallets.txt'), marketRugcheckUrl, process.env.SOLANA_TRACKER_API_KEY || '', marketDexUrl, marketKolUrl, marketPumpUrl);
const paper = new PaperPortfolio(resolve('data/paper.json'));
let state = null, token = '', stopped = false;
const engine = `http://127.0.0.1:${enginePort}`;
const empty = () => ({ ...paper.snapshot(hub.tokens), strategies: strategyStatuses() });
async function poll() {
    while (!stopped) {
        try {
            if (!token) {
                const r = await fetch(engine, { signal: AbortSignal.timeout(1500) });
                const html = await r.text();
                token = html.match(/name="dashboard-token" content="([a-f0-9]{64})"/)?.[1] ?? '';
                if (!token)
                    throw Error();
            }
            const r = await fetch(engine + '/api/state', { headers: { 'x-dashboard-token': token }, signal: AbortSignal.timeout(1500) });
            if (!r.ok)
                throw Error();
            const next = await r.json();
            if (next.demo || !['live', 'paper'].includes(next.mode))
                throw Error();
            state = { ...next, connected: true };
        }
        catch {
            state = null;
            token = '';
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}
const server = await startDashboard({ snapshot: () => { const current = state && Date.now() - state.time < 8000 ? state : empty(); return { ...current, strategies: current.strategies ?? strategyStatuses() }; }, marketSnapshot: () => hub.snapshot(), search: q => hub.search(q), watch: (m, e) => hub.watch(m, e), risk: m => hub.risk(m), paper: async (action, mint, fraction) => {
        if (!validMint(mint))
            throw Error('Invalid Solana mint');
        const row = hub.tokens.find(t => t.mint === mint);
        if (!row)
            throw Error('Token is not in the live market cache');
        if (action === 'buy') {
            const check = await hub.risk(mint);
            if (check.safe === false)
                throw Error('Paper buy blocked by rug checks');
            return paper.buy(row, hub.tokens, check.safe === true ? 'manual-paper-cleared' : 'manual-paper-unverified');
        }
        if (action === 'test-buy')
            return paper.buy(row, hub.tokens, 'simulator-test-unsafe-override');
        return paper.sell(mint, hub.tokens, fraction ?? 10000);
    }, setPaperAuto: async (enabled) => { await paper.setAutoPaper(enabled); }, setPaused: async (paused) => {
        if (!state || !token) {
            await paper.setPaused(paused);
            return;
        }
        const r = await fetch(engine + '/api/entries', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dashboard-token': token, origin: engine }, body: JSON.stringify({ paused }), signal: AbortSignal.timeout(5000) });
        if (!r.ok)
            throw Error('Engine action failed');
        state = { ...await r.json(), connected: true };
    } }, port);
await hub.start();
void poll();
await paper.start();
setInterval(() => void paper.tick(hub.tokens, async (mint) => { const result = await hub.risk(mint); return { safe: result.safe }; }), 5000).unref();
console.log(`SYLPH live market app: ${server.url}`);
for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => { stopped = true; hub.stop(); void server.close(); });
//# sourceMappingURL=app.js.map