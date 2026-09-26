/**
 * SOL-SYLPH Platform - Provider Health & Reliability Engine
 * Specifications: Sections 12, 14, 15, 34, 43, 51.
 *
 * Continuously tracks connectivity, response latency, slot lag, feed age,
 * error rates, and circuit-breaker states for all external market data providers.
 */
export class ProviderHealthTracker {
    metrics = new Map();
    constructor() {
        this.initDefaultProviders();
    }
    initDefaultProviders() {
        const defs = [
            ['PUMPPORTAL_WS', 'DISCOVERY_STREAM', true, 'wss://pumpportal.fun/api/data'],
            ['DEXSCREENER_API', 'MARKET_ENRICHMENT', false, 'https://api.dexscreener.com/latest/dex'],
            ['RUGCHECK_API', 'SECURITY_RISK', true, 'https://api.rugcheck.xyz/v1/tokens'],
            ['JUPITER_QUOTE', 'EXECUTION_ROUTING', false, 'https://quote-api.jup.ag/v6/quote'],
            ['SOLANA_RPC', 'ON_CHAIN_TRUTH', true, 'https://api.mainnet-beta.solana.com'],
            ['SOLANA_WSS', 'ON_CHAIN_TRUTH', true, 'wss://api.mainnet-beta.solana.com'],
            ['HELIOS_DIRECT_TPU', 'DIRECT_TPU_DISPATCH', true, 'udp://validator-leader-tpu:8003'],
        ];
        for (const [id, role, authoritative, url] of defs) {
            this.metrics.set(id, {
                role,
                isAuthoritative: authoritative,
                lastSuccessMs: Date.now(),
                latencies: [12],
                requestCount: 1,
                errorCount: 0,
                circuitOpen: false,
                circuitTripCount: 0,
                slotLag: 0,
                sanitizedUrl: url,
                rateLimitedUntilMs: 0,
                rateLimitCount: 0,
            });
        }
    }
    recordSuccess(providerId, latencyMs, slotLag) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.lastSuccessMs = Date.now();
        entry.requestCount++;
        entry.latencies.push(latencyMs);
        if (entry.latencies.length > 50)
            entry.latencies.shift();
        if (slotLag !== undefined)
            entry.slotLag = slotLag;
        entry.circuitOpen = false;
        entry.rateLimitedUntilMs = 0;
    }
    recordFailure(providerId) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.requestCount++;
        entry.errorCount++;
        const recentErrorRate = entry.errorCount / entry.requestCount;
        if (recentErrorRate > 0.40 && entry.requestCount > 5) {
            entry.circuitOpen = true;
            entry.circuitTripCount++;
        }
    }
    recordRateLimit(providerId, backoffMs = 15_000) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.requestCount++;
        entry.errorCount++;
        entry.rateLimitCount++;
        entry.rateLimitedUntilMs = Date.now() + backoffMs;
    }
    updateSlot(currentSlot, networkSlot) {
        const lag = Math.max(0, networkSlot - currentSlot);
        const rpc = this.metrics.get('SOLANA_RPC');
        if (rpc)
            rpc.slotLag = lag;
        const wss = this.metrics.get('SOLANA_WSS');
        if (wss)
            wss.slotLag = lag;
    }
    isMarketFeedStale(now = Date.now(), thresholdMs = 10_000) {
        const pump = this.metrics.get('PUMPPORTAL_WS');
        if (pump && (now - pump.lastSuccessMs > thresholdMs || pump.circuitOpen || pump.rateLimitedUntilMs > now)) {
            return true;
        }
        const rpc = this.metrics.get('SOLANA_RPC');
        if (rpc && (now - rpc.lastSuccessMs > thresholdMs * 2 || rpc.circuitOpen || rpc.rateLimitedUntilMs > now)) {
            return true;
        }
        return false;
    }
    getReport(now = Date.now()) {
        const providers = {};
        const activeAlerts = [];
        let criticalCount = 0;
        let degradedCount = 0;
        for (const [id, m] of this.metrics.entries()) {
            const feedAgeMs = now - m.lastSuccessMs;
            const avgLatency = m.latencies.length
                ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length)
                : 0;
            const errorRate = m.requestCount > 0 ? (m.errorCount / m.requestCount) * 100 : 0;
            let state = 'OPTIMAL';
            if (now < m.rateLimitedUntilMs) {
                state = 'RATE_LIMITED';
                if (m.isAuthoritative)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: m.isAuthoritative ? 'CRITICAL' : 'WARNING',
                    source: id,
                    message: `Provider ${id} rate limited (HTTP 429). Backing off for ${Math.round((m.rateLimitedUntilMs - now) / 1000)}s.`,
                    timestampMs: now,
                    actionRequired: 'Throttle request rate or configure dedicated API key.',
                });
            }
            else if (m.circuitOpen) {
                state = 'CIRCUIT_OPEN';
                criticalCount++;
                activeAlerts.push({
                    severity: 'CRITICAL',
                    source: id,
                    message: `Circuit breaker tripped for ${id}. Excessive failure rate (${errorRate.toFixed(1)}%).`,
                    timestampMs: now,
                    actionRequired: 'Inspect network connection and API rate limits.',
                });
            }
            else if (m.isAuthoritative ? feedAgeMs > 10_000 : feedAgeMs > 45_000) {
                state = 'STALE';
                if (m.isAuthoritative)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: m.isAuthoritative ? 'CRITICAL' : 'WARNING',
                    source: id,
                    message: `Feed data is stale (${Math.round(feedAgeMs / 1000)}s since last tick).`,
                    timestampMs: now,
                    actionRequired: 'Trigger WebSocket reconnect or poll backup provider.',
                });
            }
            else if (errorRate > 15 || avgLatency > 500) {
                state = 'DEGRADED';
                degradedCount++;
                activeAlerts.push({
                    severity: 'NOTICE',
                    source: id,
                    message: `Provider latency or error rate elevated (${avgLatency}ms, ${errorRate.toFixed(1)}% errors).`,
                    timestampMs: now,
                });
            }
            else if (avgLatency > 150) {
                state = 'CONNECTED';
            }
            providers[id] = {
                providerId: id,
                role: m.role,
                state,
                isAuthoritative: m.isAuthoritative,
                lastSuccessTimestampMs: m.lastSuccessMs,
                avgLatencyMs: avgLatency,
                errorRatePct: Number(errorRate.toFixed(1)),
                totalRequestsCount: m.requestCount,
                totalErrorsCount: m.errorCount,
                slotLag: m.slotLag,
                feedAgeMs,
                circuitBreakerTripped: m.circuitOpen,
                failoverActive: m.circuitTripCount > 0 && !m.circuitOpen,
                endpointUrlSanitized: m.sanitizedUrl,
                rateLimitedUntilMs: m.rateLimitedUntilMs,
            };
        }
        const marketFeedStale = this.isMarketFeedStale(now);
        let overall = 'NOMINAL';
        if (criticalCount > 0 || marketFeedStale)
            overall = 'CRITICAL';
        else if (degradedCount > 1)
            overall = 'RESTRICTED';
        else if (degradedCount === 1)
            overall = 'DEGRADED';
        return {
            overallSystemState: overall,
            isMarketFeedStale: marketFeedStale,
            providers,
            activeAlerts,
            evaluatedAtMs: now,
        };
    }
}
export const globalProviderHealthTracker = new ProviderHealthTracker();
//# sourceMappingURL=provider-health.js.map