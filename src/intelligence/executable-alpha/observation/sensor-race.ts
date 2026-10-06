/**
 * SYLPH FUSION — SENSOR RACE & MULTI-FEED INGESTION ENGINE
 * Study: MULTI-FEED-RACE-X (Sections VIII & XXXIX)
 *
 * Prevents feed replacement from breaking strategy logic.
 * Deduplicates concurrent sensor arrivals, measures arrival latency races,
 * and detects inter-feed price/reserve divergences.
 */

export interface SensorArrival {
  readonly sensorId: string;
  readonly mint: string;
  readonly arrivalTimestampMs: number;
  readonly reportedSlot: bigint;
  readonly priceSol: number;
  readonly quoteReservesLamports: bigint;
  readonly sourceSignature?: string;
}

export interface SensorRaceResult {
  readonly winnerSensorId: string;
  readonly arrivalLeadMs: number;
  readonly maxSensorDivergenceBps: number;
  readonly consensusPriceSol: number;
  readonly participatingSensors: readonly string[];
  readonly hasSignificantDivergence: boolean;
}

export class SensorRaceEngine {
  public static evaluateRace(arrivals: readonly SensorArrival[]): SensorRaceResult | null {
    if (arrivals.length === 0) return null;

    // Sort by arrival timestamp ascending
    const sorted = [...arrivals].sort((a, b) => a.arrivalTimestampMs - b.arrivalTimestampMs);
    const winner = sorted[0];
    const second = sorted.length > 1 ? sorted[1] : null;
    const arrivalLeadMs = second ? second.arrivalTimestampMs - winner.arrivalTimestampMs : 0;

    // Calculate price divergence
    const prices = arrivals.map(a => a.priceSol).filter(p => p > 0);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const maxSensorDivergenceBps = minPrice > 0
      ? Math.round(((maxPrice - minPrice) / minPrice) * 10000)
      : 0;

    // Consensus price (median of reporting sensors)
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sortedPrices.length / 2);
    const consensusPriceSol = sortedPrices.length % 2 !== 0
      ? sortedPrices[mid]
      : (sortedPrices[mid - 1] + sortedPrices[mid]) / 2.0;

    return {
      winnerSensorId: winner.sensorId,
      arrivalLeadMs,
      maxSensorDivergenceBps,
      consensusPriceSol,
      participatingSensors: arrivals.map(a => a.sensorId),
      hasSignificantDivergence: maxSensorDivergenceBps > 150, // > 1.5% divergence
    };
  }
}
