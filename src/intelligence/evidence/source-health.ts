/**
 * SOL-SYLPH Source Trust and Provider Health Engine
 * Blueprint Part VI & REQ-004: Consolidated Provider Health Authority
 *
 * Tracks provider latency, slot lag, error rate, 429s, timeouts,
 * disagreement, missing sequences, staleness, and historical reliability.
 * Prevents double-counting correlated providers.
 *
 * Fully integrated with ProviderHealthTracker as single health authority,
 * enforcing fail-closed unobserved defaults (never optimistic defaults).
 */

import { ProviderHealthTracker, type ProviderMetricEntry, type ProviderHealthState } from '../../platform/ingestion/provider-health.js';

export type ProviderClass =
  | 'ON_CHAIN'
  | 'RPC'
  | 'DEX_INDEXER'
  | 'ROUTER'
  | 'SECURITY_PROVIDER'
  | 'WALLET_ANALYTICS'
  | 'SOCIAL'
  | 'INTERNAL_MODEL';

export type ProviderHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'DISCONNECTED';

export interface SourceHealthMetrics {
  readonly sourceId: string;
  readonly providerClass: ProviderClass;
  readonly correlationGroup: string; // Prevents double-counting providers in the same infrastructure cluster
  latencyMs: number;
  slotLag: number;
  errorRate: number; // 0.0 - 1.0
  http429Count: number;
  timeoutsCount: number;
  disagreementsCount: number;
  missingSequencesCount: number;
  stalenessMs: number;
  historicalReliability: number; // 0.0 - 1.0 EWMA
  lastSeenMs: number;
  totalRequests: number;
  successfulRequests: number;
}

export class SourceHealthEngine {
  private readonly sources = new Map<string, SourceHealthMetrics>();
  private readonly providerHealthTracker?: ProviderHealthTracker;

  public static readonly SOURCE_TO_PROVIDER_MAP: Record<string, string> = {
    solana_rpc_primary: 'SOLANA_RPC',
    solana_rpc_backup: 'SOLANA_RPC',
    pump_portal_ws: 'PUMPPORTAL_WS',
    dexscreener_api: 'DEXSCREENER_API',
    jupiter_router: 'JUPITER_QUOTE',
    rugcheck_api: 'RUGCHECK_API',
    helios_direct_tpu: 'HELIOS_DIRECT_TPU',
  };

  constructor(tracker?: ProviderHealthTracker) {
    this.providerHealthTracker = tracker;
    this.registerSource('solana_rpc_primary', 'RPC', 'rpc_cluster_solana');
    this.registerSource('solana_rpc_backup', 'RPC', 'rpc_cluster_solana');
    this.registerSource('pump_portal_ws', 'ON_CHAIN', 'pump_infra');
    this.registerSource('dexscreener_api', 'DEX_INDEXER', 'dex_screener');
    this.registerSource('jupiter_router', 'ROUTER', 'jupiter_infra');
    this.registerSource('rugcheck_api', 'SECURITY_PROVIDER', 'security_rugcheck');
    this.registerSource('solana_tracker_api', 'WALLET_ANALYTICS', 'tracker_infra');
  }

  public getProviderHealthTracker(): ProviderHealthTracker | undefined {
    return this.providerHealthTracker;
  }

  public registerSource(sourceId: string, providerClass: ProviderClass, correlationGroup: string): void {
    if (!this.sources.has(sourceId)) {
      // Fail-closed unobserved defaults: 0 total requests, 0 reliability, 0 lastSeen.
      // Optimistic 1.0 defaults are strictly eliminated.
      this.sources.set(sourceId, {
        sourceId,
        providerClass,
        correlationGroup,
        latencyMs: 0,
        slotLag: 0,
        errorRate: 0.0,
        http429Count: 0,
        timeoutsCount: 0,
        disagreementsCount: 0,
        missingSequencesCount: 0,
        stalenessMs: 0,
        historicalReliability: 0.0,
        lastSeenMs: 0,
        totalRequests: 0,
        successfulRequests: 0,
      });
    }
  }

  public recordResponse(sourceId: string, latencyMs: number, slotLag: number = 0, success: boolean = true): void {
    const s = this.sources.get(sourceId);
    if (!s) return;
    s.totalRequests++;
    if (success) s.successfulRequests++;
    s.lastSeenMs = Date.now();
    s.latencyMs = s.totalRequests === 1 ? latencyMs : Math.round(s.latencyMs * 0.8 + latencyMs * 0.2);
    s.slotLag = s.totalRequests === 1 ? slotLag : Math.round(s.slotLag * 0.8 + slotLag * 0.2);
    s.errorRate = (s.totalRequests - s.successfulRequests) / Math.max(1, s.totalRequests);
    const stepReliability = success ? 1.0 : 0.0;
    s.historicalReliability = s.totalRequests === 1 ? stepReliability : (s.historicalReliability * 0.95 + stepReliability * 0.05);
  }

