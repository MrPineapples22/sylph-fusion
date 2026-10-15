import { Connection } from '@solana/web3.js';
import { PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import WebSocket from 'ws';
import bs58 from 'bs58';
import { setTimeout as delay } from 'node:timers/promises';
import { BoundedSet, log } from './core.js';
import type { Config } from './config.js';
import { IngestionGapReconciler } from './platform/ingestion/gap-reconciler.js';
import { CensusRJournalAuthority, type BankIdentityStatus } from './platform/ingestion/census-r.js';
import { buildYellowstoneSubscriptionRequest, capturedTransactionObservation, createCapturedSubscribeClient, yellowstoneBackoffAfterSession, YellowstoneReplayCursor } from './platform/ingestion/yellowstone-captured-client.js';
import type { RawObservationEnvelope, ProcessingIntent } from './platform/ingestion/types.js';
import type { ObservationIngressPort, ObservationSource } from './platform/ingress/port.js';
import { createUnvalidatedObservation } from './platform/ingress/observation-factory.js';
import type { IngressReceipt, RawPayloadEncoding, UnvalidatedObservation } from './platform/ingress/types.js';
import { globalProviderHealthTracker, type ProviderHealthTracker } from './platform/ingestion/provider-health.js';

function providerLabel(endpoint: string): string {
  try { return new URL(endpoint).origin; }
  catch { return 'unparseable-provider'; }
}

function ingressProvidersForTransport(transport?: string): readonly string[] {
  if (transport?.startsWith('websocket.')) return ['SOLANA_WSS'];
  if (transport?.startsWith('yellowstone.')) return ['YELLOWSTONE_GRPC'];
  // Older persisted incidents and unknown transports lack enough provenance
  // to safely narrow the affected provider set.
  return ['SOLANA_WSS', 'YELLOWSTONE_GRPC'];
}

function websocketAuthenticationRequirement(endpoints: readonly string[]): 'REQUIRED' | 'NOT_REQUIRED' | 'UNKNOWN' {
  let credentialed = false;
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'wss:' && url.protocol !== 'https:') continue;
      if (url.username || url.password || [...url.searchParams.keys()].some(key => /^(?:api[-_]?key|access[-_]?token|token|authorization)$/i.test(key))) {
        credentialed = true;
        continue;
      }
      if (['api.mainnet-beta.solana.com', 'solana.publicnode.com'].includes(url.hostname.toLowerCase())) return 'NOT_REQUIRED';
    } catch { /* Unknown endpoints remain unclassified. */ }
  }
  return credentialed ? 'REQUIRED' : 'UNKNOWN';
}

