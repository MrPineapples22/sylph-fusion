import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import WebSocket from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { BoundedSet, log } from './core.js';
import { IngestionGapReconciler } from './platform/ingestion/gap-reconciler.js';
import { capturedTransactionObservation, createCapturedSubscribeClient, yellowstoneBackoffAfterSession } from './platform/ingestion/yellowstone-captured-client.js';
import { createUnvalidatedObservation } from './platform/ingress/observation-factory.js';
function providerLabel(endpoint) {
    try {
        return new URL(endpoint).origin;
    }
    catch {
        return 'unparseable-provider';
    }
}
function validateSource(source) {
    const safeLabel = /^[A-Za-z0-9_.:-]{1,128}$/;
    const safeOrigin = /^(https?|wss?):\/\/[^/?#@]+$/;
    if (typeof source.sourceId !== 'string' || typeof source.providerId !== 'string' || typeof source.transport !== 'string' || !safeLabel.test(source.sourceId) || !(safeLabel.test(source.providerId) || safeOrigin.test(source.providerId)) || !safeLabel.test(source.transport))
        throw new Error('RAW_OBSERVATION_INVALID_SOURCE');
    if (source.commitment !== undefined && !['processed', 'confirmed', 'finalized', 'unknown'].includes(source.commitment))
        throw new Error('RAW_OBSERVATION_INVALID_COMMITMENT');
    if (source.observedAt !== undefined && (!Number.isFinite(source.observedAt) || source.observedAt < 0))
        throw new Error('RAW_OBSERVATION_INVALID_TIME');
}
export class Feed {
    cfg;
    yellowstoneClientFactory;
    #ingress;
    sourceId = 'feed-solana-pump';
    seen = new BoundedSet(100_000, 300_000);
    sockets = new Set();
    grpcStream;
    stopped = false;
    shutdown = new AbortController();
    gapReconciler = new IngestionGapReconciler();
    last = 0;
    slot = 0;
    readySince = 0;
    constructor(cfg, _connection, ingress, yellowstoneClientFactory = createCapturedSubscribeClient) {
        this.cfg = cfg;
        this.yellowstoneClientFactory = yellowstoneClientFactory;
        if (typeof ingress === 'function' || !ingress || typeof ingress.submit !== 'function') {
            throw new Error('FEED_CALLBACK_BYPASS_FORBIDDEN: Feed requires an ObservationIngressPort instance. Arbitrary callback functions are strictly prohibited.');
        }
        this.#ingress = ingress;
    }
    isIngressBound(port) {
        return this.#ingress === port;
    }
    healthy() { const age = Date.now() - this.last; return !this.stopped && this.last > 0 && age >= 0 && age < this.cfg.FEED_STALE_MS && Date.now() - this.readySince >= this.cfg.MIN_AGE_MS; }
    async accept(signature, slot, logs, source = { sourceId: 'unknown', providerId: 'unknown', transport: 'unknown', commitment: 'unknown' }) {
        const now = Date.now();
        const isHistoricalRepair = Boolean(source?.isRepair || source?.processingIntent === 'HISTORICAL_REPAIR');
        if (this.stopped ||
            !Number.isSafeInteger(slot) ||
            slot < 0 ||
            (this.slot > 0 && slot < this.slot && !isHistoricalRepair && !source?.allowLate) ||
            (this.slot > 0 && !isHistoricalRepair && this.slot - slot > 1000) ||
            typeof signature !== 'string' ||
            !signature ||
            !Array.isArray(logs) ||
            logs.length === 0 ||
            logs.some(line => typeof line !== 'string')) {
            return;
        }
        try {
            validateSource(source);
        }
        catch {
            log('feed_source_rejected');
            return;
        }
        if (source.rawPayloadEncoding === 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES') {
            const bound = capturedTransactionObservation(source.capturedYellowstoneUpdate);
            if (!bound || source.transport !== 'yellowstone.transaction.logs' || bound.signature !== signature ||
                bound.slot !== slot || bound.logs.length !== logs.length || bound.logs.some((line, index) => line !== logs[index]) ||
                !source.rawPayload || !Buffer.from(source.rawPayload).equals(bound.rawPayload)) {
                log('feed_source_rejected');
                return;
            }
        }
        const intent = source.processingIntent ?? (isHistoricalRepair ? 'HISTORICAL_REPAIR' : 'LIVE');
        let observation;
        try {
            // WebSocket supplies the original JSON-RPC frame. Yellowstone exposes decoded
            // protobuf updates; JSON.stringify output is serialized JSON, not canonical JSON.
            const rawPayload = source.rawPayload ?? (source.transport === 'yellowstone.transaction.logs'
                ? Buffer.from(JSON.stringify({ transaction: { transaction: { meta: { logMessages: logs } } } }))
                : Buffer.from(JSON.stringify(logs)));
            const rawPayloadEncoding = source.rawPayloadEncoding ?? (source.rawPayload
                ? 'UNSPECIFIED'
                : source.transport === 'yellowstone.transaction.logs'
                    ? 'DECODED_PROTOBUF_JSON_SERIALIZED_BYTES'
                    : 'JSON_SERIALIZED_BYTES');
            const schemaVersion = rawPayloadEncoding === 'JSON_FRAME_BYTES'
                ? 'solana-json-rpc-frame/v1'
                : rawPayloadEncoding === 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES'
                    ? 'yellowstone-grpc-protobuf-message/v1'
                    : rawPayloadEncoding === 'DECODED_PROTOBUF_JSON_SERIALIZED_BYTES' || rawPayloadEncoding === 'DECODED_PROTOBUF_JSON_CANONICAL'
                        ? 'yellowstone-update-json/v1'
                        : source.rawPayload
                            ? 'provider-payload/v1'
                            : 'solana-program-logs/v1';
            observation = createUnvalidatedObservation({
                sourceId: source.sourceId,
                providerId: source.providerId,
                transport: source.transport,
                receivedAtMs: now,
                observedAtMs: source.observedAt ?? null,
                slot,
                commitment: source.commitment ?? 'unknown',
                signature,
                transactionVersion: 'unknown',
                rawPayload,
                rawPayloadEncoding,
                schemaVersion,
                processingIntent: intent,
            });
        }
        catch (err) {
            log('feed_observation_rejected', { error: String(err) });
            return;
        }
        if (this.seen.has(signature))
            return;
        let receipt;
        try {
            receipt = await this.#ingress.submit(observation);
        }
        catch (err) {
            this.last = 0;
            this.readySince = now;
            log('feed_ingress_failed', { error: String(err) });
            return;
        }
        if (receipt.status !== 'ACCEPTED') {
            if (receipt.status === 'REJECTED') {
                if (receipt.reason === 'COMMITTED_DELIVERY_PENDING_RETRY') {
                    this.last = 0;
                    this.readySince = now;
                    log('feed_delivery_pending');
                }
                else if (receipt.reason !== 'NO_MATCHING_PROGRAM_EVENTS') {
                    this.last = 0;
                    this.readySince = now;
                    log('feed_consumer_rejected', { reason: receipt.reason });
                }
            }
            return receipt;
        }
        // Commit dedupe only after canonical ingress durably accepted the observation.
        if (!this.seen.add(signature))
            return receipt;
        if (this.stopped)
            return receipt;
        this.gapReconciler.registerSlot(slot, 1, false);
        const isLate = this.slot > 0 && slot < this.slot;
        if (!isLate) {
            if (now - this.last >= this.cfg.FEED_STALE_MS)
                this.readySince = now;
            this.last = now;
            this.slot = Math.max(this.slot, slot);
        }
        return receipt;
    }
    async start(sink, signal) {
        if (sink !== this.#ingress)
            throw new Error('OBSERVATION_INGRESS_MISMATCH');
        signal.addEventListener('abort', () => { void this.stop(); }, { once: true });
        await this.run();
    }
    async run() {
        await Promise.all([...this.cfg.WS_URLS.map((url, i) => this.websocket(url, i)), ...(this.cfg.YELLOWSTONE_URL ? [this.geyser()] : [])]);
    }
    async stop() { this.stopped = true; this.shutdown.abort(); for (const s of this.sockets)
        s.terminate(); this.grpcStream?.destroy(); }
    async reconnectDelay(ms) {
        try {
            await delay(ms, undefined, { signal: this.shutdown.signal });
        }
        catch (error) {
            if (!this.stopped)
                throw error;
        }
    }
    async websocket(url, index) {
        let backoff = 250;
        while (!this.stopped) {
            const started = Date.now();
            await new Promise(resolve => {
                const ws = new WebSocket(url, { handshakeTimeout: this.cfg.RPC_TIMEOUT_MS, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
                this.sockets.add(ws);
                let pong = Date.now(), traffic = Date.now();
                const timer = setInterval(() => {
                    if (Date.now() - pong > 30_000 || Date.now() - traffic > 30_000)
                        ws.terminate();
                    else if (ws.readyState === WebSocket.OPEN)
                        ws.ping();
                }, 10_000);
                ws.on('pong', () => { pong = Date.now(); });
                ws.on('open', () => {
                    ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMP_PROGRAM_ID.toBase58()] }, { commitment: 'confirmed' }] }));
                    log('websocket_connected', { endpointIndex: index });
                });
                ws.on('message', raw => {
                    traffic = Date.now();
                    try {
                        const m = JSON.parse(raw.toString());
                        if (m.error) {
                            ws.terminate();
                            return;
                        }
                        if (m.method === 'logsNotification' && m.params?.result?.value?.err === null) {
                            const r = m.params.result;
                            const frameBytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw);
                            void this.accept(r.value.signature, r.context.slot, r.value.logs, {
                                sourceId: `solana-ws-${index}`,
                                providerId: providerLabel(url),
                                transport: 'websocket.logsSubscribe',
                                commitment: 'confirmed',
                                rawPayload: frameBytes,
                                rawPayloadEncoding: 'JSON_FRAME_BYTES',
                            });
                        }
                    }
                    catch {
                        log('websocket_message_rejected', { endpointIndex: index });
                    }
                });
                ws.on('error', () => ws.terminate());
                ws.on('close', () => { clearInterval(timer); this.sockets.delete(ws); resolve(); });
            });
            if (!this.stopped) {
                backoff = Date.now() - started > 30_000 ? 250 : Math.min(backoff * 2, 10_000);
                log('websocket_reconnecting', { endpointIndex: index });
                await this.reconnectDelay(backoff + Math.random() * 250);
            }
        }
    }
    async geyser() {
        const module = await import('@triton-one/yellowstone-grpc');
        let backoff = 500;
        while (!this.stopped) {
            let watchdog;
            let client;
            let sessionStartedAt = 0;
            let sessionReceivedUpdate = false;
            try {
                client = this.yellowstoneClientFactory({
                    endpoint: this.cfg.YELLOWSTONE_URL,
                    token: this.cfg.YELLOWSTONE_TOKEN || undefined,
                    channelOptions: { 'grpc.keepalive_time_ms': 10_000, 'grpc.keepalive_timeout_ms': 5000, 'grpc.max_receive_message_length': 16 * 1024 * 1024 },
                    requestCodec: module.SubscribeRequest,
                    responseCodec: module.SubscribeUpdate,
                });
                const stream = client.subscribe();
                stream.on('error', () => { });
                if (this.stopped) {
                    stream.destroy();
                    return;
                }
                this.grpcStream = stream;
                let last = Date.now();
                watchdog = setInterval(() => { if (Date.now() - last > 30_000)
                    stream.destroy(); }, 5000);
                const request = { accounts: {}, slots: {}, transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM_ID.toBase58()], accountExclude: [], accountRequired: [] } }, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [], commitment: module.CommitmentLevel.CONFIRMED };
                await new Promise((resolve, reject) => stream.write(request, (e) => e ? reject(e) : resolve()));
                sessionStartedAt = Date.now();
                log('yellowstone_subscribed');
                for await (const captured of stream) {
                    sessionReceivedUpdate = true;
                    last = Date.now();
                    if (this.stopped)
                        break;
                    const update = captured.update;
                    if (update.ping)
                        stream.write({ ...request, ping: { id: 1 } });
                    await this.acceptYellowstoneCapture(captured);
                }
            }
            catch {
                log('yellowstone_reconnecting');
            }
            finally {
                if (watchdog)
                    clearInterval(watchdog);
                this.grpcStream?.destroy();
                this.grpcStream = undefined;
                try {
                    client?.close?.();
                }
                catch { }
            }
            if (!this.stopped) {
                backoff = yellowstoneBackoffAfterSession(backoff, sessionStartedAt ? Date.now() - sessionStartedAt : 0, sessionReceivedUpdate);
                await this.reconnectDelay(backoff + Math.random() * 250);
                backoff = Math.min(backoff * 2, 10_000);
            }
        }
    }
    async acceptYellowstoneCapture(captured) {
        const transaction = capturedTransactionObservation(captured);
        if (!transaction)
            return;
        await this.accept(transaction.signature, transaction.slot, transaction.logs, {
            sourceId: 'yellowstone-grpc',
            providerId: providerLabel(this.cfg.YELLOWSTONE_URL),
            transport: 'yellowstone.transaction.logs',
            commitment: 'confirmed',
            rawPayload: transaction.rawPayload,
            rawPayloadEncoding: 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES',
            capturedYellowstoneUpdate: captured,
        });
    }
}
//# sourceMappingURL=feed.js.map