import { readFile, mkdir, rename, appendFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decideExit } from './exit-policy.js';
const LAMPORTS_PER_SOL = 1_000_000_000;
const CSV_HEADER = ['timestamp_utc', 'event', 'side', 'mint', 'symbol', 'name', 'strategy', 'price_usd', 'sol_price_usd', 'liquidity_usd', 'volume_24h_usd', 'change_24h_pct', 'market_cap_usd', 'pair', 'dex', 'cost_lamports', 'proceeds_lamports', 'pnl_lamports', 'reason', 'safety'].join(',') + '\n';
const initial = () => ({ version: 1, cash: String(10 * LAMPORTS_PER_SOL), positions: {}, fills: [], realized: '0', since: Date.now(), halted: false, losses: 0, paused: false, autoPaper: false, autoUsed: [] });
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const PRICE_MAX_AGE_MS = 90_000;
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
const fresh = (row, now = Date.now()) => !!row && positive(row.price) && Number.isSafeInteger(row.at) && row.at > 0 && now >= row.at && now - row.at < PRICE_MAX_AGE_MS;
const uniqueRow = (tokens, mint) => { const rows = tokens.filter(t => t.mint === mint); return rows.length === 1 ? rows[0] : undefined; };
function prices(token, tokens, now = Date.now()) {
    const sol = uniqueRow(tokens, SOL_MINT);
    if (!fresh(token, now) || !fresh(sol, now))
        throw new Error('PAPER_PRICE_EVIDENCE_UNAVAILABLE: fresh finite positive token and canonical SOL prices required');
    return { token, sol, at: Math.min(token.at, sol.at) };
}
function valueLamports(qty, price, sol) {
    const value = Math.round(qty * price / sol * LAMPORTS_PER_SOL);
    if (!positive(qty) || !Number.isSafeInteger(value) || value < 0)
        throw new Error('PAPER_VALUE_INVALID');
    return value;
}
const csv = (value) => { const text = value === null || value === undefined ? '' : String(value); return /[",\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
const number = (value) => value === null || value === undefined || !Number.isFinite(value) ? '' : String(value);
const fillCsvRow = (fill, name = '') => [new Date(fill.at).toISOString(), fill.side, fill.side, fill.mint, fill.symbol, name, fill.reason.includes('auto') ? 'auto-paper' : fill.reason.includes('test') ? 'simulator-test' : 'manual-paper', number(fill.priceUsd), number(fill.solPriceUsd), number(fill.liquidityUsd), number(fill.volume24hUsd), number(fill.change24hPct), number(fill.marketCapUsd), fill.pair, fill.dex, fill.side === 'buy' ? String(-BigInt(fill.lamports)) : '', fill.side === 'sell' ? fill.lamports : '', fill.pnl, fill.reason, fill.safety].map(csv).join(',');
export class PaperPortfolio {
    file;
    maxPositions;
    buyLamports;
    csvFile;
    state = initial();
    write = Promise.resolve();
    csvWrite = Promise.resolve();
    tickTask = null;
    autoUsed = new Set();
    constructor(file, maxPositions = 3, buyLamports = 100_000_000, csvFile = file.replace(/\.json$/i, '_trades.csv')) {
        this.file = file;
        this.maxPositions = maxPositions;
        this.buyLamports = buyLamports;
        this.csvFile = csvFile;
    }
    async start() {
        try {
            const x = JSON.parse(await readFile(this.file, 'utf8'));
            const validInt = (v) => typeof v === 'string' && /^-?\d+$/.test(v);
            const valid = x?.version === 1 && validInt(x.cash) && validInt(x.realized) && x.positions && typeof x.positions === 'object' && !Array.isArray(x.positions) && Array.isArray(x.fills) && x.fills.length <= 300 && x.fills.every((f) => f && validInt(f.lamports) && validInt(f.pnl) && Number.isFinite(f.at) && f.at > 0);
            if (valid)
                this.state = { ...initial(), ...x, autoUsed: Array.isArray(x.autoUsed) ? x.autoUsed.filter((m) => typeof m === 'string').slice(-1000) : [] };
        }
        catch { /* Corrupt snapshots fall back to a clean paper wallet. */ }
        // Legacy quantities were stored in lamports/USD. Migrate only with the exact opening fill's exchange rate.
        for (const p of Object.values(this.state.positions)) {
            if (p.economicsVersion === 2 && positive(p.qty) && positive(p.entryUsd) && positive(p.entrySolPriceUsd))
                continue;
            const openings = this.state.fills.filter(f => f.side === 'buy' && f.mint === p.mint && f.at === p.opened && f.priceUsd === p.entryUsd);
            const opening = openings.length === 1 ? openings[0] : undefined;
            if (p.economicsVersion === undefined && opening && positive(opening.solPriceUsd) && positive(p.qty) && positive(p.entryUsd) && BigInt(opening.lamports) < 0n && p.qty <= Number(-BigInt(opening.lamports)) / p.entryUsd) {
                const qty = p.qty * opening.solPriceUsd / LAMPORTS_PER_SOL;
                if (positive(qty)) {
                    p.qty = qty;
                    p.entrySolPriceUsd = opening.solPriceUsd;
                    p.economicsVersion = 2;
                    p.mark = null;
                    delete p.economicsIssue;
                    continue;
                }
            }
            p.economicsIssue = 'Opening price evidence missing, ambiguous, or invalid; position requires explicit repair';
            p.mark = null;
            this.state.halted = true;
        }
        if (!this.state.since)
            this.state.since = Date.now();
        this.autoUsed = new Set(this.state.autoUsed ?? []);
        try {
            await stat(this.csvFile);
        }
        catch {
            if (this.state.fills.length)
                await appendFile(this.csvFile, CSV_HEADER + this.state.fills.map(fill => fillCsvRow(fill)).join('\n') + '\n', 'utf8');
        }
    }
    async setPaused(paused) { this.state.paused = paused; await this.persist(); }
    async setAutoPaper(enabled) { this.state.autoPaper = enabled; if (!enabled)
        this.state.autoUsed = [...this.autoUsed]; await this.persist(); }
    persist() { const value = JSON.stringify(this.state, null, 2) + '\n'; this.write = this.write.catch(() => { }).then(async () => { await mkdir(dirname(this.file), { recursive: true }); const tmp = this.file + '.tmp'; await Bunless.write(tmp, value); await rename(tmp, this.file); }); return this.write; }
    snapshot(tokens) { const now = Date.now(); const sol = uniqueRow(tokens, SOL_MINT); const positions = Object.values(this.state.positions).map(p => { let mark = null; try {
        const evidence = prices(uniqueRow(tokens, p.mint), tokens, now);
        if (p.economicsVersion === 2 && !p.economicsIssue)
            mark = { value: String(valueLamports(p.qty, evidence.token.price, evidence.sol.price)), at: evidence.at };
    }
    catch { /* Unavailable evidence remains visibly unpriced. */ } return { ...p, mark }; }); const unrealized = positions.reduce((n, p) => n + (p.mark ? BigInt(p.mark.value) - BigInt(p.cost) : 0n), 0n); return { mode: 'paper', demo: false, connected: false, paperActive: true, wallet: 'PAPER-SIMULATION', time: Date.now(), startedAt: this.state.since, paused: this.state.paused, halted: this.state.halted, autoPaper: !!this.state.autoPaper, csvFile: this.csvFile, stopping: false, feed: { healthy: fresh(sol, now) && tokens.length > 0 && tokens.every(t => fresh(t, now)), last: tokens.length && tokens.every(t => Number.isSafeInteger(t.at) && t.at > 0 && t.at <= now) ? Math.min(...tokens.map(t => t.at)) : 0, slot: 0 }, cash: this.state.cash, dayPnl: this.state.realized, day: new Date().toISOString().slice(0, 10), positions, pending: null, candidates: [], events: this.state.fills.slice(-30).reverse().map(f => ({ time: new Date(f.at).toISOString(), event: 'paper_' + f.side, mint: f.mint, side: f.side, reason: f.reason })), performance: { since: this.state.since, realized: this.state.realized, fills: this.state.fills, count: this.state.fills.length }, limits: { positions: this.maxPositions, exposure: String(this.maxPositions * this.buyLamports), dailyLoss: String(3 * this.buyLamports), buy: String(this.buyLamports), slippage: 1500, stop: 1200, tip: '0', priority: '0' }, unrealized: String(unrealized) }; }
    async appendCsv(event, token, fill, cost, proceeds, safety) { const row = [new Date(fill.at).toISOString(), event, fill.side, token.mint, token.symbol, token.name, fill.reason.includes('auto') ? 'auto-paper' : fill.reason.includes('test') ? 'simulator-test' : 'manual-paper', number(token.price), number(fill.solPriceUsd), number(token.liquidity), number(token.volume), number(token.change), number(token.cap), token.pair, token.dex, cost, proceeds, fill.pnl, fill.reason, safety].map(csv).join(',') + '\n'; this.csvWrite = this.csvWrite.catch(() => { }).then(async () => { await mkdir(dirname(this.csvFile), { recursive: true }); let exists = true; try {
        await stat(this.csvFile);
    }
    catch {
        exists = false;
    } await appendFile(this.csvFile, (exists ? '' : CSV_HEADER) + row, 'utf8'); }); await this.csvWrite; }
    async buy(token, tokens, strategy = 'manual-paper') { if (this.state.paused || this.state.halted)
        throw new Error('Paper entries are paused or halted'); if (Object.keys(this.state.positions).length >= this.maxPositions)
        throw new Error('Paper position cap reached'); if (this.state.positions[token.mint])
        throw new Error('One paper trade per token'); const evidence = prices(token, tokens); const sol = evidence.sol.price; const price = evidence.token.price; const qty = this.buyLamports / LAMPORTS_PER_SOL * sol / price; if (!positive(qty))
        throw new Error('PAPER_QUANTITY_INVALID'); const cost = BigInt(this.buyLamports); if (BigInt(this.state.cash) < cost)
        throw new Error('Paper cash exhausted'); const at = Date.now(); const safety = strategy.includes('unsafe') ? 'bypassed-for-test' : strategy.includes('cleared') || strategy.includes('auto') ? 'passed' : 'not-run'; const p = { mint: token.mint, symbol: token.symbol, name: token.name, qty, economicsVersion: 2, entrySolPriceUsd: sol, entryUsd: price, cost: String(cost), opened: at, peakUsd: price, stage: 0, mark: null, panic: false, strategy }; this.state.positions[token.mint] = p; this.state.cash = String(BigInt(this.state.cash) - cost); const fill = { at, mint: token.mint, symbol: token.symbol, side: 'buy', lamports: String(-cost), pnl: '0', reason: strategy, priceUsd: price, solPriceUsd: sol, liquidityUsd: token.liquidity, volume24hUsd: token.volume, change24hPct: token.change, marketCapUsd: token.cap, pair: token.pair, dex: token.dex, safety }; this.state.fills.push(fill); await this.persist(); await this.appendCsv('buy', token, fill, String(cost), '0', safety); return this.snapshot(tokens); }
    async sell(mint, tokens, fraction = 10000, reason = 'manual-paper') { const p = this.state.positions[mint]; if (!p)
        throw new Error('No paper position'); if (p.economicsVersion !== 2 || p.economicsIssue)
        throw new Error('PAPER_POSITION_EVIDENCE_UNRESOLVED'); const { token, sol: solRow } = prices(uniqueRow(tokens, mint), tokens); const sol = solRow.price; if (!Number.isInteger(fraction) || fraction < 1 || fraction > 10000)
        throw new Error('PAPER_FRACTION_INVALID'); const frac = Math.max(1, Math.min(10000, Math.floor(fraction))); const proceeds = BigInt(valueLamports(p.qty * frac / 10000, token.price, sol)); const basis = BigInt(p.cost) * BigInt(frac) / 10000n; const pnl = proceeds - basis; const at = Date.now(); this.state.cash = String(BigInt(this.state.cash) + proceeds); this.state.realized = String(BigInt(this.state.realized) + pnl); p.cost = String(BigInt(p.cost) - basis); p.qty *= (10000 - frac) / 10000; p.stage += 1; const fill = { at, mint, symbol: p.symbol, side: 'sell', lamports: String(proceeds), pnl: String(pnl), reason, priceUsd: token.price, solPriceUsd: sol, liquidityUsd: token.liquidity, volume24hUsd: token.volume, change24hPct: token.change, marketCapUsd: token.cap, pair: token.pair, dex: token.dex, safety: 'position-opened' }; this.state.fills.push(fill); if (frac === 10000 || BigInt(p.cost) === 0n)
        delete this.state.positions[mint]; await this.persist(); await this.appendCsv('sell', token, fill, String(basis), String(proceeds), 'position-opened'); return this.snapshot(tokens); }
    async tick(tokens, safety) { if (this.tickTask)
        return this.tickTask; this.tickTask = this.tickInternal(tokens, safety); try {
        await this.tickTask;
    }
    finally {
        this.tickTask = null;
    } }
    async tickInternal(tokens, safety) {
        for (const p of Object.values(this.state.positions)) {
            const token = uniqueRow(tokens, p.mint);
            if (!fresh(token) || !fresh(uniqueRow(tokens, SOL_MINT)) || p.economicsVersion !== 2 || p.economicsIssue || !positive(p.entryUsd))
                continue;
            p.peakUsd = Math.max(p.peakUsd, token.price);
            const decision = decideExit({ entry: p.entryUsd, mark: token.price, peak: p.peakUsd, stage: p.stage, openedAt: p.opened, now: Date.now(), stopBps: 1200, markAt: token.at, maxMarkAgeMs: PRICE_MAX_AGE_MS });
            if (decision)
                await this.sell(p.mint, tokens, decision.fractionBps, `auto-${decision.reason.toLowerCase()}`);
        }
        if (this.state.autoPaper && !this.state.paused && !this.state.halted && Object.keys(this.state.positions).length < this.maxPositions && safety) {
            const now = Date.now();
            const candidates = tokens.filter(t => t.mint !== SOL_MINT && fresh(t, now) && !this.state.positions[t.mint] && !this.autoUsed.has(t.mint) && now - t.at < 90_000 && (t.liquidity ?? 0) >= 50_000 && (t.volume ?? 0) >= 100_000 && t.change !== null && t.change >= -10 && t.change <= 250).sort((a, b) => (((b.volume ?? 0) / Math.max(1, b.liquidity ?? 1)) * (1 + Math.max(0, b.change ?? 0) / 100)) - (((a.volume ?? 0) / Math.max(1, a.liquidity ?? 1)) * (1 + Math.max(0, a.change ?? 0) / 100))).slice(0, 3);
            for (const token of candidates) {
                try {
                    const check = await safety(token.mint);
                    if (check.safe === true) {
                        await this.buy(token, tokens, 'auto-paper-cleared');
                        this.autoUsed.add(token.mint);
                        while (this.autoUsed.size > 1000)
                            this.autoUsed.delete(this.autoUsed.values().next().value);
                        this.state.autoUsed = [...this.autoUsed];
                        break;
                    }
                }
                catch { /* provider gaps do not create a trade */ }
            }
        }
        await this.persist();
    }
    async clear() { this.state = initial(); await this.persist(); }
}
const Bunless = { write: async (file, value) => { const { writeFile } = await import('node:fs/promises'); await writeFile(file, value, 'utf8'); } };
//# sourceMappingURL=paper.js.map