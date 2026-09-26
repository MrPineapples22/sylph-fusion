/**
 * SOL-SYLPH Multi-User Platform - Incident Flight Recorder & Operational Loss Classifier
 * Specifications: Sections LVII (Operational Loss Classification), LVIII (Incident Flight Recorder).
 *
 * Rules:
 * 1. Distinguish between normal market losses and infrastructure/platform malfunctions.
 * 2. Incident pipeline: DETECT -> CONTAIN -> CAPTURE -> REPLAY -> DIAGNOSE.
 * 3. Preserve complete contextual telemetry snapshots for post-mortem reproducibility.
 */
import { randomUUID } from 'node:crypto';
export class IncidentFlightRecorder {
    incidents = new Map();
    /**
     * Capture an incident and context snapshot.
     */
    captureIncident(lossType, severity, description, snapshotContext) {
        const now = Date.now();
        const incidentId = `inc_${randomUUID()}`;
        const snapshot = {
            incidentId,
            timestamp: now,
            lossType,
            vaultId: snapshotContext.vaultId,
            strategyId: snapshotContext.strategyId,
            marketState: snapshotContext.marketState,
            riskState: snapshotContext.riskState,
            ledgerStateHash: snapshotContext.ledgerStateHash,
            stackTrace: snapshotContext.stackTrace,
        };
        const incident = {
            incidentId,
            createdAt: now,
            lossType,
            severity,
            description,
            snapshot,
            status: 'DETECTED',
        };
        this.incidents.set(incidentId, incident);
        return incident;
    }
    containIncident(incidentId) {
        const inc = this.incidents.get(incidentId);
        if (inc) {
            inc.status = 'CONTAINED';
            inc.containedAt = Date.now();
        }
    }
    diagnoseIncident(incidentId) {
        const inc = this.incidents.get(incidentId);
        if (inc) {
            inc.status = 'DIAGNOSED';
            inc.diagnosedAt = Date.now();
        }
    }
    resolveIncident(incidentId) {
        const inc = this.incidents.get(incidentId);
        if (inc) {
            inc.status = 'RESOLVED';
            inc.resolvedAt = Date.now();
        }
    }
    getIncident(incidentId) {
        return this.incidents.get(incidentId);
    }
    getAllIncidents() {
        return Array.from(this.incidents.values());
    }
}
//# sourceMappingURL=flight-recorder.js.map