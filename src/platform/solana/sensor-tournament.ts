/**
 * SYLPH FUSION — SOLANA SENSOR TOURNAMENT & SHADOW UNIVERSE
 * Specification: Solana-Only Integration Blueprint (Sections 5 & 6)
 *
 * Epistemic Invariants:
 * 1. Multi-sensor race: Shreds, Geyser, logsSubscribe, blockSubscribe, RPC Providers.
 * 2. Quality-weighted ranking: SensorEconomicValue = edgePreserved - errorsCaused - infoMissed - cost.
 *    Sensors are never ranked by raw speed alone.
 * 3. Shadow Universe: Preserves timestamps for all losing sensors to compute counterfactual outcomes
 *    ("What if Geyser had been primary?", "What if logs had been primary?").
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export type SensorType =
  | 'SHREDS'
  | 'GEYSER'
  | 'LOGS_SUBSCRIBE'
  | 'BLOCK_SUBSCRIBE'
  | 'RPC_PRIMARY'
  | 'RPC_FALLBACK';

export interface SensorEventReceipt {
  readonly eventId: string;
  readonly sensorType: SensorType;
  readonly slot: bigint;
  /** Stable identifier for the shared monotonic receiver clock/boot epoch. */
  readonly receiverClockId: string;
  readonly firstSeenAtMs: number;
  readonly correctlyDecodedAtMs: number;
  readonly canonicalAtMs: number;
  readonly latencyMs: number;
  readonly decodeSuccess: boolean;
  readonly isStale: boolean;
}

export interface SensorTelemetryAggregate {
  readonly sensorType: SensorType;
  readonly totalEventsObserved: number;
  readonly winsCount: number; // Earliest correct decode
  readonly meanLatencyMs: number;
  readonly coverageRatePct: number;
  readonly falseDecodeRatePct: number;
  readonly missingEventRatePct: number;
  readonly staleEventRatePct: number;
  /** Economic attribution is unavailable until reconciled edge and provider invoices are supplied. */
  readonly economicValueState: 'UNKNOWN';
  readonly economicValueReason: 'REALIZED_EDGE_AND_PROVIDER_COST_EVIDENCE_REQUIRED';
  readonly edgePreservedLamports: null;
  readonly errorsCausedLamports: null;
  readonly informationMissedLamports: null;
  readonly providerCostLamports: null;
  readonly economicValueLamports: null;
}

export interface SensorShadowCounterfactual {
  readonly hypotheticalPrimarySensor: SensorType;
  readonly eventsConsidered: number;
  readonly eventsWithComparableReceipts: number;
  readonly counterfactualWins: number;
  /** Positive means the hypothetical sensor decoded earlier; this is not an edge estimate. */
  readonly pairedDecodeLatencyAdvantageMs: number | null;
  readonly economicImpactLamports: null;
  readonly reliabilityImpact: 'UNKNOWN';
}

export class SolanaSensorTournament {
  private readonly receiptsByEvent = new Map<string, Map<SensorType, SensorEventReceipt>>();
  /**
   * Records receipt of an event from an individual sensor.
   */
  public recordReceipt(receipt: SensorEventReceipt): void {
    const knownSensors: readonly SensorType[] = ['SHREDS', 'GEYSER', 'LOGS_SUBSCRIBE', 'BLOCK_SUBSCRIBE', 'RPC_PRIMARY', 'RPC_FALLBACK'];
    if (typeof receipt.eventId !== 'string' || !receipt.eventId.trim() || typeof receipt.slot !== 'bigint' || receipt.slot < 0n ||
        typeof receipt.receiverClockId !== 'string' || !receipt.receiverClockId.trim() ||
        !knownSensors.includes(receipt.sensorType) || typeof receipt.decodeSuccess !== 'boolean' || typeof receipt.isStale !== 'boolean' ||
        ![receipt.firstSeenAtMs, receipt.correctlyDecodedAtMs, receipt.canonicalAtMs, receipt.latencyMs].every(Number.isFinite) ||
        receipt.firstSeenAtMs < 0 || receipt.correctlyDecodedAtMs < 0 || receipt.canonicalAtMs < 0 || receipt.latencyMs < 0) {
      throw new Error('Invalid sensor receipt');
    }
    let sensorMap = this.receiptsByEvent.get(receipt.eventId);
    if (!sensorMap) {
      sensorMap = new Map<SensorType, SensorEventReceipt>();
      this.receiptsByEvent.set(receipt.eventId, sensorMap);
    }
    const existing = sensorMap.get(receipt.sensorType);
    if (existing) {
      if (hashCanonical(existing) !== hashCanonical(receipt)) {
        throw new Error('Conflicting sensor receipt for event and sensor');
      }
      return;
    }
    const otherReceipt = sensorMap.values().next().value as SensorEventReceipt | undefined;
    if (otherReceipt && otherReceipt.slot !== receipt.slot) {
      throw new Error('Sensor receipts for one event must agree on slot');
    }
    if (otherReceipt && otherReceipt.receiverClockId !== receipt.receiverClockId) {
      throw new Error('Sensor receipts for one event must share a receiver clock');
    }
    sensorMap.set(receipt.sensorType, Object.freeze({ ...receipt }));
  }

