import { ChannelCredentials, credentials, makeGenericClientConstructor, Metadata, } from '@grpc/grpc-js';
import bs58 from 'bs58';
const payloads = new WeakMap();
/** Reads a detached copy only for objects created by this module's gRPC deserializer. */
export function capturedPayloadBytes(captured) {
    if (!captured || typeof captured !== 'object')
        return undefined;
    const evidence = payloads.get(captured);
    return evidence ? Buffer.from(evidence.bytes) : undefined;
}
/** Derives Feed fields and payload only from one decoder-produced capture object. */
export function capturedTransactionObservation(captured) {
    if (!captured || typeof captured !== 'object')
        return undefined;
    const evidence = payloads.get(captured);
    if (!evidence?.transaction)
        return undefined;
    return Object.freeze({
        signature: evidence.transaction.signature,
        slot: evidence.transaction.slot,
        logs: [...evidence.transaction.logs],
        rawPayload: Buffer.from(evidence.bytes),
    });
}
function snapshotTransaction(update) {
    const value = update;
    const transaction = value?.transaction?.transaction;
    const slot = Number(value?.transaction?.slot);
    const signatureBytes = transaction?.signature;
    const logs = transaction?.meta?.logMessages;
    if (!Buffer.isBuffer(signatureBytes) || signatureBytes.length !== 64 ||
        !Number.isSafeInteger(slot) || slot < 0 || !transaction?.meta || transaction.meta.err ||
        !Array.isArray(logs) || logs.length === 0 || logs.some((line) => typeof line !== 'string'))
        return undefined;
    return Object.freeze({ signature: bs58.encode(Buffer.from(signatureBytes)), slot, logs: Object.freeze([...logs]) });
}
/** A narrow response adapter: the exact bytes handed to the pinned protobuf decoder are retained. */
export function createCapturedResponseDeserializer(codec) {
    return (input) => {
        if (!Buffer.isBuffer(input) || input.length === 0)
            throw new Error('YELLOWSTONE_EMPTY_PROTOBUF_MESSAGE');
        const bytes = Buffer.from(input);
        // The protobuf decoder may retain Buffer views into its input. Decode a separate copy
        // and snapshot the fields used by Feed before exposing the SDK-shaped decoded object.
        const update = codec.decode(Buffer.from(bytes));
        const transaction = snapshotTransaction(update);
        const captured = Object.freeze({ update });
        payloads.set(captured, Object.freeze({ bytes, transaction }));
        return captured;
    };
}
export function yellowstoneBackoffAfterSession(currentBackoffMs, sessionDurationMs, receivedUpdate) {
    return receivedUpdate && Number.isFinite(sessionDurationMs) && sessionDurationMs >= 30_000 ? 500 : currentBackoffMs;
}
/** Builds only the existing bidi Subscribe method; callers retain SDK auth/TLS semantics. */
export function createCapturedSubscribeClient(args) {
    const endpointURL = new URL(args.endpoint);
    let port = endpointURL.port;
    if (port === '') {
        if (endpointURL.protocol === 'https:')
            port = '443';
        else if (endpointURL.protocol === 'http:')
            port = '80';
    }
    let channelCredentials;
    if (endpointURL.protocol === 'https:') {
        channelCredentials = credentials.combineChannelCredentials(credentials.createSsl(), credentials.createFromMetadataGenerator((_params, callback) => {
            const metadata = new Metadata();
            if (args.token !== undefined)
                metadata.add('x-token', args.token);
            callback(null, metadata);
        }));
    }
    else {
        channelCredentials = ChannelCredentials.createInsecure();
    }
    const service = {
        subscribe: {
            path: '/geyser.Geyser/Subscribe',
            requestStream: true,
            responseStream: true,
            requestSerialize: (value) => Buffer.from(args.requestCodec.encode(value).finish()),
            requestDeserialize: (value) => args.requestCodec.decode(value),
            responseSerialize: (value) => Buffer.from(args.responseCodec.encode(value).finish()),
            responseDeserialize: createCapturedResponseDeserializer(args.responseCodec),
        },
    };
    const Client = makeGenericClientConstructor(service, 'geyser.Geyser');
    const client = new Client(`${endpointURL.hostname}:${port}`, channelCredentials, args.channelOptions);
    const metadata = new Metadata();
    if (endpointURL.protocol !== 'https:' && args.token)
        metadata.add('x-token', args.token);
    return {
        subscribe: () => client.subscribe(metadata),
        close: () => client.close(),
    };
}
//# sourceMappingURL=yellowstone-captured-client.js.map