function validateSource(source: { sourceId: string; providerId: string; transport: string; commitment?: RawObservationEnvelope['commitment']; observedAt?: number; bankHash?: string; bankIdentityStatus?: BankIdentityStatus }): void {
  const safeLabel = /^[A-Za-z0-9_.:-]{1,128}$/;
  const safeOrigin = /^(https?|wss?):\/\/[^/?#@]+$/;
  if (typeof source.sourceId !== 'string' || typeof source.providerId !== 'string' || typeof source.transport !== 'string' || !safeLabel.test(source.sourceId) || !(safeLabel.test(source.providerId) || safeOrigin.test(source.providerId)) || !safeLabel.test(source.transport)) throw new Error('RAW_OBSERVATION_INVALID_SOURCE');
  if (source.commitment !== undefined && !['processed', 'confirmed', 'finalized', 'unknown'].includes(source.commitment)) throw new Error('RAW_OBSERVATION_INVALID_COMMITMENT');
  if (source.observedAt !== undefined && (!Number.isFinite(source.observedAt) || source.observedAt < 0)) throw new Error('RAW_OBSERVATION_INVALID_TIME');
  if (source.bankIdentityStatus !== undefined && !['VERIFIED', 'UNKNOWN'].includes(source.bankIdentityStatus)) throw new Error('RAW_OBSERVATION_INVALID_BANK_IDENTITY_STATUS');
  if (source.bankIdentityStatus === 'VERIFIED') {
    try {
      if (typeof source.bankHash !== 'string' || bs58.decode(source.bankHash).length !== 32) throw new Error('INVALID_BLOCKHASH');
    } catch { throw new Error('RAW_OBSERVATION_INVALID_VERIFIED_BLOCKHASH'); }
  }
}

export type MarketEvent = { name: string; data: Record<string, any>; signature: string; slot: number; received: number; observation: RawObservationEnvelope | UnvalidatedObservation };
type YellowstoneClientFactory = typeof createCapturedSubscribeClient;
type WebSocketFactory = (url: string, options: WebSocket.ClientOptions) => WebSocket;
export type FeedIngressFault = Readonly<{ reason: string; detail?: string; slot?: number; signature?: string; transport?: string; observedAtMs: number }>;
type PendingIngress = {
  bytes: number;
  run: () => Promise<IngressReceipt | void>;
  resolve: (receipt: IngressReceipt | void) => void;
  reject: (error: Error) => void;
};
export class Feed implements ObservationSource {
  // WebSocket providers can deliver a burst of already-buffered frames after
  // pause() is requested. Keep enough bounded item capacity for that burst,
  // while the byte ceiling remains the hard memory bound.
  private static readonly MAX_PENDING_INGRESS = 256;
  private static readonly MAX_PENDING_INGRESS_BYTES = 16 * 1024 * 1024;
  private static readonly PAUSE_PENDING_INGRESS = 16;
  private static readonly PAUSE_PENDING_INGRESS_BYTES = 8 * 1024 * 1024;
  private static readonly RESUME_PENDING_INGRESS = 8;
  private static readonly RESUME_PENDING_INGRESS_BYTES = 4 * 1024 * 1024;
  readonly #ingress: ObservationIngressPort;
  readonly sourceId = 'feed-solana-pump';
  private seen = new BoundedSet(100_000, 300_000);
  private sockets = new Set<WebSocket>();
  private grpcStream: { destroy(): unknown } | undefined;
  private stopped = false;
  private ingressFault: string | null = null;
  private readonly pendingIngress: PendingIngress[] = [];
  // Multiple subscriptions commonly report the same transaction. Keep a
  // signature's first in-flight admission visible so duplicates share its
  // durable result instead of consuming queue slots behind it.
  private readonly pendingIngressBySignature = new Map<string, Promise<IngressReceipt | void>>();
  private pendingIngressBytes = 0;
  private activeIngressBytes = 0;
  private ingressDrain: Promise<void> | null = null;
  private ingressFaultPersistence: Promise<void> | null = null;
  private stopTask: Promise<void> | null = null;
  private readonly pausedSockets = new Set<WebSocket>();
  private onFatalIngressFault?: (fault: FeedIngressFault) => Promise<void> | void;
  private onCleanSessionClose?: (lastAcceptedYellowstoneSlot: number) => Promise<void>;
  private readonly shutdown = new AbortController();
  readonly gapReconciler = new IngestionGapReconciler();
  private yellowstoneReplayCursor = new YellowstoneReplayCursor();
  private lastPersistedYellowstoneSlot = 0;
  private yellowstoneSubscribedOnce = false;
  private onYellowstoneCheckpoint?: (slot: number) => Promise<void>;
  readonly censusJournal: CensusRJournalAuthority;
  private readonly providerHealth: ProviderHealthTracker;
  last = 0;
  slot = 0;
  readySince = 0;

  constructor(private cfg: Config, private readonly connection: Connection, ingress: ObservationIngressPort,
    private readonly yellowstoneClientFactory: YellowstoneClientFactory = createCapturedSubscribeClient,
    censusJournal?: CensusRJournalAuthority,
    providerHealth: ProviderHealthTracker = globalProviderHealthTracker,
    private readonly webSocketFactory: WebSocketFactory = (url, options) => new WebSocket(url, options)) {
    if (typeof ingress === 'function' || !ingress || typeof ingress.submit !== 'function') {
      throw new Error(
        'FEED_CALLBACK_BYPASS_FORBIDDEN: Feed requires an ObservationIngressPort instance. Arbitrary callback functions are strictly prohibited.'
      );
    }
    this.#ingress = ingress;
    this.providerHealth = providerHealth;
    this.censusJournal = censusJournal ?? new CensusRJournalAuthority();
    const wsConfigured = Array.isArray(cfg.WS_URLS) && cfg.WS_URLS.length > 0;
    const wsAuthenticationRequirement = websocketAuthenticationRequirement(cfg.WS_URLS ?? []);
    this.providerHealth.setProviderConfiguration('SOLANA_WSS', wsConfigured, wsConfigured,
      wsAuthenticationRequirement === 'NOT_REQUIRED', wsAuthenticationRequirement);
    this.providerHealth.recordEndpointTransition('SOLANA_WSS', 'wss://solana-ws.invalid',
      wsConfigured ? cfg.WS_URLS[0]! : 'wss://solana-ws.invalid');
    const geyserConfigured = typeof cfg.YELLOWSTONE_URL === 'string' && cfg.YELLOWSTONE_URL.length > 0;
    this.providerHealth.setProviderConfiguration('YELLOWSTONE_GRPC', geyserConfigured, geyserConfigured, false,
      cfg.YELLOWSTONE_TOKEN ? 'REQUIRED' : 'UNKNOWN');
    this.providerHealth.recordEndpointTransition('YELLOWSTONE_GRPC', 'https://yellowstone-grpc.invalid',
      geyserConfigured ? cfg.YELLOWSTONE_URL : 'https://yellowstone-grpc.invalid');
  }

  setFatalIngressFaultHandler(handler: (fault: FeedIngressFault) => Promise<void> | void): void {
    if (!this.onFatalIngressFault) this.onFatalIngressFault = handler;
    else if (this.onFatalIngressFault !== handler) {
      const previous = this.onFatalIngressFault;
      this.onFatalIngressFault = async fault => {
        const results = await Promise.allSettled([Promise.resolve().then(() => previous(fault)), Promise.resolve().then(() => handler(fault))]);
        const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failure) throw failure.reason;
      };
    }
  }

  setYellowstoneCheckpointHandler(handler: (slot: number) => Promise<void>): void {
    if (this.onYellowstoneCheckpoint && this.onYellowstoneCheckpoint !== handler) throw new Error('YELLOWSTONE_CHECKPOINT_HANDLER_ALREADY_SET');
    this.onYellowstoneCheckpoint = handler;
  }

  restoreYellowstoneReplayCursor(lastAcceptedSlot: number): void {
    if (this.yellowstoneSubscribedOnce || this.yellowstoneReplayCursor.lastAcceptedSlot !== 0) throw new Error('YELLOWSTONE_REPLAY_CURSOR_ALREADY_STARTED');
    this.yellowstoneReplayCursor = new YellowstoneReplayCursor(lastAcceptedSlot);
    this.lastPersistedYellowstoneSlot = lastAcceptedSlot;
    this.yellowstoneSubscribedOnce = lastAcceptedSlot > 0;
  }

  setCleanSessionCloseHandler(handler: (lastAcceptedYellowstoneSlot: number) => Promise<void>): void {
    if (this.onCleanSessionClose && this.onCleanSessionClose !== handler) throw new Error('FEED_SESSION_CLOSE_HANDLER_ALREADY_SET');
    this.onCleanSessionClose = handler;
  }

  restoreIngressFault(fault: FeedIngressFault): void {
    if (!fault || typeof fault.reason !== 'string' || !fault.reason || !Number.isSafeInteger(fault.observedAtMs)) {
      throw new Error('FEED_INGRESS_FAULT_INVALID');
    }
    this.ingressFault = fault.reason;
    this.last = 0;
    this.readySince = Date.now();
    for (const providerId of ingressProvidersForTransport(fault.transport)) this.providerHealth.recordFailure(providerId, fault.reason);
  }

  public isIngressBound(port: unknown): boolean {
    return this.#ingress === port;
  }

  healthy() { const age = Date.now() - this.last; return !this.stopped && !this.ingressFault && this.last > 0 && age >= 0 && age < this.cfg.FEED_STALE_MS && Date.now() - this.readySince >= this.cfg.MIN_AGE_MS; }

  accept(
    signature: string,
    slot: number,
    logs: string[],
    source: {
      sourceId: string;
      providerId: string;
      transport: string;
      commitment?: RawObservationEnvelope['commitment'];
      observedAt?: number;
      bankHash?: string;
      bankIdentityStatus?: BankIdentityStatus;
      isRepair?: boolean;
      allowLate?: boolean;
      processingIntent?: ProcessingIntent;
      rawPayload?: Uint8Array;
      rawPayloadEncoding?: RawPayloadEncoding;
      capturedYellowstoneUpdate?: Parameters<typeof capturedTransactionObservation>[0];
    } = { sourceId: 'unknown', providerId: 'unknown', transport: 'unknown', commitment: 'unknown' },
    socket?: WebSocket,
  ): Promise<IngressReceipt | void> {
    const processingIntent = source.processingIntent ?? (source.isRepair ? 'HISTORICAL_REPAIR' : 'LIVE');
    return this.admitIngress(snapshot => this.processAcceptance(
      snapshot.signature, snapshot.slot, snapshot.logs, snapshot.source,
    ), { ...source, processingIntent, signature, slot, logs }, socket);
  }

  private async processAcceptance(
    signature: string,
    slot: number,
    logs: string[],
    source: {
      sourceId: string; providerId: string; transport: string; commitment?: RawObservationEnvelope['commitment'];
      observedAt?: number; isRepair?: boolean; allowLate?: boolean; processingIntent?: ProcessingIntent;
      bankHash?: string; bankIdentityStatus?: BankIdentityStatus;
      rawPayload?: Uint8Array; rawPayloadEncoding?: RawPayloadEncoding;
      capturedYellowstoneUpdate?: Parameters<typeof capturedTransactionObservation>[0];
    }
  ): Promise<IngressReceipt | void> {
    const now = Date.now();
    // An explicit intent is authoritative. The legacy isRepair flag is only
    // a compatibility path for callers that have not yet supplied an intent.
    const intent: ProcessingIntent = source.processingIntent ?? (source.isRepair ? 'HISTORICAL_REPAIR' : 'LIVE');
    const isLive = intent === 'LIVE';
    const isHistoricalRepair = intent === 'HISTORICAL_REPAIR';
    if (
      !Number.isSafeInteger(slot) ||
      slot < 0 ||
      (this.slot > 0 && slot < this.slot && isLive && !source?.allowLate) ||
      (this.slot > 0 && isLive && this.slot - slot > 1000) ||
      typeof signature !== 'string' ||
      !signature ||
      !Array.isArray(logs) ||
      logs.length === 0 ||
      logs.some(line => typeof line !== 'string')
    ) {
      return;
    }
    try {
      validateSource(source);
    } catch {
      log('feed_source_rejected');
      return;
    }
    if (source.rawPayloadEncoding === 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES') {
      const bound = capturedTransactionObservation(source.capturedYellowstoneUpdate!);
      if (!bound || source.transport !== 'yellowstone.transaction.logs' || bound.signature !== signature ||
          bound.slot !== slot || bound.logs.length !== logs.length || bound.logs.some((line, index) => line !== logs[index]) ||
          !source.rawPayload || !Buffer.from(source.rawPayload).equals(bound.rawPayload)) {
        log('feed_source_rejected');
        return;
      }
    }

    let observation: UnvalidatedObservation;
    try {
      // WebSocket supplies the original JSON-RPC frame. Yellowstone exposes decoded
      // protobuf updates; JSON.stringify output is serialized JSON, not canonical JSON.
      const rawPayload = source.rawPayload ?? (
        source.transport === 'yellowstone.transaction.logs'
          ? Buffer.from(JSON.stringify({ transaction: { transaction: { meta: { logMessages: logs } } } }))
          : Buffer.from(JSON.stringify(logs))
      );
      const rawPayloadEncoding: RawPayloadEncoding =
        source.rawPayloadEncoding ?? (
          source.rawPayload
            ? 'UNSPECIFIED'
            : source.transport === 'yellowstone.transaction.logs'
              ? 'DECODED_PROTOBUF_JSON_SERIALIZED_BYTES'
              : 'JSON_SERIALIZED_BYTES'
        );
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
    } catch (err) {
      log('feed_observation_rejected', { error: String(err) });
      return;
    }

    if (this.seen.has(signature)) return;

    let receipt: IngressReceipt;
    try {
      receipt = await this.#ingress.submit(observation);
    } catch (err) {
      log('feed_ingress_failed', { error: String(err) });
      if (isLive) {
        this.last = 0;
        this.readySince = now;
        this.latchIngressFault('FEED_CANONICAL_INGRESS_FAILURE', { slot, signature, transport: source.transport }, String(err).slice(0, 512));
      }
      return;
    }

    if (receipt.status === 'REJECTED') {
        if (receipt.reason === 'COMMITTED_DELIVERY_PENDING_RETRY') {
          if (isLive) {
            this.last = 0;
            this.readySince = now;
          }
          log('feed_delivery_pending');
        } else if (receipt.reason !== 'NO_MATCHING_PROGRAM_EVENTS') {
          if (isLive) {
            this.last = 0;
            this.readySince = now;
          }
          log('feed_consumer_rejected', { reason: receipt.reason });
          if (isLive && /^(JOURNAL_LOOKUP_FAILED|JOURNAL_APPEND_FAILED|INGRESS_COMMIT_HALTED|COMMITTED_DELIVERY_PENDING_RETRY|INGRESS_OUTBOX_RECOVERY_PENDING|DURABLE_STORE_INGRESS_JOURNAL_REQUIRED)(:|$)/.test(receipt.reason)) {
            this.latchIngressFault('FEED_CANONICAL_INGRESS_FAILURE', { slot, signature, transport: source.transport }, receipt.reason.slice(0, 512));
          }
        }
      return receipt;
    }
    if (receipt.status !== 'ACCEPTED' && receipt.status !== 'DUPLICATE') return receipt;

    // Durably journal accepted observation in Census-R canonical event journal
    try {
      const bankIdentityStatus = source.bankIdentityStatus === 'VERIFIED' ? 'VERIFIED' : 'UNKNOWN';
      const bankHash = bankIdentityStatus === 'VERIFIED' ? source.bankHash! : `unknown-slot-${slot}`;
      const providerTimestamp = source.observedAt ?? now;
      if (isHistoricalRepair || source.allowLate) {
        this.censusJournal.ingestLateEvent({
          slot,
          bankHash,
          bankIdentityStatus,
          txHash: signature,
          eventIndex: 0,
          providerId: source.providerId,
          providerTimestampMs: providerTimestamp,
          eventType: 'SOLANA_TRANSACTION_OBSERVATION',
          payload: { logsCount: logs.length, signature, transport: source.transport, bankIdentityStatus },
        });
      } else {
        this.censusJournal.commitTransactionBatch({
          slot,
          bankHash,
          bankIdentityStatus,
          txHash: signature,
          providerId: source.providerId,
          providerTimestampMs: providerTimestamp,
          events: [
            {
              eventType: 'SOLANA_TRANSACTION_OBSERVATION',
              payload: { logsCount: logs.length, signature, transport: source.transport, bankIdentityStatus },
            },
          ],
        });
      }
    } catch (journalErr) {
      log('feed_census_journal_commit_failed', { error: String(journalErr) });
      // Canonical ingress may already have committed this observation. Leave
      // it retryable in the local dedupe set and surface the incomplete
      // secondary projection without relabeling historical evidence as LIVE.
      if (isLive) {
        this.last = 0;
        this.readySince = now;
        this.latchIngressFault('FEED_CENSUS_JOURNAL_FAILURE', { slot, signature, transport: source.transport }, String(journalErr).slice(0, 512));
      }
      return Object.freeze({ ...receipt, postCommitWarning: 'CENSUS_JOURNAL_WRITE_FAILED' });
    }

    // Commit dedupe only after both canonical ingress and the secondary journal
    // projection complete. A canonical DUPLICATE can still finish a prior
    // post-commit repair without duplicating the ingress event.
    if (!this.seen.add(signature)) return receipt;
    // Provider capability health means the accepted observation completed all
    // local validation and required journal projections, not merely ingress.
    // Record it only after both canonical ingress and Census-R have committed.
    if (isLive && source.transport === 'yellowstone.transaction.logs') {
      const configured = typeof this.cfg.YELLOWSTONE_URL === 'string' && this.cfg.YELLOWSTONE_URL.length > 0;
      const tokenConfigured = Boolean(this.cfg.YELLOWSTONE_TOKEN);
      this.providerHealth.setProviderConfiguration('YELLOWSTONE_GRPC', configured, configured, tokenConfigured,
        tokenConfigured ? 'REQUIRED' : 'UNKNOWN');
      // The time from accept() entry through canonical ingress is not network
      // latency. Zero preserves validated-observation freshness without
      // inventing a provider latency measurement.
      this.providerHealth.recordValidatedObservation('YELLOWSTONE_GRPC', 0);
    } else if (isLive && source.transport === 'websocket.logsSubscribe') {
      const requirement = websocketAuthenticationRequirement(this.cfg.WS_URLS ?? []);
      this.providerHealth.setProviderConfiguration('SOLANA_WSS', true, true, requirement === 'REQUIRED' || requirement === 'NOT_REQUIRED', requirement);
      this.providerHealth.recordValidatedObservation('SOLANA_WSS', 0);
    }
    this.gapReconciler.registerSlot(slot, 1, false);
    const isLate = this.slot > 0 && slot < this.slot;
    if (isLive && !isLate) {
      if (now - this.last >= this.cfg.FEED_STALE_MS) this.readySince = now;
      this.last = now;
      this.slot = Math.max(this.slot, slot);
    }
    return receipt;
  }

  private admitIngress(
    run: (snapshot: { source: Parameters<Feed['processAcceptance']>[3]; signature: string; slot: number; logs: string[] }) => Promise<IngressReceipt | void>,
    source: Parameters<Feed['processAcceptance']>[3] & { signature: string; slot: number; logs: string[] },
    socket?: WebSocket,
  ): Promise<IngressReceipt | void> {
    if (this.ingressFault) return Promise.reject(new Error(this.ingressFault));
    if (this.stopped) return Promise.resolve(undefined);
    const signature = typeof source.signature === 'string' ? source.signature : '';
    if (signature) {
      const pending = this.pendingIngressBySignature.get(signature);
      if (pending) return pending;
    }
    let bytes = source.rawPayload?.byteLength;
    if (!Number.isSafeInteger(bytes) || bytes! < 0) {
      try { bytes = Buffer.byteLength(JSON.stringify({ signature: source.signature, slot: source.slot, logs: source.logs })); }
      catch { bytes = Feed.MAX_PENDING_INGRESS_BYTES + 1; }
    }
    const outstanding = this.pendingIngress.length + (this.ingressDrain ? 1 : 0);
    const outstandingBytes = this.pendingIngressBytes + this.activeIngressBytes;
    if (outstanding >= Feed.MAX_PENDING_INGRESS || outstandingBytes + bytes! > Feed.MAX_PENDING_INGRESS_BYTES) {
      if ((source.processingIntent ?? 'LIVE') === 'LIVE') this.latchIngressFault('FEED_INGRESS_QUEUE_OVERFLOW', source);
      return Promise.reject(new Error('FEED_INGRESS_QUEUE_OVERFLOW'));
    }
    // Snapshot mutable transport buffers and caller-owned log arrays only after
    // admission succeeds, so queue backpressure remains the memory bound while
    // waiting work cannot be rewritten by a later provider/caller mutation.
    const snapshotSource = {
      ...source,
      ...(source.rawPayload ? { rawPayload: Uint8Array.from(source.rawPayload) } : {}),
    };
    const snapshot = {
      source: snapshotSource,
      signature,
      slot: source.slot!,
      logs: Array.isArray(source.logs) ? [...source.logs] : source.logs,
    };
    const admission = new Promise<IngressReceipt | void>((resolve, reject) => {
      this.pendingIngress.push({ bytes: bytes!, run: () => run(snapshot), resolve, reject });
      this.pendingIngressBytes += bytes!;
      this.applyBackpressure();
      if (!this.ingressDrain) this.ingressDrain = this.drainIngress();
    });
    if (signature) {
      this.pendingIngressBySignature.set(signature, admission);
      void admission.then(
        () => { if (this.pendingIngressBySignature.get(signature) === admission) this.pendingIngressBySignature.delete(signature); },
        () => { if (this.pendingIngressBySignature.get(signature) === admission) this.pendingIngressBySignature.delete(signature); },
      );
    }
    return admission;
  }

  private applyBackpressure(): void {
    const count = this.pendingIngress.length + (this.ingressDrain ? 1 : 0);
    const bytes = this.pendingIngressBytes + this.activeIngressBytes;
    if (count >= Feed.PAUSE_PENDING_INGRESS || bytes >= Feed.PAUSE_PENDING_INGRESS_BYTES) {
      for (const socket of this.sockets) {
        if (socket.readyState === WebSocket.OPEN && !this.pausedSockets.has(socket)) {
          socket.pause();
          this.pausedSockets.add(socket);
        }
      }
    } else if (count <= Feed.RESUME_PENDING_INGRESS && bytes <= Feed.RESUME_PENDING_INGRESS_BYTES) {
      for (const socket of this.pausedSockets) {
        this.pausedSockets.delete(socket);
        if (!this.stopped && !this.ingressFault && socket.readyState === WebSocket.OPEN) socket.resume();
      }
    }
  }

  private async drainIngress(): Promise<void> {
    try {
      while (this.pendingIngress.length) {
        const item = this.pendingIngress.shift()!;
        this.pendingIngressBytes -= item.bytes;
        this.activeIngressBytes = item.bytes;
        this.applyBackpressure();
        try { item.resolve(await item.run()); }
        catch (error) { item.reject(error instanceof Error ? error : new Error(String(error))); }
        finally {
          this.activeIngressBytes = 0;
          this.applyBackpressure();
        }
      }
    } finally {
      this.ingressDrain = null;
      // A message can be admitted between the loop's final check and this
      // microtask. Re-arm the serial drain without opening a parallel lane.
      if (this.pendingIngress.length && !this.ingressDrain) this.ingressDrain = this.drainIngress();
    }
  }

  private latchIngressFault(reason: string, source: { slot?: number; signature?: string; transport?: string }, detail?: string): void {
    if (this.ingressFault) return;
    this.ingressFault = reason;
    this.last = 0;
    const fault: FeedIngressFault = Object.freeze({ reason, detail, slot: source.slot, signature: source.signature,
      transport: source.transport, observedAtMs: Date.now() });
    this.readySince = fault.observedAtMs;
    log('feed_ingress_halted', { ...fault, queued: this.pendingIngress.length, queuedBytes: this.pendingIngressBytes });
    for (const providerId of ingressProvidersForTransport(source.transport)) this.providerHealth.recordFailure(providerId, reason);
    for (const socket of this.sockets) socket.terminate();
    this.grpcStream?.destroy();
    try { this.ingressFaultPersistence = Promise.resolve(this.onFatalIngressFault?.(fault)).then(() => undefined); }
    catch (error) { this.ingressFaultPersistence = Promise.reject(error); }
    this.ingressFaultPersistence.catch(error => log('feed_ingress_fault_persistence_failed', { reason, error: String(error) }));
  }

  async start(sink: ObservationIngressPort, signal: AbortSignal): Promise<void> {
    if (sink !== this.#ingress) throw new Error('OBSERVATION_INGRESS_MISMATCH');
    signal.addEventListener('abort', () => { void this.stop(); }, { once: true });
    await this.run();
  }

  async run() {
    await Promise.all([...this.cfg.WS_URLS.map((url, i) => this.websocket(url, i)), ...(this.cfg.YELLOWSTONE_URL ? [this.geyser()] : [])]);
  }
  stop(): Promise<void> {
    if (this.stopTask) return this.stopTask;
    this.stopTask = this.performStop();
    return this.stopTask;
  }
  private async performStop(): Promise<void> {
    this.stopped = true;
    this.shutdown.abort();
    for (const s of this.sockets) s.terminate();
    this.grpcStream?.destroy();
    await this.ingressDrain;
    await Promise.allSettled([this.ingressFaultPersistence].filter((task): task is Promise<void> => !!task));
    if (!this.ingressFault && this.onCleanSessionClose) {
      try { await this.onCleanSessionClose(this.yellowstoneReplayCursor.lastAcceptedSlot); }
      catch (error) {
        this.ingressFault = 'FEED_SESSION_CLOSE_FAILED';
        this.last = 0;
        this.readySince = Date.now();
        log('feed_session_close_failed', { error: String(error) });
        throw error;
      }
    }
  }
  async reconnectDelay(ms: number) {
    try { await delay(ms, undefined, {signal: this.shutdown.signal}); }
    catch (error) { if (!this.stopped) throw error; }
  }
  private async websocket(url: string, index: number) {
    let backoff = 250;
    while (!this.stopped && !this.ingressFault) {
      const started = Date.now();
      await new Promise<void>(resolve => {
        const ws = this.webSocketFactory(url, { handshakeTimeout: this.cfg.RPC_TIMEOUT_MS, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false });
        this.sockets.add(ws);
        let pong = Date.now(), traffic = Date.now();
        const timer = setInterval(() => {
          if (Date.now() - pong > 30_000 || Date.now() - traffic > 30_000) ws.terminate();
          else if (ws.readyState === WebSocket.OPEN) ws.ping();
        }, 10_000);
        ws.on('pong', () => { pong = Date.now(); });
        ws.on('open', () => {
          this.providerHealth.recordTransportReachable('SOLANA_WSS', true);
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMP_PROGRAM_ID.toBase58()] }, { commitment: 'confirmed' }] }));
          log('websocket_connected', { endpointIndex: index });
        });
        ws.on('message', raw => {
          traffic = Date.now();
          try {
            const m = JSON.parse(raw.toString());
            if (m.error) { ws.terminate(); return; }
            if (m.method === 'logsNotification' && m.params?.result?.value?.err === null) {
              const r = m.params.result;
              const logs = r.value.logs;
              const pumpInvocationPrefix = `Program ${PUMP_PROGRAM_ID.toBase58()} invoke`;
              // The provider's `mentions` filter also returns transactions that
              // merely reference the program id. Anchor's Pump EventParser starts
              // with no program context, so a well-formed logs array without this
              // invocation can never yield a Pump event. Skip that no-op before it
              // occupies the serial ingress queue. Unknown/malformed shapes still
              // follow the existing validation path.
              if (Array.isArray(logs) && logs.length > 0 && logs.every((line: unknown) => typeof line === 'string') &&
                  !logs.some((line: string) => line.startsWith(pumpInvocationPrefix))) return;
              const frameBytes = typeof raw === 'string' ? Buffer.from(raw) : Buffer.from(raw as Buffer);
              void this.accept(r.value.signature, r.context.slot, logs, {
                sourceId: `solana-ws-${index}`,
                providerId: providerLabel(url),
                transport: 'websocket.logsSubscribe',
                commitment: 'confirmed',
                rawPayload: frameBytes,
                rawPayloadEncoding: 'JSON_FRAME_BYTES',
              }, ws).catch(error => {
                // Keep enough provenance to reconcile a dropped notification after
                // an incident. Signatures and slots are public chain identifiers;
                // never persist the raw WebSocket frame or provider credential.
                log('feed_ingress_admission_failed', {
                  endpointIndex: index,
                  providerId: providerLabel(url),
                  transport: 'websocket.logsSubscribe',
                  slot: r.context.slot,
                  signature: r.value.signature,
                  error: String(error),
                });
                if (this.ingressFault) ws.terminate();
              });
            }
          } catch { log('websocket_message_rejected', { endpointIndex: index }); }
        });
        ws.on('error', () => ws.terminate());
        ws.on('close', () => {
          clearInterval(timer);
          this.pausedSockets.delete(ws);
          this.sockets.delete(ws);
          if (this.sockets.size === 0) this.providerHealth.recordTransportReachable('SOLANA_WSS', false);
          resolve();
        });
      });
      if (!this.stopped && !this.ingressFault) {
        backoff = Date.now() - started > 30_000 ? 250 : Math.min(backoff * 2, 10_000);
        log('websocket_reconnecting', { endpointIndex: index });
        await this.reconnectDelay(backoff + Math.random() * 250);
      }
    }
  }
  private async geyser() {
    const module = await import('@triton-one/yellowstone-grpc');
    let backoff = 500;
    while (!this.stopped && !this.ingressFault) {
      let watchdog: NodeJS.Timeout | undefined;
      let client: any;
      let sessionStartedAt = 0;
      let sessionReceivedUpdate = false;
      let sessionFailure = false;
      try {
        client = this.yellowstoneClientFactory({
          endpoint: this.cfg.YELLOWSTONE_URL,
          token: this.cfg.YELLOWSTONE_TOKEN || undefined,
          channelOptions: { 'grpc.keepalive_time_ms': 10_000, 'grpc.keepalive_timeout_ms': 5000, 'grpc.max_receive_message_length': 16 * 1024 * 1024 },
          requestCodec: module.SubscribeRequest,
          responseCodec: module.SubscribeUpdate,
        });
        const replay = this.yellowstoneSubscribedOnce && this.yellowstoneReplayCursor.lastAcceptedSlot > 0
          ? this.yellowstoneReplayCursor.prepareReconnect(await this.connection.getSlot('confirmed'))
          : undefined;
        const stream = client.subscribe();
        stream.on('error', () => {});
        if (this.stopped) { stream.destroy(); return; }
        this.grpcStream = stream;
        let last = Date.now();
        watchdog = setInterval(() => { if (Date.now() - last > 30_000) stream.destroy(); }, 5000);
        const request = buildYellowstoneSubscriptionRequest({ accounts: {}, slots: {}, transactions: { pump: { vote: false, failed: false, accountInclude: [PUMP_PROGRAM_ID.toBase58()], accountExclude: [], accountRequired: [] } }, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [], commitment: module.CommitmentLevel.CONFIRMED }, replay);
        await new Promise<void>((resolve, reject) => stream.write(request, (e: Error | null) => e ? reject(e) : resolve()));
        this.yellowstoneSubscribedOnce = true;
        this.providerHealth.recordTransportReachable('YELLOWSTONE_GRPC', true);
        sessionStartedAt = Date.now();
        log('yellowstone_subscribed');
        for await (const captured of stream) {
          sessionReceivedUpdate = true;
          last = Date.now();
          if (this.stopped) break;
          const update = captured.update;
          if (update.ping) stream.write({ ...request, ping: { id: 1 } });
          const transaction = capturedTransactionObservation(captured);
          const receipt = await this.acceptYellowstoneCapture(captured,
            transaction ? this.yellowstoneReplayCursor.intentFor(transaction.slot) : 'LIVE');
          if (transaction && (receipt?.status === 'ACCEPTED' || receipt?.status === 'DUPLICATE')) {
            this.yellowstoneReplayCursor.recordAccepted(transaction.slot);
            if (this.onYellowstoneCheckpoint && this.yellowstoneReplayCursor.lastAcceptedSlot - this.lastPersistedYellowstoneSlot >= 32) {
              try {
                await this.onYellowstoneCheckpoint(this.yellowstoneReplayCursor.lastAcceptedSlot);
                this.lastPersistedYellowstoneSlot = this.yellowstoneReplayCursor.lastAcceptedSlot;
              } catch (error) {
                this.latchIngressFault('FEED_YELLOWSTONE_CHECKPOINT_FAILURE', {
                  slot: transaction.slot, signature: transaction.signature, transport: 'yellowstone.transaction.logs',
                }, String(error).slice(0, 512));
                break;
              }
            }
          }
        }
      } catch {
        sessionFailure = true;
        if (!this.stopped) this.providerHealth.recordFailure('YELLOWSTONE_GRPC', 'YELLOWSTONE_STREAM_FAILURE');
        log('yellowstone_reconnecting');
      }
      finally {
        if (watchdog) clearInterval(watchdog);
        this.grpcStream?.destroy();
        this.grpcStream = undefined;
        try { client?.close?.(); } catch {}
        this.providerHealth.recordTransportReachable('YELLOWSTONE_GRPC', false);
      }
      if (!this.stopped && !sessionFailure) this.providerHealth.recordFailure('YELLOWSTONE_GRPC', 'YELLOWSTONE_STREAM_ENDED');
      if (!this.stopped) {
        backoff = yellowstoneBackoffAfterSession(backoff, sessionStartedAt ? Date.now() - sessionStartedAt : 0, sessionReceivedUpdate);
        await this.reconnectDelay(backoff + Math.random() * 250);
        backoff = Math.min(backoff * 2, 10_000);
      }
    }
  }
  private async acceptYellowstoneCapture(captured: Parameters<typeof capturedTransactionObservation>[0], processingIntent: ProcessingIntent = 'LIVE'): Promise<IngressReceipt | void> {
    const transaction = capturedTransactionObservation(captured);
    if (!transaction) return undefined;
    return this.accept(transaction.signature, transaction.slot, transaction.logs, {
      sourceId: 'yellowstone-grpc',
      providerId: providerLabel(this.cfg.YELLOWSTONE_URL),
      transport: 'yellowstone.transaction.logs',
      commitment: 'confirmed',
      processingIntent,
      rawPayload: transaction.rawPayload,
      rawPayloadEncoding: 'GRPC_PROTOBUF_MESSAGE_PAYLOAD_BYTES',
      capturedYellowstoneUpdate: captured,
    });
  }
}
