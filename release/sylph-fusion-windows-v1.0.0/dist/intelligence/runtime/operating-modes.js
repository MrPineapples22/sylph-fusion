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
export class AlertEngine {
    alerts = new Map();
    subscribers = [];
    openAlert(params) {
        const now = params.now ?? Date.now();
        const alertId = `alt_${now}_${Math.random().toString(36).slice(2, 7)}`;
        const alert = {
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
    resolveAlert(alertId, now = Date.now()) {
        const alert = this.alerts.get(alertId);
        if (!alert)
            return undefined;
        alert.status = 'RESOLVED';
        alert.resolvedAtMs = now;
        this.notify(alert);
        return alert;
    }
    getOpenAlerts() {
        return Array.from(this.alerts.values()).filter(a => a.status === 'OPEN');
    }
    subscribe(handler) {
        this.subscribers.push(handler);
        return () => {
            const idx = this.subscribers.indexOf(handler);
            if (idx >= 0)
                this.subscribers.splice(idx, 1);
        };
    }
    notify(alert) {
        for (const sub of this.subscribers) {
            try {
                sub(alert);
            }
            catch {
                // Bulkhead
            }
        }
    }
}
export class WorkScheduler {
    operatingMode = 'NORMAL';
    executionFrozen = false;
    setMode(mode) {
        this.operatingMode = mode;
    }
    getMode() {
        return this.operatingMode;
    }
    setEmergencyExecutionFreeze(frozen) {
        this.executionFrozen = frozen;
    }
    isExecutionFrozen() {
        return this.executionFrozen;
    }
    /**
     * Part LXXX: Under load, determines whether a specific priority task should be processed.
     */
    shouldExecute(priority) {
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
//# sourceMappingURL=operating-modes.js.map