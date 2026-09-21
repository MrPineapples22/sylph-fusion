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
import type { OperationalLossType } from '../types.js';
import type { IncidentContextSnapshot } from '../sentinel/types.js';

export interface RecordedIncident {
  readonly incidentId: string;
  readonly createdAt: number;
  readonly lossType: OperationalLossType;
  readonly severity: 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
  readonly description: string;
  readonly snapshot: IncidentContextSnapshot;
  status: 'DETECTED' | 'CONTAINED' | 'DIAGNOSED' | 'RESOLVED';
  containedAt?: number;
  diagnosedAt?: number;
  resolvedAt?: number;
}

export class IncidentFlightRecorder {
  private readonly incidents: Map<string, RecordedIncident> = new Map();

  /**
   * Capture an incident and context snapshot.
   */
  public captureIncident(
    lossType: OperationalLossType,
    severity: 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW',
    description: string,
    snapshotContext: {
      vaultId?: string;
      strategyId?: string;
      marketState: Record<string, unknown>;
      riskState: Record<string, unknown>;
      ledgerStateHash: string;
      stackTrace?: string;
    }
  ): RecordedIncident {
    const now = Date.now();
    const incidentId = `inc_${randomUUID()}`;

    const snapshot: IncidentContextSnapshot = {
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

    const incident: RecordedIncident = {
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

  public containIncident(incidentId: string): void {
    const inc = this.incidents.get(incidentId);
    if (inc) {
      inc.status = 'CONTAINED';
      inc.containedAt = Date.now();
    }
  }

  public diagnoseIncident(incidentId: string): void {
    const inc = this.incidents.get(incidentId);
    if (inc) {
      inc.status = 'DIAGNOSED';
      inc.diagnosedAt = Date.now();
    }
  }

  public resolveIncident(incidentId: string): void {
    const inc = this.incidents.get(incidentId);
    if (inc) {
      inc.status = 'RESOLVED';
      inc.resolvedAt = Date.now();
    }
  }

  public getIncident(incidentId: string): RecordedIncident | undefined {
    return this.incidents.get(incidentId);
  }

  public getAllIncidents(): readonly RecordedIncident[] {
    return Array.from(this.incidents.values());
  }
}
