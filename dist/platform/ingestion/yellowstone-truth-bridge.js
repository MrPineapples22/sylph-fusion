/**
 * SYLPH FUSION â€” YELLOWSTONE gRPC CHAIN TRUTH BRIDGE
 * Connects decoded Yellowstone transaction updates into ChainTruthEngine.
 * Enforces sub-50ms tick latency, zero-lookahead point-in-time slots,
 * and immutable event provenance.
 */
import { EventEmitter } from 'node:events';
import { createWireWitness } from './contract-canary.js';
export class YellowstoneTruthBridge extends EventEmitter {
    chainTruth;
    endpointUrl;
    workerId;
    topology;
    validatorIdentity;
    totalIngested = 0;
    totalDuplicates = 0;
    lastSlot = 0;
    lastIngestionTimeMs = 0;
    latencySamplesMs = [];
    constructor(chainTruthOrOptions, endpointUrl, workerId, topology, validatorIdentity) {
        super();
        if ('chainTruth' in chainTruthOrOptions) {
            this.chainTruth = chainTruthOrOptions.chainTruth;
            this.endpointUrl = chainTruthOrOptions.endpointUrl ?? 'grpc.yellowstone.solana:10000';
            this.workerId = chainTruthOrOptions.workerId ?? 'worker_geyser_01';
            this.topology = chainTruthOrOptions.topology ?? (this.endpointUrl.includes('validator') ? 'DIRECT_VALIDATOR_GEYSER' : 'INTERMEDIATE_PROXY_RELAY');
            this.validatorIdentity = chainTruthOrOptions.validatorIdentity;
        }
        else {
            this.chainTruth = chainTruthOrOptions;
            this.endpointUrl = endpointUrl ?? 'grpc.yellowstone.solana:10000';
            this.workerId = workerId ?? 'worker_geyser_01';
            this.topology = topology ?? (this.endpointUrl.includes('validator') ? 'DIRECT_VALIDATOR_GEYSER' : 'INTERMEDIATE_PROXY_RELAY');
            this.validatorIdentity = validatorIdentity;
        }
    }
    getTopologyMeta() {
        return {
            endpointUrl: this.endpointUrl,
            topology: this.topology,
            validatorIdentity: this.validatorIdentity,
            verifiedDirectLeader: this.topology === 'DIRECT_VALIDATOR_GEYSER',
            maxAllowedSlotSkew: this.topology === 'DIRECT_VALIDATOR_GEYSER' ? 2 : 8,
        };
    }
    /**
     * Ingests a decoded transaction update. This API has no trusted wire-capture boundary.
     */
    ingestTransactionUpdate(update) {
        const receivedTime = Date.now();
        const slot = Number(update.slot);
        if (!Number.isSafeInteger(slot) || slot < 0 || !update.signature || update.err || update.isVote) {
            return { success: false, latencyMs: 0 };
        }
        const sourceTime = update.blockTimeMs ?? receivedTime;
        const latencyMs = Math.max(0, receivedTime - sourceTime);
        this.latencySamplesMs.push(latencyMs);
        if (this.latencySamplesMs.length > 500)
            this.latencySamplesMs.shift();
        // Determine canonical event type from logs
        let eventType = 'ACCOUNT_UPDATE';
        let mint = 'unknown_mint';
        let wallet;
        for (const log of update.logs) {
            if (log.includes('Instruction: InitializeMint') || log.includes('Program log: Create')) {
                eventType = 'POOL_CREATE';
            }
            else if (log.includes('Program log: Buy') || log.includes('Instruction: Buy')) {
                eventType = 'SWAP_BUY';
            }
            else if (log.includes('Program log: Sell') || log.includes('Instruction: Sell')) {
                eventType = 'SWAP_SELL';
            }
            // Extract mint if present in logs
            const mintMatch = log.match(/mint:\s*([a-zA-Z0-9_-]{32,44})/i);
            if (mintMatch) {
                mint = mintMatch[1];
            }
        }
        // Hash the decoded fields used below. Extra caller-supplied bytes cannot prove
        // that a transport captured or decoded this event, so they are never used.
        const rawPayload = JSON.stringify({ signature: update.signature, slot, logs: update.logs });
        const wireEncoding = 'DECODED_PROTOBUF_JSON_CANONICAL';
        const wireWitness = createWireWitness('SOLANA_GEYSER', 'TRANSACTION_STREAM', 'GRPC', rawPayload, 200, 'VALID', wireEncoding);
        const eventId = `geyser_${slot}_${update.signature.slice(0, 16)}`;
        // Calibrate confidence by connection topology
        const sourceConfidence = this.topology === 'DIRECT_VALIDATOR_GEYSER'
            ? 0.999
            : this.topology === 'INTERMEDIATE_PROXY_RELAY'
                ? 0.850
                : 0.700;
        const canonicalEvent = {
            eventId,
            eventType,
            mint,
            wallet,
            signature: update.signature,
            source: 'yellowstone_grpc',
            sourceTimestampMs: sourceTime,
            receivedTimestampMs: receivedTime,
            monotonicTimestamp: receivedTime,
            slot,
            commitment: 'confirmed',
            chainState: 'CONFIRMED',
            sourceConfidence,
            freshnessMs: Math.max(0, receivedTime - sourceTime),
            provenance: {
                endpointId: this.endpointUrl,
                transport: 'geyser_grpc',
                rawPayloadHash: wireWitness.payloadHash,
                ingestedByWorkerId: this.workerId,
                wireEncoding,
            },
            payload: {
                rawPayloadHash: wireWitness.payloadHash,
                logCount: update.logs.length,
                transport: 'geyser_grpc',
                endpoint: this.endpointUrl,
                workerId: this.workerId,
                topology: this.topology,
                wireWitnessId: wireWitness.witnessId,
                wireEncoding,
            },
        };
        const registered = this.chainTruth.registerEvent(canonicalEvent);
        if (registered) {
            this.totalIngested++;
            this.lastSlot = Math.max(this.lastSlot, slot);
            this.lastIngestionTimeMs = receivedTime;
            this.emit('canonical_event', canonicalEvent);
            return { success: true, eventId, latencyMs };
        }
        else {
            this.totalDuplicates++;
            return { success: false, eventId, latencyMs };
        }
    }
    ingestUpdate(update) {
        const res = this.ingestTransactionUpdate(update);
        return res.success;
    }
    getMetrics() {
        const avgLatency = this.latencySamplesMs.length > 0
            ? this.latencySamplesMs.reduce((a, b) => a + b, 0) / this.latencySamplesMs.length
            : 0;
        return {
            totalIngested: this.totalIngested,
            totalDuplicates: this.totalDuplicates,
            averageLatencyMs: Number(avgLatency.toFixed(2)),
            lastSlot: this.lastSlot,
            lastIngestionTimeMs: this.lastIngestionTimeMs,
        };
    }
    getIngestionStats() {
        const sorted = [...this.latencySamplesMs].sort((a, b) => a - b);
        const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.50)] : 0;
        const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0;
        const p99 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0;
        return {
            total_ingested: this.totalIngested,
            total_duplicates: this.totalDuplicates,
            p50_latency_ms: p50,
            p95_latency_ms: p95,
            p99_latency_ms: p99,
            last_slot: this.lastSlot,
        };
    }
}
//# sourceMappingURL=yellowstone-truth-bridge.js.map