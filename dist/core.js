export function recordResult(state, mint, side, signature, net, pnl) {
    const report = state.performance ??= { since: Date.now(), realized: '0', fills: [], count: 0 };
    report.realized = String(BigInt(report.realized) + pnl);
    report.count++;
    report.fills.push({ at: Date.now(), mint, side, signature, net: String(net), pnl: String(pnl) });
    if (report.fills.length > 300)
        report.fills.shift();
}
export const mulBps = (x, bps) => x * BigInt(bps) / 10000n;
export const ceilDiv = (a, b) => (a + b - 1n) / b;
export function exitDecision(p, value, stopBps) {
    const qty = BigInt(p.qty), initial = BigInt(p.initialQty);
    if (qty <= 0n)
        return null;
    const normalized = value * initial / qty;
    const cost = BigInt(p.originalCost), peak = BigInt(p.peak);
    if (p.panic)
        return { fraction: 10_000, stage: p.stage, reason: 'panic' };
    if (normalized <= mulBps(cost, 10_000 - stopBps))
        return { fraction: 10_000, stage: p.stage, reason: 'stop' };
    if (p.stage > 0 && normalized <= cost)
        return { fraction: 10_000, stage: p.stage, reason: 'breakeven-trigger' };
    const thresholds = [12_000, 16_000, 25_000, 60_000, 160_000];
    if (p.stage < thresholds.length && normalized >= mulBps(cost, thresholds[p.stage]))
        return { fraction: p.stage === 4 ? 10_000 : 5000, stage: p.stage + 1, reason: 'take-profit' };
    const trail = peak >= cost * 6n ? 4000 : peak >= mulBps(cost, 25_000) ? 3000 : peak >= mulBps(cost, 15_000) ? 2500 : 2000;
    const floor = peak >= cost * 6n ? mulBps(cost, 20_000) : peak >= mulBps(cost, 25_000) ? mulBps(cost, 15_000) : peak >= mulBps(cost, 15_000) ? mulBps(cost, 12_000) : mulBps(cost, 10_500);
    if (peak >= mulBps(cost, 12_000) && normalized <= (mulBps(peak, 10_000 - trail) > floor ? mulBps(peak, 10_000 - trail) : floor))
        return { fraction: 10_000, stage: p.stage, reason: 'trailing-stop' };
    return null;
}
export function settle(state, tokenDelta, solDelta) {
    const o = state.pending;
    if (!o)
        throw new Error('no pending order');
    const today = new Date().toISOString().slice(0, 10);
    if (state.day !== today) {
        state.day = today;
        state.dayPnl = '0';
    }
    let realized = 0n;
    if (o.side === 'buy') {
        if (tokenDelta <= 0n || solDelta >= 0n || state.positions[o.mint])
            throw new Error('invalid buy fill');
        state.positions[o.mint] = { mint: o.mint, creator: o.creator, tokenProgram: o.tokenProgram,
            qty: String(tokenDelta), initialQty: String(tokenDelta), cost: String(-solDelta), originalCost: String(-solDelta),
            peak: String(-solDelta), stage: 0, opened: o.created, reserve: o.reserve, panic: false, creatorTokens: o.creatorTokens ?? '0' };
    }
    else {
        const p = state.positions[o.mint];
        if (!p || tokenDelta >= 0n || -tokenDelta > BigInt(p.qty))
            throw new Error('invalid sell fill');
        const allocated = BigInt(p.cost) * -tokenDelta / BigInt(p.qty);
        realized = solDelta - allocated;
        p.qty = String(BigInt(p.qty) + tokenDelta);
        p.cost = String(BigInt(p.cost) - allocated);
        p.stage = o.stage;
        state.dayPnl = String(BigInt(state.dayPnl) + solDelta - allocated);
        if (BigInt(p.qty) === 0n) {
            delete state.positions[o.mint];
            state.closed[o.mint] = Date.now();
        }
    }
    recordResult(state, o.mint, o.side, o.signature, solDelta, realized);
    state.cash = String(BigInt(state.cash) + solDelta);
    state.pending = null;
}
export class BoundedSet {
    max;
    ttl;
    values = new Map();
    constructor(max, ttl) {
        this.max = max;
        this.ttl = ttl;
    }
    has(key, now = Date.now()) {
        const previous = this.values.get(key);
        if (previous === undefined || now - previous >= this.ttl) {
            if (previous !== undefined)
                this.values.delete(key);
            return false;
        }
        return true;
    }
    add(key, now = Date.now()) {
        const previous = this.values.get(key);
        if (previous !== undefined && now - previous < this.ttl)
            return false;
        this.values.delete(key);
        this.values.set(key, now);
        while (this.values.size > this.max)
            this.values.delete(this.values.keys().next().value);
        return true;
    }
}
const SENSITIVE_KEY_REGEX = /key|secret|password|auth|token|seed|private/i;
const SENSITIVE_URL_REGEX = /^https?:\/\/[^\s]+[?&](api-key|key|token|auth)=/i;
export function sanitizeLogFields(fields) {
    const result = {};
    for (const [k, v] of Object.entries(fields)) {
        if (SENSITIVE_KEY_REGEX.test(k)) {
            result[k] = '[REDACTED]';
        }
        else if (typeof v === 'string') {
            if (SENSITIVE_URL_REGEX.test(v)) {
                try {
                    const u = new URL(v);
                    result[k] = `${u.protocol}//${u.host}${u.pathname}?api-key=[REDACTED]`;
                }
                catch {
                    result[k] = '[REDACTED_URL]';
                }
            }
            else if (v.length >= 64 && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(v) && !['mint', 'signature'].includes(k)) {
                result[k] = '[REDACTED_KEY]';
            }
            else {
                result[k] = v;
            }
        }
        else if (Array.isArray(v) && v.length === 64 && typeof v[0] === 'number') {
            result[k] = '[REDACTED_KEYPAIR_BYTES]';
        }
        else {
            result[k] = v;
        }
    }
    return result;
}
export function log(event, fields = {}) {
    const sanitized = sanitizeLogFields(fields);
    recentEvents.push({ time: new Date().toISOString(), event, ...Object.fromEntries(Object.entries(sanitized).filter(([k]) => ['mint', 'side', 'reason', 'signature', 'status', 'netLamports', 'tokenDelta', 'stage', 'quoteAgeMs', 'slippageBps', 'tipLamports', 'priorityLamports', 'rentLamports', 'uptimeHours'].includes(k))) });
    if (recentEvents.length > 100)
        recentEvents.shift();
    process.stdout.write(JSON.stringify({ time: new Date().toISOString(), event, ...sanitized }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + '\n');
}
export const recentEvents = [];
function riskState(state) {
    return state.risk ??= { failures: [], equity: [], highWater: state.cash };
}
/** Record a failed transaction and halt after a bounded burst of failures. */
export function recordFailure(state, now = Date.now(), windowMs = 3_600_000, limit = 3) {
    const risk = riskState(state);
    risk.failures = risk.failures.filter(at => now - at <= windowMs);
    risk.failures.push(now);
    if (risk.failures.length >= limit) {
        state.halted = true;
        risk.haltReason = `${limit} transaction failures in ${Math.round(windowMs / 60_000)} minutes`;
    }
    return state.halted;
}
/** Track rolling equity and halt when drawdown from the active-window high-water mark is breached. */
export function recordEquity(state, value, now = Date.now(), windowMs = 3_600_000, drawdownBps = 500) {
    const risk = riskState(state);
    risk.equity = risk.equity.filter(sample => now - sample.at <= windowMs);
    risk.equity.push({ at: now, value: String(value) });
    const current = value;
    const high = risk.equity.reduce((max, sample) => {
        const n = BigInt(sample.value);
        return n > max ? n : max;
    }, 0n);
    const lifetime = BigInt(risk.lifetimePeak || risk.highWater || '0');
    if (current > lifetime)
        risk.lifetimePeak = String(current);
    risk.highWater = String(high);
    const water = high;
    if (water > 0n && current * 10000n <= water * BigInt(10_000 - drawdownBps)) {
        state.halted = true;
        risk.haltReason = `rolling drawdown reached ${drawdownBps} bps`;
    }
    return state.halted;
}
/** Prune stale failure and equity samples outside the rolling window, recalibrating rolling high water. */
export function pruneRiskState(state, now = Date.now(), windowMs = 3_600_000) {
    if (!state.risk)
        return;
    state.risk.failures = state.risk.failures.filter(at => now - at <= windowMs);
    state.risk.equity = state.risk.equity.filter(sample => now - sample.at <= windowMs);
    if (state.risk.equity.length) {
        const high = state.risk.equity.reduce((max, sample) => {
            const n = BigInt(sample.value);
            return n > max ? n : max;
        }, 0n);
        state.risk.highWater = String(high);
    }
    else {
        state.risk.highWater = state.cash;
    }
}
//# sourceMappingURL=core.js.map