  /**
   * Reports observed telemetry only. No economic ranking is available without
   * reconciled event outcomes and measured provider costs.
   */
  public evaluateTournament(): readonly SensorTelemetryAggregate[] {
    const allSensors: SensorType[] = [
      'SHREDS',
      'GEYSER',
      'LOGS_SUBSCRIBE',
      'BLOCK_SUBSCRIBE',
      'RPC_PRIMARY',
      'RPC_FALLBACK',
    ];

    const totalEvents = this.receiptsByEvent.size;
    const aggregates: SensorTelemetryAggregate[] = [];

    for (const sensor of allSensors) {
      let observedCount = 0;
      let winsCount = 0;
      let totalLatency = 0;
      let falseDecodes = 0;
      let stales = 0;

      for (const [, sensorMap] of this.receiptsByEvent) {
        const receipt = sensorMap.get(sensor);
        if (receipt) {
          observedCount++;
          totalLatency += receipt.latencyMs;
          if (!receipt.decodeSuccess) {
            falseDecodes++;
          }
          if (receipt.isStale) {
            stales++;
          }

        }
      }

      for (const sensorMap of this.receiptsByEvent.values()) {
        const receipt = sensorMap.get(sensor);
        if (!receipt || !receipt.decodeSuccess || receipt.isStale) continue;
        const correctPeers = [...sensorMap.values()].filter(candidate => candidate.decodeSuccess && !candidate.isStale);
        const earliestDecode = Math.min(...correctPeers.map(candidate => candidate.correctlyDecodedAtMs));
        if (receipt.correctlyDecodedAtMs === earliestDecode) winsCount++;
      }

      const coverageRatePct = totalEvents > 0 ? (observedCount / totalEvents) * 100 : 0;
      const falseDecodeRatePct = observedCount > 0 ? (falseDecodes / observedCount) * 100 : 0;
      const missingEventRatePct = totalEvents > 0 ? ((totalEvents - observedCount) / totalEvents) * 100 : 0;
      const staleEventRatePct = observedCount > 0 ? (stales / observedCount) * 100 : 0;
      const meanLatencyMs = observedCount > 0 ? totalLatency / observedCount : 0;
      aggregates.push(
        Object.freeze({
          sensorType: sensor,
          totalEventsObserved: observedCount,
          winsCount,
          meanLatencyMs,
          coverageRatePct,
          falseDecodeRatePct,
          missingEventRatePct,
          staleEventRatePct,
          economicValueState: 'UNKNOWN',
          economicValueReason: 'REALIZED_EDGE_AND_PROVIDER_COST_EVIDENCE_REQUIRED',
          edgePreservedLamports: null,
          errorsCausedLamports: null,
          informationMissedLamports: null,
          providerCostLamports: null,
          economicValueLamports: null,
        })
      );
    }

    return Object.freeze(aggregates);
  }

  /**
   * Section 6: Sensor Shadow Universe
   * Calculates counterfactual outcomes: "What if alternative sensor X had been primary?"
   */
  public evaluateShadowUniverse(hypotheticalPrimary: SensorType): SensorShadowCounterfactual {
    let eventsConsidered = 0;
    let counterfactualWins = 0;
    let eventsWithComparableReceipts = 0;
    let pairedDecodeLatencyAdvantageMs = 0;

    for (const [, sensorMap] of this.receiptsByEvent) {
      eventsConsidered++;
      const hypReceipt = sensorMap.get(hypotheticalPrimary);
      if (!hypReceipt || !hypReceipt.decodeSuccess || hypReceipt.isStale) continue;
      const validReceipts = [...sensorMap.values()].filter(r => r.decodeSuccess && !r.isStale);
      if (validReceipts.length === 0) continue;
      const actualEarliestDecode = Math.min(...validReceipts.map(r => r.correctlyDecodedAtMs));
      eventsWithComparableReceipts++;
      if (hypReceipt.correctlyDecodedAtMs === actualEarliestDecode) counterfactualWins++;
      pairedDecodeLatencyAdvantageMs += actualEarliestDecode - hypReceipt.correctlyDecodedAtMs;
    }

    return Object.freeze({
      hypotheticalPrimarySensor: hypotheticalPrimary,
      eventsConsidered,
      eventsWithComparableReceipts,
      counterfactualWins,
      pairedDecodeLatencyAdvantageMs: eventsWithComparableReceipts > 0 ? pairedDecodeLatencyAdvantageMs : null,
      economicImpactLamports: null,
      reliabilityImpact: 'UNKNOWN',
    });
  }

  /**
   * Returns canonical digest of current tournament state.
   */
  public getTournamentDigest(): string {
    return hashCanonical(this.evaluateTournament());
  }
}
