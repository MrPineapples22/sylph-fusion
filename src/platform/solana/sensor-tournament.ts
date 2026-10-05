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
  readonly edgePreservedLamports: bigint;
  readonly errorsCausedLamports: bigint;
  readonly informationMissedLamports: bigint;
  readonly providerCostLamports: bigint;
  readonly economicValueLamports: bigint;
}

export interface SensorShadowCounterfactual {
  readonly hypotheticalPrimarySensor: SensorType;
  readonly eventsConsidered: number;
  readonly counterfactualWins: number;
  readonly potentialEdgeDeltaLamports: bigint;
  readonly reliabilityImpact: 'IMPROVED' | 'DEGRADED' | 'NEUTRAL';
}

export class SolanaSensorTournament {
  private readonly receiptsByEvent = new Map<string, Map<SensorType, SensorEventReceipt>>();
  private readonly providerCosts = new Map<SensorType, bigint>();

  constructor() {
    // Default baseline monthly provider costs amortized to event cost weights
    this.providerCosts.set('SHREDS', 150_000n);
    this.providerCosts.set('GEYSER', 250_000n);
    this.providerCosts.set('LOGS_SUBSCRIBE', 50_000n);
    this.providerCosts.set('BLOCK_SUBSCRIBE', 40_000n);
    this.providerCosts.set('RPC_PRIMARY', 80_000n);
    this.providerCosts.set('RPC_FALLBACK', 20_000n);
  }

  /**
   * Records receipt of an event from an individual sensor.
   */
  public recordReceipt(receipt: SensorEventReceipt): void {
    let sensorMap = this.receiptsByEvent.get(receipt.eventId);
    if (!sensorMap) {
      sensorMap = new Map<SensorType, SensorEventReceipt>();
      this.receiptsByEvent.set(receipt.eventId, sensorMap);
    }
    sensorMap.set(receipt.sensorType, Object.freeze({ ...receipt }));
  }

  /**
   * Evaluates the multi-sensor tournament ranking by SensorEconomicValue.
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
      let edgePreservedLamports = 0n;
      let errorsCausedLamports = 0n;
      let infoMissedLamports = 0n;

      for (const [, sensorMap] of this.receiptsByEvent) {
        const receipt = sensorMap.get(sensor);
        if (receipt) {
          observedCount++;
          totalLatency += receipt.latencyMs;
          if (!receipt.decodeSuccess) {
            falseDecodes++;
            errorsCausedLamports += 500_000n; // Penalize false decode
          }
          if (receipt.isStale) {
            stales++;
          }

          // Check if this sensor won the race for this event
          let isWinner = true;
          for (const [otherSensor, otherReceipt] of sensorMap) {
            if (otherSensor !== sensor && otherReceipt.decodeSuccess && otherReceipt.firstSeenAtMs < receipt.firstSeenAtMs) {
              isWinner = false;
              break;
            }
          }
          if (isWinner && receipt.decodeSuccess) {
            winsCount++;
            edgePreservedLamports += 1_000_000n; // Edge reward
          }
        } else {
          // Event was missed by this sensor
          infoMissedLamports += 300_000n;
        }
      }

      const coverageRatePct = totalEvents > 0 ? (observedCount / totalEvents) * 100 : 0;
      const falseDecodeRatePct = observedCount > 0 ? (falseDecodes / observedCount) * 100 : 0;
      const missingEventRatePct = totalEvents > 0 ? ((totalEvents - observedCount) / totalEvents) * 100 : 0;
      const staleEventRatePct = observedCount > 0 ? (stales / observedCount) * 100 : 0;
      const meanLatencyMs = observedCount > 0 ? totalLatency / observedCount : 0;
      const providerCostLamports = (this.providerCosts.get(sensor) || 0n) * BigInt(Math.max(1, observedCount));

      // SensorEconomicValue = edgePreserved - errorsCaused - informationMissed - providerCost
      const economicValueLamports = edgePreservedLamports - errorsCausedLamports - infoMissedLamports - providerCostLamports;

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
          edgePreservedLamports,
          errorsCausedLamports,
          informationMissedLamports: infoMissedLamports,
          providerCostLamports,
          economicValueLamports,
        })
      );
    }

    // Rank by economicValueLamports descending
    return Object.freeze(aggregates.sort((a, b) => Number(b.economicValueLamports - a.economicValueLamports)));
  }

  /**
   * Section 6: Sensor Shadow Universe
   * Calculates counterfactual outcomes: "What if alternative sensor X had been primary?"
   */
  public evaluateShadowUniverse(hypotheticalPrimary: SensorType): SensorShadowCounterfactual {
    let eventsConsidered = 0;
    let counterfactualWins = 0;
    let potentialEdgeDeltaLamports = 0n;

    for (const [, sensorMap] of this.receiptsByEvent) {
      eventsConsidered++;
      const hypReceipt = sensorMap.get(hypotheticalPrimary);
      if (hypReceipt && hypReceipt.decodeSuccess) {
        // Find actual winner
        let actualWinner: SensorEventReceipt | null = null;
        for (const [, r] of sensorMap) {
          if (r.decodeSuccess && (!actualWinner || r.firstSeenAtMs < actualWinner.firstSeenAtMs)) {
            actualWinner = r;
          }
        }

        if (actualWinner && hypReceipt.firstSeenAtMs < actualWinner.firstSeenAtMs) {
          counterfactualWins++;
          potentialEdgeDeltaLamports += 500_000n; // Edge gained if hypothetical had been used
        } else if (actualWinner && actualWinner.firstSeenAtMs < hypReceipt.firstSeenAtMs) {
          potentialEdgeDeltaLamports -= 200_000n; // Edge lost if hypothetical had been used
        }
      }
    }

    const reliabilityImpact = potentialEdgeDeltaLamports > 0n ? 'IMPROVED'
      : potentialEdgeDeltaLamports < 0n ? 'DEGRADED'
      : 'NEUTRAL';

    return Object.freeze({
      hypotheticalPrimarySensor: hypotheticalPrimary,
      eventsConsidered,
      counterfactualWins,
      potentialEdgeDeltaLamports,
      reliabilityImpact,
    });
  }

  /**
   * Returns canonical digest of current tournament state.
   */
  public getTournamentDigest(): string {
    return hashCanonical(this.evaluateTournament());
  }
}
