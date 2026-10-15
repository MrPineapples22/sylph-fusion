/**
 * SOL-SYLPH Platform - Provider Health, Reliability & Capability Engine
 * Specifications: Sections 12, 14, 15, 34, 43, 51.
 *
 * Implements:
 * 1. Provider Capability Model with separate authentication state and requirement.
 * 2. Strict separation: Transport Reachability != Market Observation Validity.
 * 3. Bounded Rolling-Window Circuit Breaker (CLOSED -> DEGRADED -> OPEN -> PROBING -> RECOVERING -> HEALTHY).
 *    Recovery requires at least 3 consecutive validated observations.
 * 4. Actual endpoint transition recording for failovers.
 * 5. Aggregate health evaluates ONLY providers configured for the active capability.
 */
function authSatisfied(requirement, authenticated) {
    return requirement === 'NOT_REQUIRED' || (requirement === 'REQUIRED' && authenticated === true);
}
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
            { id: 'GOPLUS_SOLANA_SECURITY', role: 'SECURITY_RISK', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.gopluslabs.io/api/v1/solana/token_security' },
            { id: 'JUPITER_QUOTE', role: 'QUOTE_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.jup.ag/swap/v2/order' },
            { id: 'MAYAN_QUOTE', role: 'CROSS_CHAIN_QUOTE', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://price-api.mayan.finance/v3/quote' },
            { id: 'BIRDEYE_API', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://public-api.birdeye.so/defi/token_overview' },
            { id: 'RAYDIUM_API_V3', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api-v3.raydium.io/pools/info/list-v2' },
            { id: 'METEORA_DLMM_API', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://dlmm.datapi.meteora.ag/pools' },
            { id: 'GECKOTERMINAL_API_V2', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.geckoterminal.com/api/v2/networks/solana/tokens' },
            { id: 'SHYFT_TOKEN_INFO', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.shyft.to/sol/v1/token/get_info' },
            { id: 'CIELO_SOLANA_FEED', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://feed-api.cielo.finance/api/v1/feed' },
            // These research adapters are not polled by the Core Engine. The
            // separate research surface must register them only when it actually
            // performs a provider request; otherwise they create permanent false
            // critical alerts in this process.
            { id: 'POLYMARKET_GAMMA', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://gamma-api.polymarket.com/public-search' },
            { id: 'POLYMARKET_CLOB', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://clob.polymarket.com/midpoints' },
            { id: 'AAVE_V3_GRAPHQL', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.v3.aave.com/graphql' },
            { id: 'MORPHO_GRAPHQL', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://api.morpho.org/graphql' },
            { id: 'SCALLOP_SDK_INDEXER', role: 'MARKET_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://sdk.api.scallop.io/api/market/migrate' },
            { id: 'JITO_TIP_FLOOR', role: 'TIP_FLOOR_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://bundles.jito.wtf/api/v1/bundles/tip_floor' },
            { id: 'STREAMFLOW_RPC', role: 'LOCKUP_RESEARCH', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://streamflow.invalid/rpc-research' },
            { id: 'JITO_BLOCK_ENGINE', role: 'BUNDLE_DELIVERY', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://mainnet.block-engine.jito.wtf/api/v1/bundles' },
            { id: 'YELLOWSTONE_GRPC', role: 'GEYSER_STREAM', authoritative: false, configured: false, enabled: false, authenticated: false, url: 'https://yellowstone-grpc.invalid' },
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
                authenticationRequirement: 'UNKNOWN',
                authenticated: d.authenticated,
                transportReachable: false,
                observationValidated: false,
                capabilityValidated: false,
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
    setProviderConfiguration(providerId, configured, enabled, authenticated = false, authenticationRequirement = 'UNKNOWN') {
        const entry = this.metrics.get(providerId);
        if (!entry)
            return;
        entry.configured = configured === true;
        entry.enabled = enabled === true;
        entry.authenticationRequirement = authenticationRequirement === 'REQUIRED' || authenticationRequirement === 'NOT_REQUIRED'
            ? authenticationRequirement
            : 'UNKNOWN';
        entry.authenticated = authenticated === true;
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
            const sanitize = (value) => {
                try {
                    const url = new URL(value);
                    url.username = '';
                    url.password = '';
                    url.search = '';
                    url.hash = '';
                    return url.pathname === '/' ? url.origin : `${url.origin}${url.pathname}`;
                }
                catch {
                    return 'INVALID_ENDPOINT';
                }
            };
            entry.sanitizedUrl = sanitize(toUrl);
            this.endpointTransitions.set(providerId, { from: sanitize(fromUrl), to: entry.sanitizedUrl, timestamp: Date.now() });
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
        entry.capabilityValidated = true;
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
    /** Records a validated endpoint check without claiming the provider's named service capability. */
    recordConnectivityObservation(providerId, latencyMs, now = Date.now()) {
        if (!Number.isFinite(latencyMs) || latencyMs < 0)
            return;
        this.recordValidatedObservation(providerId, latencyMs, undefined, now);
        const entry = this.metrics.get(providerId);
        if (entry && entry.lastAttemptMs === now)
            entry.capabilityValidated = false;
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
        // Discovery can arrive through PumpPortal or the Engine's own Solana
        // websocket. Require at least one configured, authenticated, fresh source
        // instead of treating optional PumpPortal as mandatory.
        const pump = this.metrics.get('PUMPPORTAL_WS');
        const wss = this.metrics.get('SOLANA_WSS');
        const discoverySources = [pump, wss].filter((source) => Boolean(source?.configured && source.enabled));
        const hasFreshDiscovery = discoverySources.some(source => authSatisfied(source.authenticationRequirement, source.authenticated) &&
            source.observationValidated && source.transportReachable && source.lastSuccessMs > 0 &&
            now - source.lastSuccessMs <= thresholdMs && source.circuitState !== 'OPEN' && source.rateLimitedUntilMs <= now);
        if (!hasFreshDiscovery)
            return true;
        const rpc = this.metrics.get('SOLANA_RPC');
        if (!rpc || !rpc.configured || !rpc.enabled || !authSatisfied(rpc.authenticationRequirement, rpc.authenticated) || !rpc.observationValidated || !rpc.transportReachable ||
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
                    configured: m.configured,
                    enabled: m.enabled,
                    authenticationRequirement: m.configured ? m.authenticationRequirement : 'UNKNOWN',
                    transportReachable: false,
                    authenticated: false,
                    capabilityAvailable: false,
                    observationValidated: false,
                    capabilityValidated: false,
                    attempted: m.lastAttemptMs > 0,
                    freshness: 'UNKNOWN',
                    slotLag: null,
                    latency: 0,
                    rateLimited: false,
                    circuitState: 'CLOSED',
                    lastAttempt: m.lastAttemptMs,
                    lastSuccess: m.lastSuccessMs,
                    lastValidatedObservation: m.lastValidatedObservationMs,
                    failureReason: m.configured ? (m.enabled ? 'NOT_YET_OBSERVED' : 'PROVIDER_DISABLED') : 'PROVIDER_NOT_CONFIGURED',
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
                const globallyCritical = id === 'SOLANA_RPC';
                if (globallyCritical)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: globallyCritical ? 'CRITICAL' : 'WARNING',
                    source: id,
                    message: `Provider ${id} rate limited (HTTP 429). Backing off for ${Math.round((m.rateLimitedUntilMs - now) / 1000)}s.`,
                    timestampMs: now,
                    actionRequired: 'Throttle request rate or configure dedicated API key.',
                });
            }
            else if (m.circuitState === 'OPEN') {
                state = 'CIRCUIT_OPEN';
                const globallyCritical = id === 'SOLANA_RPC';
                if (globallyCritical)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: globallyCritical ? 'CRITICAL' : 'WARNING',
                    source: id,
                    message: `Circuit breaker tripped for ${id}. Excessive rolling failure rate (${errorRate.toFixed(1)}%).`,
                    timestampMs: now,
                    actionRequired: 'Inspect network connection and API rate limits.',
                });
            }
            else if (m.lastSuccessMs === 0) {
                state = 'OFFLINE';
                if (m.lastAttemptMs > 0) {
                    const globallyCritical = id === 'SOLANA_RPC';
                    if (globallyCritical)
                        criticalCount++;
                    else
                        degradedCount++;
                    activeAlerts.push({
                        severity: globallyCritical ? 'CRITICAL' : 'WARNING',
                        source: id,
                        message: `Provider ${id} has been attempted but has no successful observation.`,
                        timestampMs: now,
                    });
                }
            }
            else if (!m.transportReachable) {
                state = 'RECONNECTING';
                degradedCount++;
                activeAlerts.push({
                    severity: 'NOTICE',
                    source: id,
                    message: `Provider ${id} has prior validated observations but its transport is disconnected.`,
                    timestampMs: now,
                    actionRequired: 'Wait for the provider reconnect loop and confirm a new validated observation.',
                });
            }
            else if (freshness === 'STALE') {
                state = 'STALE';
                const globallyCritical = id === 'SOLANA_RPC';
                if (globallyCritical)
                    criticalCount++;
                else
                    degradedCount++;
                activeAlerts.push({
                    severity: globallyCritical ? 'CRITICAL' : 'WARNING',
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
                authenticationRequirement: m.authenticationRequirement,
                transportReachable: m.transportReachable,
                authenticated: m.authenticated,
                capabilityAvailable: m.configured && m.enabled && authSatisfied(m.authenticationRequirement, m.authenticated) && m.transportReachable && m.observationValidated && m.capabilityValidated && freshness === 'FRESH' && m.circuitState !== 'OPEN' && now >= m.rateLimitedUntilMs,
                observationValidated: m.observationValidated,
                capabilityValidated: m.capabilityValidated,
                attempted: m.lastAttemptMs > 0,
                freshness,
                slotLag: m.slotLag,
                latency: avgLatency,
                rateLimited: now < m.rateLimitedUntilMs,
                circuitState: m.circuitState,
                lastAttempt: m.lastAttemptMs,
                lastSuccess: m.lastSuccessMs,
                lastValidatedObservation: m.lastValidatedObservationMs,
                failureReason: m.lastFailureReason ?? (m.lastAttemptMs === 0 ? 'NOT_YET_OBSERVED' : null),
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
        if (marketFeedStale) {
            activeAlerts.push({
                severity: 'CRITICAL',
                source: 'MARKET_FEED_GATE',
                message: 'Required fresh discovery and SOLANA_RPC observations are not both available.',
                timestampMs: now,
                actionRequired: 'Restore a configured fresh discovery source and a fresh SOLANA_RPC observation.',
            });
        }
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