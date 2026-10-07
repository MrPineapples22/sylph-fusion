/** Token-bucket rate limiter per endpoint to smoothly pace requests and avoid provider HTTP 429s */
class TokenBucket {
    capacity;
    refillRatePerSec;
    tokens;
    lastRefill;
    constructor(capacity = 60, refillRatePerSec = 30) {
        this.capacity = capacity;
        this.refillRatePerSec = refillRatePerSec;
        this.tokens = capacity;
        this.lastRefill = performance.now();
    }
    tryConsume(cost = 1) {
        this.refill();
        if (this.tokens >= cost) {
            this.tokens -= cost;
            return true;
        }
        return false;
    }
    async acquire(cost = 1, maxWaitMs = 1000) {
        const start = performance.now();
        while (performance.now() - start < maxWaitMs) {
            if (this.tryConsume(cost))
                return true;
            await new Promise(r => setTimeout(r, 20));
        }
        return false;
    }
    refill() {
        const now = performance.now();
        const elapsedSec = (now - this.lastRefill) / 1000;
        this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillRatePerSec);
        this.lastRefill = now;
    }
}
import { Connection } from '@solana/web3.js';
import { log } from './core.js';
import { auditFinalizedBlockRange } from './platform/ingestion/finalized-block-auditor.js';
export function sanitizeRpcUrl(rawUrl) {
    if (!rawUrl)
        return '';
    let host = '';
    try {
        const parsed = new URL(rawUrl);
        host = parsed.host;
    }
    catch {
        const match = rawUrl.match(/^(?:https?:\/\/)?([^/?#:]+(?::\d+)?)/i);
        host = match ? match[1] : rawUrl.split(/[?#/]/)[0];
    }
    const h = host.toLowerCase();
    let provider = '';
    if (h.includes('helius'))
        provider = 'Helius';
    else if (h.includes('alchemy'))
        provider = 'Alchemy';
    else if (h.includes('quicknode'))
        provider = 'QuickNode';
    else if (h.includes('triton'))
        provider = 'Triton';
    else if (h.includes('ankr'))
        provider = 'Ankr';
    else if (h.includes('jito'))
        provider = 'Jito';
    else if (h.includes('solana.com'))
        provider = 'Solana Public';
    else if (h.includes('publicnode.com'))
        provider = 'PublicNode';
    else if (h.includes('genesysgo'))
        provider = 'GenesysGo';
    else if (h.includes('extrnode'))
        provider = 'Extrnode';
    else if (h.includes('127.0.0.1') || h.includes('localhost'))
        provider = 'Local RPC';
    else {
        const parts = h.split(':')[0].split('.');
        provider = parts.length >= 2 ? parts[parts.length - 2].toUpperCase() : host;
    }
    return provider ? `${provider} (${host})` : host;
}
export async function httpJson(url, timeout, init = {}) {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
    return await response.json();
}
export class RpcPool {
    cfg;
    connection;
    endpoints;
    active = 0;
    failures;
    http429s;
    errors;
    latencies;
    slots;
    lastSuccess;
    calls;
    localRateLimitDenials;
    latencyHistories;
    quarantinedUntil;
    rateLimiters;
    constructor(cfg) {
        this.cfg = cfg;
        this.failures = cfg.RPC_URLS.map(() => 0);
        this.http429s = cfg.RPC_URLS.map(() => 0);
        this.errors = cfg.RPC_URLS.map(() => 0);
        this.latencies = cfg.RPC_URLS.map(() => 0);
        this.slots = cfg.RPC_URLS.map(() => 0);
        this.lastSuccess = cfg.RPC_URLS.map(() => null);
        this.calls = cfg.RPC_URLS.map(() => 0);
        this.localRateLimitDenials = cfg.RPC_URLS.map(() => 0);
        this.latencyHistories = cfg.RPC_URLS.map(() => []);
        this.quarantinedUntil = cfg.RPC_URLS.map(() => 0);
        this.rateLimiters = cfg.RPC_URLS.map(() => new TokenBucket(60, 35));
        const boundedFetch = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(cfg.RPC_TIMEOUT_MS) });
        const dispatchEndpoint = async (index, init) => {
            if (!await this.rateLimiters[index].acquire(1, 150)) {
                this.localRateLimitDenials[index]++;
                throw new Error('RPC endpoint locally rate limited');
            }
            this.calls[index]++;
            const t0 = performance.now();
            try {
                const response = await boundedFetch(cfg.RPC_URLS[index], init);
                if (response.status === 429) {
                    this.http429s[index]++;
                    this.failures[index]++;
                    // Exponential backoff quarantine on 429
                    this.quarantinedUntil[index] = Date.now() + Math.min(60_000, 5000 * 2 ** Math.min(this.failures[index] - 1, 4));
                }
                else if (!response.ok) {
                    this.errors[index]++;
                    this.failures[index]++;
                }
                else {
                    const data = await response.clone().json();
                    if (data.error) {
                        this.errors[index]++;
                        this.failures[index]++;
                    }
                    else {
                        // Keep the endpoint slot watermark current from authoritative RPC
                        // responses, including calls made through direct endpoint clients.
                        const request = typeof init.body === 'string'
                            ? JSON.parse(init.body)
                            : undefined;
                        const contextualSlot = data.result && typeof data.result === 'object'
                            ? data.result.context?.slot
                            : undefined;
                        const observedSlot = Number.isSafeInteger(contextualSlot)
                            ? contextualSlot
                            : request?.method === 'getSlot' && Number.isSafeInteger(data.result)
                                ? data.result
                                : 0;
                        if (observedSlot > 0)
                            this.updateSlot(index, observedSlot);
                        this.failures[index] = 0;
                        this.quarantinedUntil[index] = 0;
                        const latencyMs = Math.round(performance.now() - t0);
                        this.latencies[index] = latencyMs;
                        this.latencyHistories[index].push(latencyMs);
                        if (this.latencyHistories[index].length > 50)
                            this.latencyHistories[index].shift();
                        this.lastSuccess[index] = Date.now();
                    }
                }
                if (response.status !== 429 && this.failures[index] >= 3)
                    this.quarantinedUntil[index] = Date.now() + 15_000;
                return response;
            }
            catch (error) {
                this.errors[index]++;
                this.failures[index]++;
                if (this.failures[index] >= 3)
                    this.quarantinedUntil[index] = Date.now() + 15_000;
                throw error;
            }
        };
        this.endpoints = cfg.RPC_URLS.map((url, index) => new Connection(url, {
            commitment: 'confirmed',
            disableRetryOnRateLimit: true,
            fetch: (_url, init) => dispatchEndpoint(index, init ?? {}),
        }));
        const pooledFetch = async (_url, init) => {
            const now = Date.now();
            // Dynamic Endpoint Scoring: rank endpoints by latency + failure penalty + slot lag
            const maxObservedSlot = Math.max(...this.slots, 0);
            const rankedIndices = cfg.RPC_URLS.map((_, i) => {
                const isQuarantined = now < this.quarantinedUntil[i];
                const failPenalty = this.failures[i] * 150;
                const slotLag = maxObservedSlot > 0 && this.slots[i] > 0 ? Math.max(0, maxObservedSlot - this.slots[i]) : 0;
                const score = (isQuarantined ? 100_000 : 0) + (this.latencies[i] || 100) + failPenalty + (slotLag * 25);
                return { index: i, score, isQuarantined };
            }).sort((a, b) => a.score - b.score).map(x => x.index);
            let localRateLimitSkips = 0;
            for (const index of rankedIndices) {
                // Enforce rate limiter token pacing
                try {
                    const res = await dispatchEndpoint(index, init ?? {});
                    if (res.status === 429)
                        throw new Error('HTTP 429');
                    if (!res.ok)
                        throw new Error(`HTTP ${res.status}`);
                    const data = await res.clone().json();
                    if (data.error)
                        throw new Error('RPC rejected request');
                    if (this.active !== index)
                        log('rpc_failover', { endpointIndex: index, url: sanitizeRpcUrl(cfg.RPC_URLS[index]), latencyMs: this.latencies[index] });
                    this.active = index;
                    return res;
                }
                catch (error) {
                    if (error instanceof Error && error.message === 'RPC endpoint locally rate limited') {
                        // Do not turn local queue saturation into an upstream request. Try
                        // another endpoint, then report local capacity exhaustion separately
                        // from provider failures if every endpoint is saturated.
                        localRateLimitSkips++;
                        continue;
                    }
                }
            }
            throw new Error(localRateLimitSkips === rankedIndices.length
                ? 'all RPC endpoints locally rate limited'
                : 'all RPC endpoints failed');
        };
        this.connection = new Connection(cfg.RPC_URLS[0], { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: pooledFetch });
    }
    getEndpointStats() {
        const maxSlot = Math.max(...this.slots, 0);
        const now = Date.now();
        return this.cfg.RPC_URLS.map((url, i) => {
            const isRateLimited = this.http429s[i] > 0 && (this.lastSuccess[i] === null || (now - (this.lastSuccess[i] ?? 0)) > 15_000 && this.failures[i] > 0);
            const isError = this.failures[i] > 3;
            const isStale = maxSlot > 0 && this.slots[i] > 0 && (maxSlot - this.slots[i] > 32);
            let status = 'standby';
            if (isStale) {
                status = 'stale';
            }
            else if (i === this.active && !isRateLimited && !isError) {
                status = 'active';
            }
            else if (isRateLimited) {
                status = 'rate_limited';
            }
            else if (isError) {
                status = 'error';
            }
            else if (isStale) {
                status = 'stale';
            }
            const samples = [...this.latencyHistories[i]].sort((a, b) => a - b);
            const p50 = samples.length ? samples[Math.floor(samples.length * 0.5)] : this.latencies[i];
            const p95 = samples.length ? samples[Math.floor(samples.length * 0.95)] : this.latencies[i];
            const drops = this.http429s[i] + this.errors[i];
            return {
                index: i,
                url: sanitizeRpcUrl(url),
                currentSlot: this.slots[i],
                latencyMs: this.latencies[i],
                p50LatencyMs: p50,
                p95LatencyMs: p95,
                calls: this.calls[i],
                localRateLimitDenials: this.localRateLimitDenials[i],
                drops,
                errorCount: this.errors[i],
                http429Count: this.http429s[i],
                lastSuccessAt: this.lastSuccess[i],
                active: i === this.active,
                status,
            };
        });
    }
    updateSlot(index, slot) {
        if (index >= 0 && index < this.slots.length && Number.isFinite(slot) && slot > 0) {
            this.slots[index] = Math.max(this.slots[index], slot);
        }
    }
    /** Read-only research audit. This intentionally does not authorize recovery certificates/frontiers. */
    auditFinalizedBlockRange(startSlot, endSlot, options = {}) {
        const providers = this.endpoints.map((endpoint, index) => ({
            providerId: `endpoint-${index}:${sanitizeRpcUrl(this.cfg.RPC_URLS[index])}`,
            getGenesisHash: () => endpoint.getGenesisHash(),
            getFinalizedSlot: () => endpoint.getSlot('finalized'),
            getFirstAvailableBlock: () => endpoint.getFirstAvailableBlock(),
            getBlocks: (start, end, commitment) => endpoint.getBlocks(start, end, commitment),
            getBlock: (slot, config) => endpoint.getBlock(slot, config),
        }));
        return auditFinalizedBlockRange(providers, startSlot, endSlot, options);
    }
    async verifyCluster() {
        const results = await Promise.all(this.endpoints.map(c => c.getGenesisHash()));
        if (results.some(h => h !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d'))
            throw new Error('RPC must be Solana mainnet-beta');
        const slots = await Promise.all(this.endpoints.map(async (c, i) => {
            const t0 = performance.now();
            const slot = await c.getSlot('confirmed');
            this.latencies[i] = Math.round(performance.now() - t0);
            this.slots[i] = slot;
            this.lastSuccess[i] = Date.now();
            return slot;
        }));
        if (Math.max(...slots) - Math.min(...slots) > 32)
            throw new Error('RPC endpoints disagree by more than 32 slots');
    }
}
//# sourceMappingURL=rpc.js.map