import {
  ChannelCredentials,
  credentials,
  makeGenericClientConstructor,
  Metadata,
} from '@grpc/grpc-js';
import type { ChannelOptions, ClientDuplexStream } from '@grpc/grpc-js';
import bs58 from 'bs58';

type Codec<T> = {
  encode(value: T): { finish(): Uint8Array };
  decode(bytes: Uint8Array): T;
};

export interface CapturedUpdate<T> {
  readonly update: T;
}

const payloads = new WeakMap<object, Buffer>();

/** Reads a detached copy only for objects created by this module's gRPC deserializer. */
export function capturedPayloadBytes<T>(captured: CapturedUpdate<T>): Buffer | undefined {
  if (!captured || typeof captured !== 'object') return undefined;
  const bytes = payloads.get(captured as object);
  return bytes ? Buffer.from(bytes) : undefined;
}

/** Derives Feed fields and payload only from one decoder-produced capture object. */
export function capturedTransactionObservation(captured: CapturedUpdate<unknown>): {
  readonly signature: string;
  readonly slot: number;
  readonly logs: string[];
  readonly rawPayload: Buffer;
} | undefined {
  const rawPayload = capturedPayloadBytes(captured);
  const update = captured?.update as any;
  const transaction = update?.transaction?.transaction;
  const slot = Number(update?.transaction?.slot);
  const signatureBytes = transaction?.signature;
  const logs = transaction?.meta?.logMessages;
  if (!rawPayload || !Buffer.isBuffer(signatureBytes) || signatureBytes.length !== 64 ||
      !Number.isSafeInteger(slot) || slot < 0 || !transaction?.meta || transaction.meta.err ||
      !Array.isArray(logs) || logs.length === 0 || logs.some((line: unknown) => typeof line !== 'string')) return undefined;
  return Object.freeze({
    signature: bs58.encode(signatureBytes),
    slot,
    logs: [...logs],
    rawPayload,
  });
}

/** A narrow response adapter: the exact bytes handed to the pinned protobuf decoder are retained. */
export function createCapturedResponseDeserializer<T>(codec: Codec<T>) {
  return (input: Buffer): CapturedUpdate<T> => {
    if (!Buffer.isBuffer(input) || input.length === 0) throw new Error('YELLOWSTONE_EMPTY_PROTOBUF_MESSAGE');
    const bytes = Buffer.from(input);
    const update = codec.decode(bytes);
    const captured = Object.freeze({ update });
    payloads.set(captured, bytes);
    return captured;
  };
}

/** Builds only the existing bidi Subscribe method; callers retain SDK auth/TLS semantics. */
export function createCapturedSubscribeClient<TRequest, TUpdate>(args: {
  readonly endpoint: string;
  readonly token?: string;
  readonly channelOptions?: ChannelOptions;
  readonly requestCodec: Codec<TRequest>;
  readonly responseCodec: Codec<TUpdate>;
}) {
  const endpointURL = new URL(args.endpoint);
  let port = endpointURL.port;
  if (port === '') {
    if (endpointURL.protocol === 'https:') port = '443';
    else if (endpointURL.protocol === 'http:') port = '80';
  }
  let channelCredentials: ChannelCredentials;
  if (endpointURL.protocol === 'https:') {
    channelCredentials = credentials.combineChannelCredentials(
      credentials.createSsl(),
      credentials.createFromMetadataGenerator((_params, callback) => {
        const metadata = new Metadata();
        if (args.token !== undefined) metadata.add('x-token', args.token);
        callback(null, metadata);
      }),
    );
  } else {
    channelCredentials = ChannelCredentials.createInsecure();
  }

  const service = {
    subscribe: {
      path: '/geyser.Geyser/Subscribe',
      requestStream: true,
      responseStream: true,
      requestSerialize: (value: TRequest) => Buffer.from(args.requestCodec.encode(value).finish()),
      requestDeserialize: (value: Buffer) => args.requestCodec.decode(value),
      responseSerialize: (value: TUpdate) => Buffer.from(args.responseCodec.encode(value).finish()),
      responseDeserialize: createCapturedResponseDeserializer(args.responseCodec),
    },
  } as const;
  const Client = makeGenericClientConstructor(service, 'geyser.Geyser');
  const client = new Client(`${endpointURL.hostname}:${port}`, channelCredentials, args.channelOptions) as unknown as {
    subscribe(metadata?: Metadata): ClientDuplexStream<TRequest, CapturedUpdate<TUpdate>>;
    close(): void;
  };
  const metadata = new Metadata();
  if (endpointURL.protocol !== 'https:' && args.token) metadata.add('x-token', args.token);
  return {
    subscribe: () => client.subscribe(metadata),
    close: () => client.close(),
  };
}
