import { EventParser } from '@coral-xyz/anchor';
import { getPumpProgram, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import WebSocket from 'ws';
import bs58 from 'bs58';
import { setTimeout as delay } from 'node:timers/promises';
import { BoundedSet, log } from './core.js';
import { IngestionGapReconciler } from './platform/ingestion/gap-reconciler.js';
export class Feed {
    cfg;
    consume;
    parser;
    seen = new BoundedSet(100_000, 300_000);
    sockets = new Set();
    grpcStream;
    stopped = false;
    gapReconciler = new IngestionGapReconciler();
    last = 0;
    slot = 0;
    readySince = 0;
    constructor(cfg, connection, consume) {
        this.cfg = cfg;
        this.consume = consume;
        this.parser = new EventParser(PUMP_PROGRAM_ID, getPumpProgram(connection).coder);
    }
    healthy() { const age = Date.now() - this.last; return !this.stopped && this.last > 0 && age >= 0 && age < this.cfg.FEED_STALE_MS && Date.now() - this.readySince >= this.cfg.MIN_AGE_MS; }
    accept(signature, slot, logs) {
        const now = Date.now();
        if (this.stopped || !Number.isSafeInteger(slot) || slot < 0 || typeof signature !== 'string' || !signature || !Array.isArray(logs) || logs.length === 0 || logs.some(line => typeof line !== 'string'))
            return;
        // Replayed or out-of-window messages cannot renew the trading freshness gate.
        if (slot + 32 < this.slot)
            return;
        const decoded = [];
        try {
            // Anchor's invocation-stack parser rejects events emitted by unrelated CPI programs.
            for (const event of this.parser.parseLogs(logs, false)) {
                if (decoded.length >= 256)
                    throw new Error('Too many events in one transaction');
                decoded.push({ name: event.name, data: event.data, signature, slot, received: now });
            }
        }
        catch {
            log('feed_decode_rejected');
            return;
        }
        if (!decoded.length || !this.seen.add(signature))
            return;
        try {
            for (const event of decoded)
                this.consume(event);
        }
        catch {
            this.last = 0;
            this.readySince = now;
            log('feed_consumer_rejected');
            return;
        }
        if (this.stopped)
            return;
        this.gapReconciler.registerSlot(slot);
        if (now - this.last >= this.cfg.FEED_STALE_MS)
            this.readySince = now;
        this.last = now;
        this.slot = Math.max(this.slot, slot);
    }
    async run() {
        await Promise.all([...this.cfg.WS_URLS.map((url, i) => this.websocket(url, i)), ...(this.cfg.YELLOWSTONE_URL ? [this.geyser()] : [])]);
    }
    stop() { this.stopped = true; for (const s of this.sockets)
        s.terminate(); this.grpcStream?.destroy(); }
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
                            this.accept(r.value.signature, r.context.slot, r.value.logs);
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
                await delay(backoff + Math.random() * 250);
            }
        }
    }
    async geyser() {
        const module = await import('@triton-one/yellowstone-grpc');
        // CJS default interop differs between Node and TS; resolve the actual exported class.
        const Client = (typeof module.default === 'function' ? module.default : module.default.default);
        let backoff = 500;
        while (!this.stopped) {
            let watchdog;
            let client;
            try {
                client = new Client(this.cfg.YELLOWSTONE_URL, this.cfg.YELLOWSTONE_TOKEN || undefined, { 'grpc.keepalive_time_ms': 10_000, 'grpc.keepalive_timeout_ms': 5000, 'grpc.max_receive_message_length': 16 * 1024 * 1024 });
                const stream = await client.subscribe();
                stream.on('error', () => { });
                this.grpcStream = stream;
                let last = Date.now();
                watchdog = setInterval(() => { if (Date.now() - last > 30_000)
                    stream.destroy(); }, 5000);
                const request = { accounts: {}, slots: {}, transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM_ID.toBase58()], accountExclude: [], accountRequired: [] } }, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [], commitment: module.CommitmentLevel.CONFIRMED };
                await new Promise((resolve, reject) => stream.write(request, (e) => e ? reject(e) : resolve()));
                log('yellowstone_subscribed');
                for await (const update of stream) {
                    last = Date.now();
                    backoff = 500;
                    if (this.stopped)
                        break;
                    if (update.ping)
                        stream.write({ ...request, ping: { id: 1 } });
                    const tx = update.transaction?.transaction;
                    if (tx?.meta && !tx.meta.err)
                        this.accept(bs58.encode(tx.signature), Number(update.transaction.slot), tx.meta.logMessages);
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
                    client?._client?.close?.();
                }
                catch { }
            }
            if (!this.stopped) {
                await delay(backoff + Math.random() * 250);
                backoff = Math.min(backoff * 2, 10_000);
            }
        }
    }
}
//# sourceMappingURL=feed.js.map