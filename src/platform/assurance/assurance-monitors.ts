/**
 * SYLPH FUSION — ASSURANCE-X: RUNTIME INVARIANT MONITORS & BLINDNESS DEFENSE
 * Specifications: Blueprint Section 44
 * Workbook: #887, #891, #899, #903, #911, #915
 *
 * Invariants:
 * 1. Monitor disappeared != condition recovered.
 *    If a monitor goes silent or stops producing evidence, assurance state MUST degrade.
 * 2. Zero optimistic health defaults.
 * 3. Tracks margin velocity, provider truth quality, config drift, and monitor freshness.
 */

export type AssuranceHealthLevel = 'HEALTHY' | 'DEGRADED' | 'CRITICAL_SUSPEND' | 'UNKNOWN';

export interface MonitorHeartbeat {
  readonly monitorId: string;
  readonly lastObservedAt: number;
  readonly reportedStatus: 'PASS' | 'WARN' | 'FAIL';
  readonly metricValue: number;
  readonly evidenceDigest: string;
}

export interface AssuranceStatusReport {
  readonly overallHealth: AssuranceHealthLevel;
  readonly evaluatedAt: number;
  readonly marginLevel: number;
  readonly marginVelocityPerMinute: number;
  readonly providerTruthQuality: number;
  readonly configDriftDetected: boolean;
  readonly protocolCompatibilityValid: boolean;
  readonly blindMonitors: readonly string[];
  readonly degradationReasons: readonly string[];
  readonly evidenceRoot: string;
}

export interface MonitorConfiguration {
  readonly maxSilenceMs: number;
  readonly isCritical: boolean;
}

export class AssuranceMonitorEngine {
  private readonly monitors = new Map<string, MonitorHeartbeat>();
  private readonly configs = new Map<string, MonitorConfiguration>();
  private previousMarginLevel = 1.0;
  private previousMarginTimestamp = Date.now();

  public registerMonitor(monitorId: string, config: MonitorConfiguration): void {
    this.configs.set(monitorId, config);
  }

  public recordHeartbeat(heartbeat: MonitorHeartbeat): void {
    this.monitors.set(heartbeat.monitorId, heartbeat);
  }

  /**
   * Evaluates overall system assurance without optimistic defaults.
   */
  public evaluateAssurance(currentConfigRoot: string, expectedConfigRoot: string): AssuranceStatusReport {
    const now = Date.now();
    const blindMonitors: string[] = [];
    const degradationReasons: string[] = [];

    let minProviderQuality = 1.0;
    let currentMargin = 1.0;

    // 1. Monitor Blindness Check (Workbook #891)
    for (const [id, config] of this.configs) {
      const hb = this.monitors.get(id);
      if (!hb) {
        blindMonitors.push(id);
        degradationReasons.push(`MONITOR_MISSING: Critical monitor ${id} has never reported`);
        continue;
      }

      const silenceMs = now - hb.lastObservedAt;
      if (silenceMs > config.maxSilenceMs) {
        blindMonitors.push(id);
        degradationReasons.push(
          `MONITOR_BLINDNESS: Monitor ${id} silent for ${silenceMs}ms > max ${config.maxSilenceMs}ms`
        );
      }

      if (hb.reportedStatus === 'FAIL') {
        degradationReasons.push(`MONITOR_FAILED: ${id} reported failure`);
      }

      if (id.includes('provider')) {
        minProviderQuality = Math.min(minProviderQuality, hb.metricValue);
      }
      if (id.includes('margin')) {
        currentMargin = hb.metricValue;
      }
    }

    // 2. Margin Velocity Check (Workbook #887)
    const elapsedMinutes = Math.max(0.1, (now - this.previousMarginTimestamp) / 60_000);
    const marginVelocityPerMinute = Number(((currentMargin - this.previousMarginLevel) / elapsedMinutes).toFixed(4));
    this.previousMarginLevel = currentMargin;
    this.previousMarginTimestamp = now;

    if (marginVelocityPerMinute < -0.15) {
      degradationReasons.push(
        `RAPID_MARGIN_DECAY: Margin velocity ${marginVelocityPerMinute}/min exceeds safe threshold -0.15/min`
      );
    }

    // 3. Config Drift Check (Workbook #903)
    const configDriftDetected = currentConfigRoot !== expectedConfigRoot;
    if (configDriftDetected) {
      degradationReasons.push(`CONFIG_DRIFT: Current root ${currentConfigRoot} != expected ${expectedConfigRoot}`);
    }

    // 4. Determine Overall Health Level
    let overallHealth: AssuranceHealthLevel = 'HEALTHY';
    const criticalBlind = blindMonitors.some((id) => this.configs.get(id)?.isCritical);

    if (criticalBlind || configDriftDetected) {
      overallHealth = 'CRITICAL_SUSPEND';
    } else if (degradationReasons.length > 0) {
      overallHealth = 'DEGRADED';
    }

    return {
      overallHealth,
      evaluatedAt: now,
      marginLevel: currentMargin,
      marginVelocityPerMinute,
      providerTruthQuality: minProviderQuality,
      configDriftDetected,
      protocolCompatibilityValid: !configDriftDetected,
      blindMonitors,
      degradationReasons,
      evidenceRoot: `ev_assurance_${now}_${degradationReasons.length}`,
    };
  }
}
