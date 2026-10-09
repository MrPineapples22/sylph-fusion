import { ChannelCredentials, credentials, makeGenericClientConstructor, Metadata, } from '@grpc/grpc-js';
import bs58 from 'bs58';
const payloads = new WeakMap();
/** Reads a detached copy only for objects created by this module's gRPC deserializer. */
export function capturedPayloadBytes(captured) {
    if (!captured || typeof captured !== 'object')
        return undefined;
    const bytes = payloads.get(captured);
    return bytes ? Buffer.from(bytes) : undefined;
}
/** Derives Feed fields and payload only from one decoder-produced capture object. */
export function capturedTransactionObservation(captured) {
    const rawPayload = capturedPayloadBytes(captured);
    const update = captured?.update;
    const transaction = update?.transaction?.transaction;
    const slot = Number(update?.transaction?.slot);
    const signatureBytes = transaction?.signature;
    const logs = transaction?.meta?.logMessages;
    if (!rawPayload || !Buffer.isBuffer(signatureBytes) || signatureBytes.length !== 64 ||
        !Number.isSafeInteger(slot) || slot < 0 || !transaction?.meta || transaction.meta.err ||
        !Array.isArray(logs) || logs.length === 0 || logs.some((line) => typeof line !== 'string'))
        return undefined;
    return Object.freeze({
        signature: bs58.encode(signatureBytes),
        slot,
        logs: [...logs],
        rawPayload,
    });
}
/** A narrow response adapter: the exact bytes handed to the pinned protobuf decoder are retained. */
export function createCapturedResponseDeserializer(codec) {
    return (input) => {
        if (!Buffer.isBuffer(input) || input.length === 0)
            throw new Error('YELLOWSTONE_EMPTY_PROTOBUF_MESSAGE');
        const bytes = Buffer.from(input);
        const update = codec.decode(bytes);
        const captured = Object.freeze({ update });
        payloads.set(captured, bytes);
        return captured;
    };
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