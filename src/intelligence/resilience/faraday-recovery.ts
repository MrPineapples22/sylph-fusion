/**
 * FARADAY: Resilience & Autonomous Recovery Engine
 * Blueprint Engine #32
 * 
 * Maintains a live dependency graph across 5 operational tiers:
 * - P0 SAFETY (Guardian, Sentinel, Gauss, Hypatia)
 * - P1 EXECUTION (Von Neumann, Hermes, RPC Submitter)
 * - P2 INTELLIGENCE (Bohr, Kepler, Bayes, Hawking, Curie)
 * - P3 ENRICHMENT (DexScreener, RugCheck, Newton Graph)
 * - P4 RESEARCH (Franklin, Da Vinci, Offline Replay)
 * 
 * Manages system operational modes:
 * NORMAL | DEGRADED | DEFENSIVE | SURVIVAL | EXECUTION_HALT.
 * Non-negotiable rule: If P0 Safety fails, system fails closed to EXECUTION_HALT.
 */

export type FaradayPriorityTier = 'P0_SAFETY' | 'P1_EXECUTION' | 'P2_INTELLIGENCE' | 'P3_ENRICHMENT' | 'P4_RESEARCH';

export type FaradaySystemMode = 'NORMAL' | 'DEGRADED' | 'DEFENSIVE' | 'SURVIVAL' | 'EXECUTION_HALT';

export interface SubsystemHealth {
  readonly name: string;
  readonly tier: FaradayPriorityTier;
  readonly is_healthy: boolean;
  readonly latency_ms: number;
  readonly last_heartbeat_ms: number;
  readonly error_count: number;
  readonly failure_reason?: string;
}

export class FaradayResilienceEngine {
  public static readonly VERSION = '1.0.0';
  private subsystemRegistry: Map<string, SubsystemHealth> = new Map();

  public registerSubsystem(name: string, tier: FaradayPriorityTier): void {
    this.subsystemRegistry.set(name, {
      name,
      tier,
      is_healthy: true,
      latency_ms: 0,
      last_heartbeat_ms: Date.now(),
      error_count: 0
    });
  }

  public reportHeartbeat(name: string, latencyMs: number, errorReason?: string): void {
    const existing = this.subsystemRegistry.get(name);
    if (!existing) return;

    const isHealthy = !errorReason;
    this.subsystemRegistry.set(name, {
      ...existing,
      is_healthy: isHealthy,
      latency_ms: latencyMs,
      last_heartbeat_ms: Date.now(),
      error_count: isHealthy ? 0 : existing.error_count + 1,
      failure_reason: errorReason
    });
  }

  /**
   * Evaluates aggregate system resilience and computes the authoritative operational mode.
   */
  public evaluateSystemMode(maxStaleHeartbeatMs: number = 30000): {
    readonly mode: FaradaySystemMode;
    readonly reason: string;
    readonly p0_healthy: boolean;
    readonly p1_healthy: boolean;
    readonly p2_healthy: boolean;
  } {
    const now = Date.now();
    let p0Healthy = true;
    let p1Healthy = true;
    let p2Healthy = true;
    let p3Healthy = true;

    const unhealthyP0: string[] = [];
    const unhealthyP1: string[] = [];

    for (const sub of this.subsystemRegistry.values()) {
      const isStale = (now - sub.last_heartbeat_ms) > maxStaleHeartbeatMs;
      const isUp = sub.is_healthy && !isStale;

      if (!isUp) {
        if (sub.tier === 'P0_SAFETY') {
          p0Healthy = false;
          unhealthyP0.push(sub.name);
        } else if (sub.tier === 'P1_EXECUTION') {
          p1Healthy = false;
          unhealthyP1.push(sub.name);
        } else if (sub.tier === 'P2_INTELLIGENCE') {
          p2Healthy = false;
        } else if (sub.tier === 'P3_ENRICHMENT') {
          p3Healthy = false;
        }
      }
    }

    // Hard fail-closed invariant
    if (!p0Healthy) {
      return {
        mode: 'EXECUTION_HALT',
        reason: `P0 Safety Failure: Non-responsive safety subsystems [${unhealthyP0.join(', ')}]. Immediate fail-closed.`,
        p0_healthy: false,
        p1_healthy: p1Healthy,
        p2_healthy: p2Healthy
      };
    }

    if (!p1Healthy) {
      return {
        mode: 'DEFENSIVE',
        reason: `P1 Execution Disruption: [${unhealthyP1.join(', ')}]. Halting new orders, maintaining live positions.`,
        p0_healthy: true,
        p1_healthy: false,
        p2_healthy: p2Healthy
      };
    }

    if (!p2Healthy) {
      return {
        mode: 'DEGRADED',
        reason: 'P2 Intelligence subsystems degraded. Conservative sizing and higher confirmation thresholds applied.',
        p0_healthy: true,
        p1_healthy: true,
        p2_healthy: false
      };
    }

    if (!p3Healthy) {
      return {
        mode: 'DEGRADED',
        reason: 'P3 Enrichment APIs experiencing rate limits or timeouts. Operating on on-chain telemetry.',
        p0_healthy: true,
        p1_healthy: true,
        p2_healthy: true
      };
    }

    return {
      mode: 'NORMAL',
      reason: 'All priority tiers operating within nominal parameters.',
      p0_healthy: true,
      p1_healthy: true,
      p2_healthy: true
    };
  }
}
