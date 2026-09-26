/**
 * SOL-SYLPH Source Trust and Provider Health Engine
 * Blueprint Part VI
 *
 * Tracks provider latency, slot lag, error rate, 429s, timeouts,
 * disagreement, missing sequences, staleness, and historical reliability.
 * Prevents double-counting correlated providers.
 */
export class SourceHealthEngine {
    sources = new Map();
    constructor() {
        this.registerSource('solana_rpc_primary', 'RPC', 'rpc_cluster_solana');
        this.registerSource('solana_rpc_backup', 'RPC', 'rpc_cluster_solana');
        this.registerSource('pump_portal_ws', 'ON_CHAIN', 'pump_infra');
        this.registerSource('dexscreener_api', 'DEX_INDEXER', 'dex_screener');
        this.registerSource('jupiter_router', 'ROUTER', 'jupiter_infra');
        this.registerSource('rugcheck_api', 'SECURITY_PROVIDER', 'security_rugcheck');
        this.registerSource('solana_tracker_api', 'WALLET_ANALYTICS', 'tracker_infra');
    }
    registerSource(sourceId, providerClass, correlationGroup) {
        if (!this.sources.has(sourceId)) {
            this.sources.set(sourceId, {
                sourceId,
                providerClass,
                correlationGroup,
                latencyMs: 50,
                slotLag: 0,
                errorRate: 0.0,
                http429Count: 0,
                timeoutsCount: 0,
                disagreementsCount: 0,
                missingSequencesCount: 0,
                stalenessMs: 0,
                historicalReliability: 1.0,
                lastSeenMs: Date.now(),
                totalRequests: 0,
                successfulRequests: 0,
            });
        }
    }
    recordResponse(sourceId, latencyMs, slotLag = 0, success = true) {
        const s = this.sources.get(sourceId);
        if (!s)
            return;
        s.totalRequests++;
        if (success)
            s.successfulRequests++;
        s.lastSeenMs = Date.now();
        s.latencyMs = Math.round(s.latencyMs * 0.8 + latencyMs * 0.2);
        s.slotLag = Math.round(s.slotLag * 0.8 + slotLag * 0.2);
        s.errorRate = (s.totalRequests - s.successfulRequests) / Math.max(1, s.totalRequests);
        const stepReliability = success ? 1.0 : 0.0;
        s.historicalReliability = s.historicalReliability * 0.95 + stepReliability * 0.05;
    }
    recordError(sourceId, type) {
        const s = this.sources.get(sourceId);
        if (!s)
            return;
        s.totalRequests++;
        s.errorRate = (s.totalRequests - s.successfulRequests) / Math.max(1, s.totalRequests);
        s.historicalReliability = Math.max(0.0, s.historicalReliability * 0.9);
        if (type === '429')
            s.http429Count++;
        if (type === 'TIMEOUT')
            s.timeoutsCount++;
        if (type === 'DISAGREEMENT')
            s.disagreementsCount++;
        if (type === 'SEQUENCE_GAP')
            s.missingSequencesCount++;
    }
    getHealthStatus(sourceId) {
        const s = this.sources.get(sourceId);
        if (!s)
            return 'DISCONNECTED';
        const age = Date.now() - s.lastSeenMs;
        if (age > 60000 || s.errorRate > 0.5 || s.historicalReliability < 0.4)
            return 'UNHEALTHY';
        if (age > 15000 || s.errorRate > 0.15 || s.latencyMs > 1500 || s.slotLag > 5)
            return 'DEGRADED';
        return 'HEALTHY';
    }
    getIndependentConfirmationScore(sourceIds) {
        const activeGroups = new Set();
        let totalReliability = 0;
        let counted = 0;
        for (const sid of sourceIds) {
            const s = this.sources.get(sid);
            if (s && this.getHealthStatus(sid) !== 'UNHEALTHY') {
                if (!activeGroups.has(s.correlationGroup)) {
                    activeGroups.add(s.correlationGroup);
                    totalReliability += s.historicalReliability;
                    counted++;
                }
            }
        }
        if (counted === 0)
            return 0;
        // Multi-group diversity bonus
        const diversityMultiplier = Math.min(1.0, activeGroups.size / 3.0);
        return Math.min(1.0, (totalReliability / counted) * diversityMultiplier);
    }
    getAllMetrics() {
        return Array.from(this.sources.values());
    }
}
//# sourceMappingURL=source-health.js.map