/**
 * SOL-SYLPH Platform - Provider Health, Reliability & Capability Engine
 * Specifications: Sections 12, 14, 15, 34, 43, 51.
 *
 * Implements:
 * 1. Independent 15-field Provider Capability Model.
 * 2. Strict separation: Transport Reachability != Market Observation Validity.
 * 3. Bounded Rolling-Window Circuit Breaker (CLOSED -> DEGRADED -> OPEN -> PROBING -> RECOVERING -> HEALTHY).
 *    Recovery requires at least 3 consecutive validated observations.
 * 4. Actual endpoint transition recording for failovers.
 * 5. Aggregate health evaluates ONLY providers configured for the active capability.
 */
export class ProviderHealthTracker {
    metrics = new Map();
    endpointTransitions = new Map();
    windowSize = 20;
    circuitCooldownMs = 10_000;
    requiredRecoveryObservations = 3;
    constructor() {
        this.initDefaultProviders();
    }
    initDefaultProviders() {
        const defs = [
            { id: 'PUMPPORTAL_WS', role: 'DISCOVERY_STREAM', authoritative: true, configured: false, enabled: false, authenticated: false, url: 'wss://pumpportal.fun/api/data' },
            { id: 'DEXSCREENER_API', role: 'MARKET_ENRICHMENT', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.dexscreener.com/latest/dex' },
            { id: 'RUGCHECK_API', role: 'SECURITY_RISK', authoritative: true, configured: false, enabled: false, authenticated: false, url: 'https://api.rugcheck.xyz/v1/tokens' },
            { id: 'JUPITER_QUOTE', role: 'EXECUTION_ROUTING', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://quote-api.jup.ag/v6/quote' },
            { id: 'SOLANA_RPC', role: 'ON_CHAIN_TRUTH', authoritative: true, configured: false, enabled: false, authenticated: false, url: 'https://api.mainnet-beta.solana.com' },
            { id: 'SOLANA_WSS', role: 'ON_CHAIN_TRUTH', authoritative: true, configured: false, enabled: false, authenticated: false, url: 'wss://api.mainnet-beta.solana.com' },
            // HELIOS Direct TPU is an optional optimization; unconfigured/disabled by default so it does NOT make platform CRITICAL
            { id: 'HELIOS_DIRECT_TPU', role: 'DIRECT_TPU_DISPATCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'udp://validator-leader-tpu:8003' },
        ];
        for (const d of defs) {
            this.metrics.set(d.id, {
                role: d.role,
                isAuthoritative: d.authoritative,
                configured: d.configured,
                enabled: d.enabled,
                authenticated: d.authenticated,
                transportReachable: false,
                observationValidated: false,
                sanitizedUrl: d.url,
                currentEndpointUrl: d.url,
                lastAttemptMs: 0,
                lastSuccessMs: 0,
                lastValidatedObservationMs: 0,
                rateLimitedUntilMs: 0,
                samples: [],
                circuitState: 'CLOSED',
                circuitTrippedAtMs: 0,
                consecutiveRecoveryObservations: 0,
                slotLag: null,
                lastFailureReason: null,
                totalRequests: 0,
                totalErrors: 0,
                circuitTripCount: 0,
            });
        }
    }
    setProviderConfiguration(providerId, configured, enabled, authenticated = false) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.configured = configured;
        entry.enabled = enabled;
        entry.authenticated = authenticated;
    }
    recordTransportReachable(providerId, reachable = true) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.transportReachable = reachable;
        if (!reachable) {
            entry.observationValidated = false;
        }
    }
    recordEndpointTransition(providerId, fromUrl, toUrl) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        if (fromUrl !== toUrl) {
            entry.currentEndpointUrl = toUrl;
            this.endpointTransitions.set(providerId, { from: fromUrl, to: toUrl, timestamp: Date.now() });
        }
    }
    recordValidatedObservation(providerId, latencyMs, slotLag, now = Date.now()) {
        const entry = this.metrics.get(providerId);
        if (!entry || !Number.isFinite(latencyMs) || latencyMs < 0)
            return;
        entry.lastAttemptMs = now;
        entry.lastSuccessMs = now;
        entry.lastValidatedObservationMs = now;
        entry.transportReachable = true;
        entry.observationValidated = true;
        entry.totalRequests++;
        entry.lastFailureReason = null;
        entry.rateLimitedUntilMs = 0;
        if (slotLag !== undefined && Number.isFinite(slotLag)) {
            entry.slotLag = slotLag;
        }
        // Add to rolling window
        entry.samples.push({ success: true, latencyMs, timestamp: now, validatedObservation: true });
        if (entry.samples.length > this.windowSize)
            entry.samples.shift();
        // Circuit state progression
        if (entry.circuitState === 'OPEN') {
            if (now - entry.circuitTrippedAtMs >= this.circuitCooldownMs) {
                entry.circuitState = 'PROBING';
                entry.consecutiveRecoveryObservations = 1;
            }
        }
        else if (entry.circuitState === 'PROBING') {
            entry.circuitState = 'RECOVERING';
            entry.consecutiveRecoveryObservations = 1;
        }
        else if (entry.circuitState === 'RECOVERING') {
            entry.consecutiveRecoveryObservations++;
            if (entry.consecutiveRecoveryObservations >= this.requiredRecoveryObservations) {
                entry.circuitState = 'HEALTHY';
                entry.consecutiveRecoveryObservations = 0;
            }
        }
        else if (entry.circuitState === 'DEGRADED') {
            const recentErrors = entry.samples.filter(s => !s.success).length;
            if (recentErrors === 0) {
                entry.circuitState = 'HEALTHY';
            }
        }
        else if (entry.circuitState === 'CLOSED') {
            entry.circuitState = 'HEALTHY';
        }
    }
    recordSuccess(providerId, latencyMs, slotLag, now = Date.now()) {
        // Default success records validated observation for backward compatibility
        this.recordValidatedObservation(providerId, latencyMs, slotLag, now);
    }
    recordFailure(providerId, reason = 'TRANSPORT_OR_DECODE_FAILURE', now = Date.now()) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.lastAttemptMs = now;
        entry.totalRequests++;
        entry.totalErrors++;
        entry.lastFailureReason = reason;
        entry.samples.push({ success: false, latencyMs: 0, timestamp: now, validatedObservation: false });
        if (entry.samples.length > this.windowSize)
            entry.samples.shift();
        // Calculate rolling window error rate
        const recentErrors = entry.samples.filter(s => !s.success).length;
        const windowErrorRate = entry.samples.length > 0 ? recentErrors / entry.samples.length : 0;
        if (entry.circuitState === 'PROBING' || entry.circuitState === 'RECOVERING') {
            // Immediate trip back to OPEN if failure occurs during recovery
            entry.circuitState = 'OPEN';
            entry.circuitTrippedAtMs = now;
            entry.consecutiveRecoveryObservations = 0;
            entry.circuitTripCount++;
        }
        else if (windowErrorRate >= 0.40 && entry.samples.length >= 5) {
            entry.circuitState = 'OPEN';
            entry.circuitTrippedAtMs = now;
            entry.consecutiveRecoveryObservations = 0;
            entry.circuitTripCount++;
        }
        else if (windowErrorRate > 0.15 || recentErrors >= 2) {
            entry.circuitState = 'DEGRADED';
        }
    }
    recordRateLimit(providerId, backoffMs = 15_000) {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        const now = Date.now();
        entry.lastAttemptMs = now;
        entry.totalRequests++;
        entry.totalErrors++;
        entry.rateLimitedUntilMs = now + backoffMs;
        entry.lastFailureReason = 'HTTP_429_RATE_LIMITED';
        entry.samples.push({ success: false, latencyMs: 0, timestamp: now, validatedObservation: false });
        if (entry.samples.length > this.windowSize)
            entry.samples.shift();
        entry.circuitState = 'DEGRADED';
    }
    async recordRateLimitAndPersist(providerId, backoffMs = 15_000, store) {
        this.recordRateLimit(providerId, backoffMs);
        if (store && typeof store.saveProviderQuota === 'function') {
            const entry = this.metrics.get(providerId);
            if (entry) {
                await store.saveProviderQuota({
                    providerId,
                    rateLimitedUntilMs: entry.rateLimitedUntilMs,
                    circuitState: entry.circuitState,
                    circuitTrippedAtMs: entry.circuitTrippedAtMs,
                    consecutiveRecovery: entry.consecutiveRecoveryObservations,
                    lastFailureReason: entry.lastFailureReason,
                });
            }
        }
    }
    exportDurableState() {
        const list = [];
        for (const [providerId, entry] of this.metrics.entries()) {
            if (entry.rateLimitedUntilMs > 0 || entry.circuitState !== 'CLOSED') {
                list.push({
                    providerId,
                    rateLimitedUntilMs: entry.rateLimitedUntilMs,
                    circuitState: entry.circuitState,
                    circuitTrippedAtMs: entry.circuitTrippedAtMs,
                    consecutiveRecovery: entry.consecutiveRecoveryObservations,
                    lastFailureReason: entry.lastFailureReason,
                });
            }
        }
        return list;
    }
    hydrateDurableState(records) {
        let count = 0;
        const now = Date.now();
        for (const r of records) {
            const providerId = String(r.providerId ?? r.provider_id ?? '');
            if (!providerId)
                continue;
            const entry = this.metrics.get(providerId);
            if (!entry)
                continue;
            const rateLimitUntil = Number(r.rateLimitedUntilMs ?? r.rate_limited_until_ms ?? 0);
            if (rateLimitUntil > now) {
                entry.rateLimitedUntilMs = rateLimitUntil;
                entry.circuitState = (r.circuitState ?? r.circuit_state ?? 'DEGRADED');
                entry.lastFailureReason = String(r.lastFailureReason ?? r.last_failure_reason ?? 'HTTP_429_RATE_LIMITED');
                count++;
            }
            else if (r.circuitState === 'OPEN') {
                entry.circuitState = 'OPEN';
                entry.circuitTrippedAtMs = Number(r.circuitTrippedAtMs ?? r.circuit_tripped_at_ms ?? now);
                entry.consecutiveRecoveryObservations = Number(r.consecutiveRecovery ?? r.consecutive_recovery ?? 0);
                entry.lastFailureReason = String(r.lastFailureReason ?? r.last_failure_reason ?? 'PREVIOUSLY_OPEN');
                count++;
            }
        }
        return count;
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
        // Only check active, configured, authoritative discovery and RPC feeds
        const pump = this.metrics.get('PUMPPORTAL_WS');
        if (!pump || !pump.configured || !pump.enabled || !pump.authenticated || !pump.observationValidated || !pump.transportReachable ||
            pump.lastSuccessMs === 0 ||
            now - pump.lastSuccessMs > thresholdMs ||
            pump.circuitState === 'OPEN' ||
            pump.rateLimitedUntilMs > now)
            return true;
        const rpc = this.metrics.get('SOLANA_RPC');
        if (!rpc || !rpc.configured || !rpc.enabled || !rpc.authenticated || !rpc.observationValidated || !rpc.transportReachable ||
            rpc.lastSuccessMs === 0 ||
            now - rpc.lastSuccessMs > thresholdMs ||
            rpc.circuitState === 'OPEN' ||
            rpc.rateLimitedUntilMs > now)
            return true;
        return false;
    }
    getReport(now = Date.now()) {
        const providers = {};
        const activeAlerts = [];
        let criticalCount = 0;
        let degradedCount = 0;
        for (const [id, m] of this.metrics.entries()) {
            // Inactive, unconfigured optional providers do not degrade the active platform
            if (!m.configured || !m.enabled) {
                providers[id] = {
                    providerId: id,
                    role: m.role,
                    configured: false,
                    enabled: false,
                    transportReachable: false,
                    authenticated: false,
                    capabilityAvailable: false,
                    observationValidated: false,
                    freshness: 'UNKNOWN',
                    slotLag: null,
                    latency: 0,
                    rateLimited: false,
                    circuitState: 'CLOSED',
                    lastAttempt: 0,
                    lastSuccess: 0,
                    lastValidatedObservation: 0,
                    failureReason: 'PROVIDER_NOT_CONFIGURED',
                    state: 'OFFLINE',
                    isAuthoritative: m.isAuthoritative,
                    lastSuccessTimestampMs: 0,
                    avgLatencyMs: 0,
                    errorRatePct: 0,
                    totalRequestsCount: 0,
                    totalErrorsCount: 0,
                    feedAgeMs: 0,
                    circuitBreakerTripped: false,
                    failoverActive: false,
                    endpointUrlSanitized: m.sanitizedUrl,
                };
                continue;
            }
            const feedAgeMs = Math.max(0, now - m.lastSuccessMs);
            const successfulSamples = m.samples.filter(s => s.success && s.latencyMs > 0);
            const avgLatency = successfulSamples.length
                ? Math.round(successfulSamples.reduce((a, b) => a + b.latencyMs, 0) / successfulSamples.length)
                : 0;
            const recentErrors = m.samples.filter(s => !s.success).length;
            const errorRate = m.samples.length > 0 ? (recentErrors / m.samples.length) * 100 : 0;
            // Freshness
            let freshness = 'UNKNOWN';
            if (m.lastSuccessMs === 0)
                freshness = 'UNKNOWN';
            else if (m.isAuthoritative) {
                freshness = feedAgeMs <= 10_000 ? 'FRESH' : 'STALE';
            }
            else {
                if (feedAgeMs <= 30_000)
                    freshness = 'FRESH';
                else if (feedAgeMs <= 45_000)
                    freshness = 'DEGRADED';
                else
                    freshness = 'STALE';
            }
            // ProviderHealthState mapping
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
            else if (m.circuitState === 'OPEN') {
                state = 'CIRCUIT_OPEN';
                criticalCount++;
                activeAlerts.push({
                    severity: 'CRITICAL',
                    source: id,
                    message: `Circuit breaker tripped for ${id}. Excessive rolling failure rate (${errorRate.toFixed(1)}%).`,
                    timestampMs: now,
                    actionRequired: 'Inspect network connection and API rate limits.',
                });
            }
            else if (m.lastSuccessMs === 0) {
                state = 'OFFLINE';
                if (m.isAuthoritative)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: m.isAuthoritative ? 'CRITICAL' : 'WARNING',
                    source: id,
                    message: `No successful provider observation has been received for ${id}.`,
                    timestampMs: now,
                });
            }
            else if (freshness === 'STALE') {
                state = 'STALE';
                if (m.isAuthoritative)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: m.isAuthoritative ? 'CRITICAL' : 'WARNING',
                    source: id,
                    message: `Feed data for ${id} is stale (${Math.round(feedAgeMs / 1000)}s since last tick).`,
                    timestampMs: now,
                    actionRequired: 'Trigger WebSocket reconnect or poll backup provider.',
                });
            }
            else if (errorRate > 15 || avgLatency > 500 || m.circuitState === 'DEGRADED' || m.circuitState === 'RECOVERING') {
                state = 'DEGRADED';
                degradedCount++;
                activeAlerts.push({
                    severity: 'NOTICE',
                    source: id,
                    message: `Provider ${id} latency or error rate elevated (${avgLatency}ms, ${errorRate.toFixed(1)}% errors, circuit: ${m.circuitState}).`,
                    timestampMs: now,
                });
            }
            else if (avgLatency > 150) {
                state = 'CONNECTED';
            }
            const transition = this.endpointTransitions.get(id);
            const failoverActive = Boolean(transition && now - transition.timestamp < 60_000);
            providers[id] = {
                providerId: id,
                role: m.role,
                configured: m.configured,
                enabled: m.enabled,
                transportReachable: m.transportReachable,
                authenticated: m.authenticated,
                capabilityAvailable: m.configured && m.enabled && m.authenticated && m.transportReachable && m.observationValidated && freshness === 'FRESH' && m.circuitState !== 'OPEN' && now >= m.rateLimitedUntilMs,
                observationValidated: m.observationValidated,
                freshness,
                slotLag: m.slotLag,
                latency: avgLatency,
                rateLimited: now < m.rateLimitedUntilMs,
                circuitState: m.circuitState,
                lastAttempt: m.lastAttemptMs,
                lastSuccess: m.lastSuccessMs,
                lastValidatedObservation: m.lastValidatedObservationMs,
                failureReason: m.lastFailureReason,
                state,
                isAuthoritative: m.isAuthoritative,
                lastSuccessTimestampMs: m.lastSuccessMs,
                avgLatencyMs: avgLatency,
                errorRatePct: Number(errorRate.toFixed(1)),
                totalRequestsCount: m.totalRequests,
                totalErrorsCount: m.totalErrors,
                feedAgeMs,
                circuitBreakerTripped: m.circuitState === 'OPEN',
                failoverActive,
                failoverProviderId: transition?.to,
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