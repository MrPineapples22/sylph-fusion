import {
  ChannelCredentials,
  credentials,
  makeGenericClientConstructor,
  Metadata,
} from '@grpc/grpc-js';
import type { ChannelOptions, ClientDuplexStream } from '@grpc/grpc-js';
import bs58 from 'bs58';
import type { ProcessingIntent } from './types.js';

type Codec<T> = {
  encode(value: T): { finish(): Uint8Array };
  decode(bytes: Uint8Array): T;
};

export interface CapturedUpdate<T> {
  readonly update: T;
}

interface CapturedTransactionFields {
  readonly signature: string;
  readonly slot: number;
  readonly logs: readonly string[];
}

interface CapturedEvidence {
  readonly bytes: Buffer;
  readonly transaction?: CapturedTransactionFields;
}

const payloads = new WeakMap<object, CapturedEvidence>();

/** Reads a detached copy only for objects created by this module's gRPC deserializer. */
export function capturedPayloadBytes<T>(captured: CapturedUpdate<T>): Buffer | undefined {
  if (!captured || typeof captured !== 'object') return undefined;
  const evidence = payloads.get(captured as object);
  return evidence ? Buffer.from(evidence.bytes) : undefined;
}

/** Derives Feed fields and payload only from one decoder-produced capture object. */
export function capturedTransactionObservation(captured: CapturedUpdate<unknown>): {
  readonly signature: string;
  readonly slot: number;
  readonly logs: string[];
  readonly rawPayload: Buffer;
} | undefined {
  if (!captured || typeof captured !== 'object') return undefined;
  const evidence = payloads.get(captured as object);
  if (!evidence?.transaction) return undefined;
  return Object.freeze({
    signature: evidence.transaction.signature,
    slot: evidence.transaction.slot,
    logs: [...evidence.transaction.logs],
    rawPayload: Buffer.from(evidence.bytes),
  });
}

function snapshotTransaction<T>(update: T): CapturedTransactionFields | undefined {
  const value = update as any;
  const transaction = value?.transaction?.transaction;
  const slot = Number(value?.transaction?.slot);
  const signatureBytes = transaction?.signature;
  const logs = transaction?.meta?.logMessages;
  if (!Buffer.isBuffer(signatureBytes) || signatureBytes.length !== 64 ||
      !Number.isSafeInteger(slot) || slot < 0 || !transaction?.meta || transaction.meta.err ||
      !Array.isArray(logs) || logs.length === 0 || logs.some((line: unknown) => typeof line !== 'string')) return undefined;
  return Object.freeze({ signature: bs58.encode(Buffer.from(signatureBytes)), slot, logs: Object.freeze([...logs]) });
}

/** A narrow response adapter: the exact bytes handed to the pinned protobuf decoder are retained. */
export function createCapturedResponseDeserializer<T>(codec: Codec<T>) {
  return (input: Buffer): CapturedUpdate<T> => {
    if (!Buffer.isBuffer(input) || input.length === 0) throw new Error('YELLOWSTONE_EMPTY_PROTOBUF_MESSAGE');
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

export function yellowstoneBackoffAfterSession(currentBackoffMs: number, sessionDurationMs: number, receivedUpdate: boolean): number {
  return receivedUpdate && Number.isFinite(sessionDurationMs) && sessionDurationMs >= 30_000 ? 500 : currentBackoffMs;
}

/**
 * Tracks only Yellowstone transactions that completed canonical ingress. On a
 * reconnect, replay the last accepted slot inclusively (a slot can contain
 * multiple transactions) and keep every observation through the sampled
 * confirmed boundary historical. This is a transport recovery cursor, not a
 * contiguous-chain coverage certificate.
 */
export class YellowstoneReplayCursor {
  private lastAcceptedSlotValue = 0;
  private historicalThroughSlot: number | undefined;

  constructor(initialAcceptedSlot = 0) {
    if (!Number.isSafeInteger(initialAcceptedSlot) || initialAcceptedSlot < 0) throw new Error('YELLOWSTONE_REPLAY_SLOT_INVALID');
    this.lastAcceptedSlotValue = initialAcceptedSlot;
  }

  get lastAcceptedSlot(): number { return this.lastAcceptedSlotValue; }

  prepareReconnect(confirmedBoundarySlot: number): Readonly<{ fromSlot: string; historicalThroughSlot: number }> | undefined {
    if (this.lastAcceptedSlotValue === 0) return undefined;
    if (!Number.isSafeInteger(confirmedBoundarySlot) || confirmedBoundarySlot < 1) {
      throw new Error('YELLOWSTONE_REPLAY_BOUNDARY_INVALID');
    }
    if (confirmedBoundarySlot < this.lastAcceptedSlotValue) {
      throw new Error('YELLOWSTONE_REPLAY_BOUNDARY_BEHIND_CURSOR');
    }
    this.historicalThroughSlot = confirmedBoundarySlot;
    return Object.freeze({ fromSlot: String(this.lastAcceptedSlotValue), historicalThroughSlot: confirmedBoundarySlot });
  }

  intentFor(slot: number): ProcessingIntent {
    if (!Number.isSafeInteger(slot) || slot < 0) throw new Error('YELLOWSTONE_REPLAY_SLOT_INVALID');
    return this.historicalThroughSlot !== undefined && slot <= this.historicalThroughSlot
      ? 'HISTORICAL_REPAIR'
      : 'LIVE';
  }

  recordAccepted(slot: number): void {
    if (!Number.isSafeInteger(slot) || slot < 0) throw new Error('YELLOWSTONE_REPLAY_SLOT_INVALID');
    this.lastAcceptedSlotValue = Math.max(this.lastAcceptedSlotValue, slot);
  }
}

export function buildYellowstoneSubscriptionRequest<T extends Record<string, unknown>>(
  request: T,
  replay: Readonly<{ fromSlot: string }> | undefined,
): T & { readonly fromSlot?: string } {
  return Object.freeze({ ...request, ...(replay ? { fromSlot: replay.fromSlot } : {}) });
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
