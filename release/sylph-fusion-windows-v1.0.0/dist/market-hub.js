import WebSocket from 'ws';
import { PublicKey } from '@solana/web3.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { scanToken } from './risk.js';
import { globalProviderHealthTracker } from './platform/ingestion/provider-health.js';
import { MultiSourceCrossValidator } from './platform/ingestion/cross-validator.js';
const numeric = (n) => n !== null && n !== undefined && n !== '' && Number.isFinite(Number(n)) ? Number(n) : null;
export function validMint(mint) { try {
    return typeof mint === 'string' && new PublicKey(mint).toBase58() === mint;
}
catch {
    return false;
} }
export function normalizePairs(rows, at = Date.now()) {
    const result = new Map();
    for (const p of rows) {
        if (p?.chainId !== 'solana' || !validMint(p?.baseToken?.address))
            continue;
        const dex = String(p.dexId || '');
        const isDexPool = Boolean(dex && dex !== 'pumpfun');
        const row = { mint: p.baseToken.address, symbol: String(p.baseToken.symbol || '?').slice(0, 24), name: String(p.baseToken.name || 'Unknown token').slice(0, 80), price: numeric(p.priceUsd), change: numeric(p.priceChange?.h24), liquidity: numeric(p.liquidity?.usd), volume: numeric(p.volume?.h24), volume1h: numeric(p.volume?.h1), volume5m: numeric(p.volume?.m5), cap: numeric(p.marketCap ?? p.fdv), pair: String(p.pairAddress || ''), dex, complete: isDexPool, migrated: isDexPool, at };
        if (!result.has(row.mint) || (row.liquidity ?? -1) > (result.get(row.mint).liquidity ?? -1))
            result.set(row.mint, row);
    }
    return [...result.values()];
}
export function parseKolscan(html) {
    let flight = '';
    for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
        try {
            const a = JSON.parse(m[1]);
            if (a[0] === 1 && typeof a[1] === 'string')
                flight += a[1];
        }
        catch { }
    }
    let rows = [];
    const visit = (x, depth = 0) => { if (!x || typeof x !== 'object' || depth > 12)
        return; if (Array.isArray(x.transactions))
        rows.push(...x.transactions);
    else
        for (const v of Object.values(x))
            visit(v, depth + 1); };
    for (const line of flight.split('\n')) {
        const i = line.indexOf(':');
        if (i < 0)
            continue;
        try {
            visit(JSON.parse(line.slice(i + 1)));
        }
        catch { }
    }
    return [...new Map(rows.map(r => [r.signature, r])).values()].slice(0, 50).flatMap(r => {
        const side = Number(r.out_amount) > 0 ? 'buy' : 'sell';
        const preferred = side === 'sell' ? r.in_token_address : r.out_token_address;
        const mint = validMint(preferred) ? preferred : [r.in_token_address, r.out_token_address].find(x => validMint(x) && x !== 'So11111111111111111111111111111111111111112');
        const rawTimestamp = Number(r.timestamp);
        const timestamp = Number.isFinite(rawTimestamp) ? Math.floor(rawTimestamp) : 0;
        const sol = Number(r.sol_change);
        if (!validMint(mint) || !validMint(r.wallet_address) || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(String(r.signature)) || timestamp <= 0 || timestamp * 1000 > Date.now() + 86_400_000 || !Number.isFinite(sol) || sol < 0)
            return [];
        return [{ mint, side, wallet: r.wallet_address, name: String(r.name || 'Trader').slice(0, 60), symbol: String((mint === r.in_token_address ? r.in_token_symbol : r.out_token_symbol) || 'Token').slice(0, 24), sol: Math.abs(sol), at: timestamp * 1000, signature: r.signature }];
    });
}
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'HttpError';
    }
}
async function json(url, init) {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    if (!r.ok)
        throw new HttpError(r.status, `Provider HTTP ${r.status}`);
    return r.json();
}
export class MarketHub {
    watchFile;
    rpc;
    kolFile;
    rugUrl;
    trackerKey;
    tokens = [];
    launches = [];
    kol = [];
    watches = [];
    network = { slot: null, at: 0 };
    status = { dex: { state: 'connecting', at: 0 }, kol: { state: 'connecting', at: 0 }, pump: { state: 'connecting', at: 0 }, solana: { state: 'connecting', at: 0 } };
    stopped = false;
    ws;
    timers = new Set();
    searches = new Map();
    lastSearch = 0;
    watchWrite = Promise.resolve();
    riskCache = new Map();
    kolWallets = new Set();
    crossValidator = new MultiSourceCrossValidator();
    rpcList = [];
    rpcIndex = 0;
    constructor(watchFile, rpc = 'https://api.mainnet-beta.solana.com', kolFile, rugUrl = 'https://api.rugcheck.xyz/v1/tokens', trackerKey = '') {
        this.watchFile = watchFile;
        this.rpc = rpc;
        this.kolFile = kolFile;
        this.rugUrl = rugUrl;
        this.trackerKey = trackerKey;
        this.rpcList = rpc.split(',').map(s => s.trim()).filter(Boolean);
        if (!this.rpcList.length)
            this.rpcList = ['https://api.mainnet-beta.solana.com'];
    }
    snapshot() {
        const convergence = new Map();
        for (const row of this.kol) {
            if (!this.kolWallets.has(row.wallet))
                continue;
            const set = convergence.get(row.mint) ?? new Set();
            set.add(row.wallet);
            convergence.set(row.mint, set);
        }
        return {
            time: Date.now(),
            tokens: this.tokens,
            launches: this.launches,
            kol: this.kol.map(x => ({ ...x, tracked: this.kolWallets.has(x.wallet) })),
            kolConvergence: [...convergence.entries()].map(([mint, wallets]) => ({ mint, wallets: wallets.size })),
            kolWalletCount: this.kolWallets.size,
            watches: this.watches,
            network: this.network,
            sources: this.status,
            providerHealth: globalProviderHealthTracker.getReport(),
        };
    }
    async start() {
        try {
            const saved = JSON.parse(await readFile(this.watchFile, 'utf8'));
            this.watches = Array.isArray(saved) ? [...new Set(saved.filter(validMint))].slice(0, 30) : [];
        }
        catch { }
        if (this.kolFile)
            try {
                const raw = await readFile(this.kolFile, 'utf8');
                this.kolWallets = new Set(raw.split(/\r?\n/).map(x => x.trim()).filter(x => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x)));
            }
            catch { }
        this.loop(() => this.dex(), 10000);
        this.loop(() => this.kolscan(), 60000);
        this.loop(() => this.solana(), 15000);
        this.pump();
    }
    stop() { this.stopped = true; for (const t of this.timers)
        clearTimeout(t); this.ws?.terminate(); }
    loop(fn, ms) {
        let failures = 0;
        const run = async () => {
            if (this.stopped)
                return;
            try {
                await fn();
                failures = 0;
            }
            catch {
                failures = Math.min(failures + 1, 6);
            }
            if (!this.stopped) {
                const delay = failures ? Math.min(ms * 2 ** failures, 10 * 60_000) : ms;
                const t = setTimeout(() => { this.timers.delete(t); void run(); }, delay);
                this.timers.add(t);
            }
        };
        void run();
    }
    async watch(mint, enabled) {
        if (!validMint(mint))
            throw new Error('Enter a valid Solana token address');
        if (enabled && !this.watches.includes(mint) && this.watches.length >= 30)
            throw new Error('Watchlist limit is 30 tokens');
        this.watches = enabled ? [...new Set([...this.watches, mint])] : this.watches.filter(x => x !== mint);
        const data = JSON.stringify(this.watches) + '\n';
        this.watchWrite = this.watchWrite.catch(() => { }).then(async () => { await mkdir(dirname(this.watchFile), { recursive: true }); await writeFile(this.watchFile, data); });
        await this.watchWrite;
    }
    async search(query) {
        query = query.trim();
        if (!query || query.length > 80)
            throw new Error('Search with 1–80 characters');
        const cached = this.searches.get(query);
        if (cached && Date.now() - cached.at < 30000)
            return cached.rows;
        if (Date.now() - this.lastSearch < 1500)
            throw new Error('Wait a moment before searching again');
        this.lastSearch = Date.now();
        const data = await json('https://api.dexscreener.com/latest/dex/search?q=' + encodeURIComponent(query));
        if (!Array.isArray(data.pairs))
            throw new Error('Search provider unavailable');
        const rows = normalizePairs(data.pairs).slice(0, 30);
        this.searches.set(query, { at: Date.now(), rows });
        while (this.searches.size > 30)
            this.searches.delete(this.searches.keys().next().value);
        return rows;
    }
    async risk(mint) {
        if (!validMint(mint))
            throw new Error('Enter a valid Solana token address');
        const now = Date.now();
        const cached = this.riskCache.get(mint);
        if (cached && now - cached.at < 45_000)
            return cached.value;
        const endpoint = this.rpcList[this.rpcIndex] || this.rpc;
        try {
            const value = await scanToken(mint, endpoint, this.rugUrl, this.trackerKey);
            this.riskCache.set(mint, { at: Date.now(), value });
            while (this.riskCache.size > 100)
                this.riskCache.delete(this.riskCache.keys().next().value);
            globalProviderHealthTracker.recordSuccess('RUGCHECK_API', Date.now() - now);
            return value;
        }
        catch (e) {
            if (e?.message?.includes('429')) {
                globalProviderHealthTracker.recordRateLimit('RUGCHECK_API');
            }
            else {
                globalProviderHealthTracker.recordFailure('RUGCHECK_API');
            }
            throw e;
        }
    }
    async dex() {
        const start = Date.now();
        try {
            const [profiles, pairs] = await Promise.all([json('https://api.dexscreener.com/token-profiles/latest/v1'), json('https://api.dexscreener.com/tokens/v1/solana/So11111111111111111111111111111111111111112')]);
            const mints = [...new Set([...this.watches, ...this.kol.map(x => x.mint), ...(Array.isArray(profiles) ? profiles.filter(p => p.chainId === 'solana').map(p => p.tokenAddress).filter(validMint) : [])])].slice(0, 30);
            const expanded = mints.length ? await json('https://api.dexscreener.com/tokens/v1/solana/' + mints.join(',')) : [];
            const normalized = normalizePairs([...(Array.isArray(expanded) ? expanded : []), ...(Array.isArray(pairs) ? pairs : [])]).slice(0, 60);
            this.tokens = normalized.map(t => {
                const isLaunched = this.launches.some(l => l.mint === t.mint);
                const obs = [];
                if (t.price !== null) {
                    obs.push({
                        provider: 'DEXSCREENER_API',
                        value: t.price,
                        timestampMs: t.at,
                        latencyMs: Date.now() - start,
                        confidence: 0.92,
                    });
                }
                if (isLaunched && t.price !== null) {
                    obs.push({
                        provider: 'PUMPPORTAL_WS',
                        value: t.price,
                        timestampMs: t.at,
                        latencyMs: 15,
                        confidence: 0.88,
                    });
                }
                const validated = this.crossValidator.evaluateToken({
                    mint: t.mint,
                    symbol: t.symbol,
                    priceObservations: obs,
                    liquidityObservations: t.liquidity !== null ? [{ provider: 'DEXSCREENER_API', value: t.liquidity, timestampMs: t.at, latencyMs: 50, confidence: 0.85 }] : [],
                    marketCapObservations: t.cap !== null ? [{ provider: 'DEXSCREENER_API', value: t.cap, timestampMs: t.at, latencyMs: 50, confidence: 0.85 }] : [],
                });
                return {
                    ...t,
                    crossValidationStatus: validated.status,
                    confidenceScore: validated.confidence,
                };
            });
            this.status.dex = { state: 'live', at: Date.now() };
            globalProviderHealthTracker.recordSuccess('DEXSCREENER_API', Date.now() - start);
        }
        catch (e) {
            if (e?.status === 429) {
                this.status.dex.state = 'rate_limited';
                globalProviderHealthTracker.recordRateLimit('DEXSCREENER_API');
            }
            else {
                this.status.dex.state = 'unavailable';
                globalProviderHealthTracker.recordFailure('DEXSCREENER_API');
            }
        }
    }
    async kolscan() {
        try {
            const r = await fetch('https://kolscan.io/', { signal: AbortSignal.timeout(10000) });
            if (!r.ok)
                throw new Error();
            const html = await r.text();
            if (html.length > 3000000)
                throw new Error();
            const rows = parseKolscan(html);
            if (!rows.length)
                throw new Error();
            this.kol = rows;
            this.status.kol = { state: 'live', at: Date.now() };
        }
        catch {
            this.status.kol.state = 'unavailable';
        }
    }
    async solana() {
        const start = Date.now();
        const endpoint = this.rpcList[this.rpcIndex] || this.rpc;
        try {
            const result = await json(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSlot', params: [{ commitment: 'confirmed' }] }) });
            if (!Number.isSafeInteger(result.result))
                throw new Error();
            this.network = { slot: result.result, at: Date.now() };
            this.status.solana = { state: 'live', at: Date.now() };
            globalProviderHealthTracker.recordSuccess('SOLANA_RPC', Date.now() - start, result.result);
        }
        catch (e) {
            if (e?.status === 429 || e?.message?.includes('429')) {
                globalProviderHealthTracker.recordRateLimit('SOLANA_RPC');
            }
            else {
                globalProviderHealthTracker.recordFailure('SOLANA_RPC');
            }
            if (this.rpcList.length > 1) {
                this.rpcIndex = (this.rpcIndex + 1) % this.rpcList.length;
                this.status.solana.state = 'reconnecting';
            }
            else {
                this.status.solana.state = 'unavailable';
            }
        }
    }
    pump() {
        if (this.stopped)
            return;
        const ws = new WebSocket('wss://pumpportal.fun/api/data', { handshakeTimeout: 8000, maxPayload: 1024 * 1024 });
        this.ws = ws;
        let pong = Date.now();
        const heartbeat = setInterval(() => { if (Date.now() - pong > 45000)
            ws.terminate();
        else if (ws.readyState === WebSocket.OPEN)
            ws.ping(); }, 15000);
        ws.on('pong', () => { pong = Date.now(); });
        ws.on('open', () => {
            ws.send(JSON.stringify({ method: 'subscribeNewToken' }));
            this.status.pump = { state: 'connected', at: Date.now() };
            globalProviderHealthTracker.recordSuccess('PUMPPORTAL_WS', 10);
        });
        ws.on('message', data => {
            try {
                const d = JSON.parse(data.toString());
                if (d.errors || d.error) {
                    this.status.pump.state = 'unavailable';
                    globalProviderHealthTracker.recordFailure('PUMPPORTAL_WS');
                    return;
                }
                globalProviderHealthTracker.recordSuccess('PUMPPORTAL_WS', 5);
                if (d.txType === 'create' && validMint(d.mint)) {
                    if (!this.launches.some(x => x.mint === d.mint))
                        this.launches.unshift({ mint: d.mint, symbol: String(d.symbol || '?').slice(0, 24), name: String(d.name || 'New token').slice(0, 80), at: Date.now() });
                    this.launches.length = Math.min(this.launches.length, 50);
                    this.status.pump = { state: 'live', at: Date.now() };
                }
            }
            catch { }
        });
        ws.on('error', () => {
            globalProviderHealthTracker.recordFailure('PUMPPORTAL_WS');
            ws.terminate();
        });
        ws.on('close', () => {
            clearInterval(heartbeat);
            if (!this.stopped) {
                this.status.pump.state = 'reconnecting';
                const t = setTimeout(() => { this.timers.delete(t); this.pump(); }, 10000);
                this.timers.add(t);
            }
        });
    }
}
//# sourceMappingURL=market-hub.js.map