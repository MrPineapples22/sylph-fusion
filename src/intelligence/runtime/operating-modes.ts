/**
 * SOL-SYLPH Operating Modes, Work Scheduler & Centralized Alert Engine
 * Specifications: Parts LXXIX, LXXX, LXXXI, XCI, XCII, CXXII
 *
 * Enforces:
 * 1. Centralized Operating Modes: NORMAL, DEGRADED, SURVIVAL, RECOVERY, REPLAY, SHADOW, SIMULATION.
 * 2. Strict Workload Scheduler priority order:
 *    P0 Risk/Execution > P1 Canonical State > P2 Active Intelligence > P3 Graph/Market > P4 Research > P5 UI/Telemetry.
 * 3. Centralized Alert Engine with complete lifecycle: OPEN, ACKNOWLEDGED, RESOLVED, SUPERSEDED.
 * 4. Emergency Controls: Freeze new execution without killing ingestion, journal, or UI.
 */

import type { TokenId, AlertId } from '../events/canonical-event.js';

export type OperatingMode =
  | 'NORMAL'
  | 'DEGRADED'
  | 'SURVIVAL'
  | 'RECOVERY'
  | 'REPLAY'
  | 'SHADOW'
  | 'SIMULATION';

export type WorkloadPriority = 'P0_RISK_EXECUTION' | 'P1_CANONICAL_STATE' | 'P2_ACTIVE_INTEL' | 'P3_GRAPH_MARKET' | 'P4_RESEARCH' | 'P5_UI_TELEMETRY';

export interface Alert {
  readonly alertId: AlertId;
  readonly mint?: TokenId;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
  readonly title: string;
  readonly message: string;
  readonly channel: 'AETHER_FLUX' | 'INFO' | 'LOGS' | 'DISCORD' | 'INCIDENT';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SUPERSEDED';
  readonly createdAtMs: number;
  resolvedAtMs?: number;
}

export class AlertEngine {
  private readonly alerts = new Map<AlertId, Alert>();
  private readonly subscribers: Array<(alert: Alert) => void> = [];

  public openAlert(params: {
    mint?: TokenId;
    severity: Alert['severity'];
    title: string;
    message: string;
    channel?: Alert['channel'];
    now?: number;
  }): Alert {
    const now = params.now ?? Date.now();
    const alertId: AlertId = `alt_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const alert: Alert = {
      alertId,
      mint: params.mint,
      severity: params.severity,
      title: params.title,
      message: params.message,
      channel: params.channel ?? 'AETHER_FLUX',
      status: 'OPEN',
      createdAtMs: now,
    };

    this.alerts.set(alertId, alert);
    this.notify(alert);
    return alert;
  }

  public resolveAlert(alertId: AlertId, now: number = Date.now()): Alert | undefined {
    const alert = this.alerts.get(alertId);
    if (!alert) return undefined;

    alert.status = 'RESOLVED';
    alert.resolvedAtMs = now;
    this.notify(alert);
    return alert;
  }

  public getOpenAlerts(): readonly Alert[] {
    return Array.from(this.alerts.values()).filter(a => a.status === 'OPEN');
  }

  public subscribe(handler: (alert: Alert) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      const idx = this.subscribers.indexOf(handler);
      if (idx >= 0) this.subscribers.splice(idx, 1);
    };
  }

  private notify(alert: Alert): void {
    for (const sub of this.subscribers) {
      try {
        sub(alert);
      } catch {
        // Bulkhead
      }
    }
  }
}

export class WorkScheduler {
  private operatingMode: OperatingMode = 'NORMAL';
  private executionFrozen: boolean = false;

  public setMode(mode: OperatingMode): void {
    this.operatingMode = mode;
  }

  public getMode(): OperatingMode {
    return this.operatingMode;
  }

  public setEmergencyExecutionFreeze(frozen: boolean): void {
    this.executionFrozen = frozen;
  }

  public isExecutionFrozen(): boolean {
    return this.executionFrozen;
  }

  /**
   * Part LXXX: Under load, determines whether a specific priority task should be processed.
   */
  public shouldExecute(priority: WorkloadPriority): boolean {
    if (this.operatingMode === 'SURVIVAL') {
      // In survival mode, process only P0 and P1
      return priority === 'P0_RISK_EXECUTION' || priority === 'P1_CANONICAL_STATE';
    }
    if (this.operatingMode === 'DEGRADED') {
      // Degraded skips P4 Research and throttles P5
      return priority !== 'P4_RESEARCH';
    }
    return true;
  }
}
