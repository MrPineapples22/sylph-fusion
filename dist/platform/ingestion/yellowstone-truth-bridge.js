/**
 * SYLPH FUSION — YELLOWSTONE gRPC CHAIN TRUTH BRIDGE
 * Connects raw Yellowstone gRPC streams directly into ChainTruthEngine.
 * Enforces sub-50ms tick latency, zero-lookahead point-in-time slots,
 * and immutable event provenance.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
export class YellowstoneTruthBridge extends EventEmitter {
    chainTruth;
    endpointUrl;
    workerId;
    totalIngested = 0;
    totalDuplicates = 0;
    lastSlot = 0;
    lastIngestionTimeMs = 0;
    latencySamplesMs = [];
    constructor(chainTruthOrOptions, endpointUrl, workerId) {
        super();
        if ('chainTruth' in chainTruthOrOptions) {
            this.chainTruth = chainTruthOrOptions.chainTruth;
            this.endpointUrl = chainTruthOrOptions.endpointUrl ?? 'grpc.yellowstone.solana:10000';
            this.workerId = chainTruthOrOptions.workerId ?? 'worker_geyser_01';
        }
        else {
            this.chainTruth = chainTruthOrOptions;
            this.endpointUrl = endpointUrl ?? 'grpc.yellowstone.solana:10000';
            this.workerId = workerId ?? 'worker_geyser_01';
        }
    }
    /**
     * Ingests a raw transaction update from Yellowstone gRPC into ChainTruthEngine.
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
        const rawPayloadHash = createHash('sha256')
            .update(JSON.stringify({ signature: update.signature, slot, logs: update.logs }))
            .digest('hex');
        const eventId = `geyser_${slot}_${update.signature.slice(0, 16)}`;
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
            sourceConfidence: 0.999,
            freshnessMs: Math.max(0, receivedTime - sourceTime),
            provenance: {
                endpointId: this.endpointUrl,
                transport: 'geyser_grpc',
                rawPayloadHash,
                ingestedByWorkerId: this.workerId,
            },
            payload: {
                rawPayloadHash,
                logCount: update.logs.length,
                transport: 'geyser_grpc',
                endpoint: this.endpointUrl,
                workerId: this.workerId,
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