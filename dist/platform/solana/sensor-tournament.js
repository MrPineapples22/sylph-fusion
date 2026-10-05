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
export class SolanaSensorTournament {
    receiptsByEvent = new Map();
    providerCosts = new Map();
    constructor() {
        // Default baseline monthly provider costs amortized to event cost weights
        this.providerCosts.set('SHREDS', 150000n);
        this.providerCosts.set('GEYSER', 250000n);
        this.providerCosts.set('LOGS_SUBSCRIBE', 50000n);
        this.providerCosts.set('BLOCK_SUBSCRIBE', 40000n);
        this.providerCosts.set('RPC_PRIMARY', 80000n);
        this.providerCosts.set('RPC_FALLBACK', 20000n);
    }
    /**
     * Records receipt of an event from an individual sensor.
     */
    recordReceipt(receipt) {
        let sensorMap = this.receiptsByEvent.get(receipt.eventId);
        if (!sensorMap) {
            sensorMap = new Map();
            this.receiptsByEvent.set(receipt.eventId, sensorMap);
        }
        sensorMap.set(receipt.sensorType, Object.freeze({ ...receipt }));
    }
    /**
     * Evaluates the multi-sensor tournament ranking by SensorEconomicValue.
     */
    evaluateTournament() {
        const allSensors = [
            'SHREDS',
            'GEYSER',
            'LOGS_SUBSCRIBE',
            'BLOCK_SUBSCRIBE',
            'RPC_PRIMARY',
            'RPC_FALLBACK',
        ];
        const totalEvents = this.receiptsByEvent.size;
        const aggregates = [];
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
                        errorsCausedLamports += 500000n; // Penalize false decode
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
                        edgePreservedLamports += 1000000n; // Edge reward
                    }
                }
                else {
                    // Event was missed by this sensor
                    infoMissedLamports += 300000n;
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
            aggregates.push(Object.freeze({
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
            }));
        }
        // Rank by economicValueLamports descending
        return Object.freeze(aggregates.sort((a, b) => Number(b.economicValueLamports - a.economicValueLamports)));
    }
    /**
     * Section 6: Sensor Shadow Universe
     * Calculates counterfactual outcomes: "What if alternative sensor X had been primary?"
     */
    evaluateShadowUniverse(hypotheticalPrimary) {
        let eventsConsidered = 0;
        let counterfactualWins = 0;
        let potentialEdgeDeltaLamports = 0n;
        for (const [, sensorMap] of this.receiptsByEvent) {
            eventsConsidered++;
            const hypReceipt = sensorMap.get(hypotheticalPrimary);
            if (hypReceipt && hypReceipt.decodeSuccess) {
                // Find actual winner
                let actualWinner = null;
                for (const [, r] of sensorMap) {
                    if (r.decodeSuccess && (!actualWinner || r.firstSeenAtMs < actualWinner.firstSeenAtMs)) {
                        actualWinner = r;
                    }
                }
                if (actualWinner && hypReceipt.firstSeenAtMs < actualWinner.firstSeenAtMs) {
                    counterfactualWins++;
                    potentialEdgeDeltaLamports += 500000n; // Edge gained if hypothetical had been used
                }
                else if (actualWinner && actualWinner.firstSeenAtMs < hypReceipt.firstSeenAtMs) {
                    potentialEdgeDeltaLamports -= 200000n; // Edge lost if hypothetical had been used
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
    getTournamentDigest() {
        return hashCanonical(this.evaluateTournament());
    }
}
//# sourceMappingURL=sensor-tournament.js.map