  public recordError(sourceId: string, type: 'TIMEOUT' | '429' | 'SCHEMA' | 'DISAGREEMENT' | 'SEQUENCE_GAP'): void {
    const s = this.sources.get(sourceId);
    if (!s) return;
    s.totalRequests++;
    s.errorRate = (s.totalRequests - s.successfulRequests) / Math.max(1, s.totalRequests);
    s.historicalReliability = Math.max(0.0, s.historicalReliability * 0.9);
    if (type === '429') s.http429Count++;
    if (type === 'TIMEOUT') s.timeoutsCount++;
    if (type === 'DISAGREEMENT') s.disagreementsCount++;
    if (type === 'SEQUENCE_GAP') s.missingSequencesCount++;
  }

  public syncFromProviderHealthTracker(now = Date.now()): void {
    if (!this.providerHealthTracker) return;
    const report = this.providerHealthTracker.getReport(now);
    for (const [sourceId, providerId] of Object.entries(SourceHealthEngine.SOURCE_TO_PROVIDER_MAP)) {
      const metric: ProviderMetricEntry | undefined = report.providers[providerId];
      if (metric && metric.totalRequestsCount > 0) {
        const s = this.sources.get(sourceId);
        if (s) {
          s.latencyMs = metric.avgLatencyMs;
          s.errorRate = metric.errorRatePct / 100;
          s.totalRequests = metric.totalRequestsCount;
          s.successfulRequests = metric.totalRequestsCount - metric.totalErrorsCount;
          s.lastSeenMs = metric.lastSuccessTimestampMs || now;
          s.historicalReliability = metric.observationValidated ? Math.max(0.0, 1.0 - (metric.errorRatePct / 100)) : 0.0;
          if (metric.rateLimited) s.http429Count++;
        }
      }
    }
  }

  public getHealthStatus(sourceId: string): ProviderHealthStatus {
    const s = this.sources.get(sourceId);
    // Unregistered or unobserved sources fail closed as DISCONNECTED
    if (!s || s.totalRequests === 0) return 'DISCONNECTED';

    // If backed by authoritative ProviderHealthTracker, check upstream status
    if (this.providerHealthTracker) {
      const providerId = SourceHealthEngine.SOURCE_TO_PROVIDER_MAP[sourceId];
      if (providerId) {
        const report = this.providerHealthTracker.getReport();
        const metric = report.providers[providerId];
        if (metric) {
          if (!metric.transportReachable || metric.circuitState === 'OPEN' || metric.state === 'OFFLINE' || metric.state === 'CIRCUIT_OPEN') {
            return 'DISCONNECTED';
          }
          if (metric.rateLimited || metric.circuitState === 'DEGRADED' || metric.state === 'RATE_LIMITED') {
            return 'UNHEALTHY';
          }
          if (metric.freshness === 'STALE' || metric.freshness === 'DEGRADED' || metric.state === 'STALE' || metric.state === 'DEGRADED') {
            return 'DEGRADED';
          }
        }
      }
    }

    const age = Date.now() - s.lastSeenMs;
    if (age > 60000 || s.errorRate > 0.5 || s.historicalReliability < 0.4) return 'UNHEALTHY';
    if (age > 15000 || s.errorRate > 0.15 || s.latencyMs > 1500 || s.slotLag > 5) return 'DEGRADED';
    return 'HEALTHY';
  }

  public getIndependentConfirmationScore(sourceIds: string[]): number {
    const activeGroups = new Set<string>();
    let totalReliability = 0;
    let counted = 0;

    for (const sid of sourceIds) {
      const s = this.sources.get(sid);
      if (s && this.getHealthStatus(sid) !== 'UNHEALTHY' && this.getHealthStatus(sid) !== 'DISCONNECTED') {
        if (!activeGroups.has(s.correlationGroup)) {
          activeGroups.add(s.correlationGroup);
          totalReliability += s.historicalReliability;
          counted++;
        }
      }
    }

    if (counted === 0) return 0;
    // Multi-group diversity bonus
    const diversityMultiplier = Math.min(1.0, activeGroups.size / 3.0);
    return Math.min(1.0, (totalReliability / counted) * diversityMultiplier);
  }

  public getAllMetrics(): readonly SourceHealthMetrics[] {
    return Array.from(this.sources.values());
  }
}
