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
    /**
     * Records receipt of an event from an individual sensor.
     */
    recordReceipt(receipt) {
        const knownSensors = ['SHREDS', 'GEYSER', 'LOGS_SUBSCRIBE', 'BLOCK_SUBSCRIBE', 'RPC_PRIMARY', 'RPC_FALLBACK'];
        if (typeof receipt.eventId !== 'string' || !receipt.eventId.trim() || typeof receipt.slot !== 'bigint' || receipt.slot < 0n ||
            typeof receipt.receiverClockId !== 'string' || !receipt.receiverClockId.trim() ||
            !knownSensors.includes(receipt.sensorType) || typeof receipt.decodeSuccess !== 'boolean' || typeof receipt.isStale !== 'boolean' ||
            ![receipt.firstSeenAtMs, receipt.correctlyDecodedAtMs, receipt.canonicalAtMs, receipt.latencyMs].every(Number.isFinite) ||
            receipt.firstSeenAtMs < 0 || receipt.correctlyDecodedAtMs < 0 || receipt.canonicalAtMs < 0 || receipt.latencyMs < 0) {
            throw new Error('Invalid sensor receipt');
        }
        let sensorMap = this.receiptsByEvent.get(receipt.eventId);
        if (!sensorMap) {
            sensorMap = new Map();
            this.receiptsByEvent.set(receipt.eventId, sensorMap);
        }
        const existing = sensorMap.get(receipt.sensorType);
        if (existing) {
            if (hashCanonical(existing) !== hashCanonical(receipt)) {
                throw new Error('Conflicting sensor receipt for event and sensor');
            }
            return;
        }
        const otherReceipt = sensorMap.values().next().value;
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
                if (!receipt || !receipt.decodeSuccess || receipt.isStale)
                    continue;
                const correctPeers = [...sensorMap.values()].filter(candidate => candidate.decodeSuccess && !candidate.isStale);
                const earliestDecode = Math.min(...correctPeers.map(candidate => candidate.correctlyDecodedAtMs));
                if (receipt.correctlyDecodedAtMs === earliestDecode)
                    winsCount++;
            }
            const coverageRatePct = totalEvents > 0 ? (observedCount / totalEvents) * 100 : 0;
            const falseDecodeRatePct = observedCount > 0 ? (falseDecodes / observedCount) * 100 : 0;
            const missingEventRatePct = totalEvents > 0 ? ((totalEvents - observedCount) / totalEvents) * 100 : 0;
            const staleEventRatePct = observedCount > 0 ? (stales / observedCount) * 100 : 0;
            const meanLatencyMs = observedCount > 0 ? totalLatency / observedCount : 0;
            aggregates.push(Object.freeze({
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
            }));
        }
        return Object.freeze(aggregates);
    }
    /**
     * Section 6: Sensor Shadow Universe
     * Calculates counterfactual outcomes: "What if alternative sensor X had been primary?"
     */
    evaluateShadowUniverse(hypotheticalPrimary) {
        let eventsConsidered = 0;
        let counterfactualWins = 0;
        let eventsWithComparableReceipts = 0;
        let pairedDecodeLatencyAdvantageMs = 0;
        for (const [, sensorMap] of this.receiptsByEvent) {
            eventsConsidered++;
            const hypReceipt = sensorMap.get(hypotheticalPrimary);
            if (!hypReceipt || !hypReceipt.decodeSuccess || hypReceipt.isStale)
                continue;
            const validReceipts = [...sensorMap.values()].filter(r => r.decodeSuccess && !r.isStale);
            if (validReceipts.length === 0)
                continue;
            const actualEarliestDecode = Math.min(...validReceipts.map(r => r.correctlyDecodedAtMs));
            eventsWithComparableReceipts++;
            if (hypReceipt.correctlyDecodedAtMs === actualEarliestDecode)
                counterfactualWins++;
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
    getTournamentDigest() {
        return hashCanonical(this.evaluateTournament());
    }
}
//# sourceMappingURL=sensor-tournament.js.map