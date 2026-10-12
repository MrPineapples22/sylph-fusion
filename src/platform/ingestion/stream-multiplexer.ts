/**
 * Research-only provider metrics and bounded signature deduplication.
 *
 * Inspired by Richat (Lamports-dev) & Yellowstone gRPC (Triton One)
 * This class does not open streams, provide backpressure, or fail over a live feed.
 * Provider states must be supplied from observed adapter metrics; an empty registry is unknown.
 */

import { createHash } from 'node:crypto';

export type StreamProviderId =
  | 'TRITON_YELLOWSTONE'
  | 'HELIUS_GEYSER'
  | 'RICHAT_PROXY'
  | 'JITO_SHREDSTREAM'
  | 'QUICKNODE_WSS';

const PROVIDER_IDS: readonly StreamProviderId[] = [
  'TRITON_YELLOWSTONE', 'HELIUS_GEYSER', 'RICHAT_PROXY', 'JITO_SHREDSTREAM', 'QUICKNODE_WSS',
];

export interface StreamProviderState {
  readonly providerId: StreamProviderId;
  readonly endpointUrl: string;
  readonly isHealthy: boolean;
  readonly latencyMs: number;
  readonly slotLag: number;
  readonly droppedFramesCount: number;
  readonly consecutiveErrors: number;
  readonly lastSeenAtMs: number;
}

export interface StreamMultiplexerConfig {
  readonly maxAllowedSlotLag?: number;
  readonly maxAllowedLatencyMs?: number;
  readonly maxProviderAgeMs?: number;
  readonly dedupCapacity?: number;
  readonly minQuorumCount?: number;
}

export interface MultiplexerReport {
  readonly activeProvider: StreamProviderId | null;
  readonly totalProviders: number;
  readonly healthyProviders: number;
  readonly quorumMet: boolean;
  readonly observedSlot: number | null;
  readonly meanLatencyMs: number | null;
  readonly dedupRatePct: number;
  readonly multiplexerDigest: string;
  readonly hasLiveTransportConnection: false;
}

export function shouldBlockStreamMultiplexer(report: MultiplexerReport, maxLatencyMs: number): boolean {
  return !Number.isFinite(maxLatencyMs) || maxLatencyMs < 0 || !report.hasLiveTransportConnection ||
    !report.quorumMet || report.meanLatencyMs === null || report.observedSlot === null || report.meanLatencyMs > maxLatencyMs;
}

export class StreamDeduplicator {
  private readonly capacity: number;
  private readonly seenSignatures = new Set<string>();
  private readonly ringBuffer: string[] = [];
  private totalSeen = 0;
  private totalDuplicates = 0;

  constructor(capacity = 10_000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('INVALID_DEDUP_CAPACITY');
    this.capacity = capacity;
  }

  public isDuplicate(signature: string): boolean {
    if (!signature || typeof signature !== 'string') throw new Error('INVALID_SIGNATURE');
    this.totalSeen++;

    if (this.seenSignatures.has(signature)) {
      this.totalDuplicates++;
      return true;
    }

    if (this.ringBuffer.length >= this.capacity) {
      const oldest = this.ringBuffer.shift();
      if (oldest) this.seenSignatures.delete(oldest);
    }

    this.ringBuffer.push(signature);
    this.seenSignatures.add(signature);
    return false;
  }

  public getStats(): { totalSeen: number; totalDuplicates: number; dedupRatePct: number } {
    const dedupRatePct = this.totalSeen > 0
      ? Number(((this.totalDuplicates / this.totalSeen) * 100).toFixed(2))
      : 0;
    return {
      totalSeen: this.totalSeen,
      totalDuplicates: this.totalDuplicates,
      dedupRatePct,
    };
  }

  public clear(): void {
    this.seenSignatures.clear();
    this.ringBuffer.length = 0;
    this.totalSeen = 0;
    this.totalDuplicates = 0;
  }
}

export class StreamMultiplexer {
  private readonly providers = new Map<StreamProviderId, StreamProviderState>();
  private readonly deduplicator: StreamDeduplicator;
  private readonly maxAllowedSlotLag: number;
  private readonly maxAllowedLatencyMs: number;
  private readonly maxProviderAgeMs: number;
  private readonly minQuorumCount: number;
  private activeProvider: StreamProviderId | null = null;
  private latestSlot: number | null = null;

  constructor(config: StreamMultiplexerConfig = {}) {
    this.maxAllowedSlotLag = config.maxAllowedSlotLag ?? 2;
    this.maxAllowedLatencyMs = config.maxAllowedLatencyMs ?? 150;
    this.maxProviderAgeMs = config.maxProviderAgeMs ?? 5_000;
    this.minQuorumCount = config.minQuorumCount ?? 2;
    if (!Number.isFinite(this.maxAllowedSlotLag) || this.maxAllowedSlotLag < 0 ||
        !Number.isFinite(this.maxAllowedLatencyMs) || this.maxAllowedLatencyMs < 0 ||
        !Number.isFinite(this.maxProviderAgeMs) || this.maxProviderAgeMs <= 0 ||
        !Number.isSafeInteger(this.minQuorumCount) || this.minQuorumCount < 1) throw new Error('INVALID_MULTIPLEXER_CONFIG');
    this.deduplicator = new StreamDeduplicator(config.dedupCapacity ?? 10_000);
  }

  public registerProvider(state: StreamProviderState): void {
    if (!state || !PROVIDER_IDS.includes(state.providerId) || typeof state.isHealthy !== 'boolean' ||
        typeof state.endpointUrl !== 'string' || !state.endpointUrl ||
        !Number.isFinite(state.latencyMs) || state.latencyMs < 0 ||
        !Number.isSafeInteger(state.slotLag) || state.slotLag < 0 ||
        !Number.isSafeInteger(state.droppedFramesCount) || state.droppedFramesCount < 0 ||
        !Number.isSafeInteger(state.consecutiveErrors) || state.consecutiveErrors < 0 ||
        !Number.isFinite(state.lastSeenAtMs) || state.lastSeenAtMs <= 0) throw new Error('INVALID_PROVIDER_STATE');
    this.providers.set(state.providerId, state);
    this.evaluateActiveProvider();
  }

  public updateProviderMetrics(
    providerId: StreamProviderId,
    metrics: {
      latencyMs?: number;
      slotLag?: number;
      isHealthy?: boolean;
      droppedFrame?: boolean;
      isError?: boolean;
      currentSlot?: number;
      lastSeenAtMs?: number;
    }
  ): void {
    const existing = this.providers.get(providerId);
    if (!existing) return;

    const latencyMs = metrics.latencyMs ?? existing.latencyMs;
    const slotLag = metrics.slotLag ?? existing.slotLag;
    if (!Number.isFinite(latencyMs) || latencyMs < 0 || !Number.isSafeInteger(slotLag) || slotLag < 0 ||
        (metrics.isHealthy !== undefined && typeof metrics.isHealthy !== 'boolean') ||
        (metrics.isError !== undefined && typeof metrics.isError !== 'boolean') ||
        (metrics.droppedFrame !== undefined && typeof metrics.droppedFrame !== 'boolean') ||
        (metrics.currentSlot !== undefined && (!Number.isSafeInteger(metrics.currentSlot) || metrics.currentSlot < 0)) ||
        (metrics.lastSeenAtMs !== undefined && (!Number.isFinite(metrics.lastSeenAtMs) || metrics.lastSeenAtMs <= 0))) {
      throw new Error('INVALID_PROVIDER_METRICS');
    }
    if (metrics.currentSlot !== undefined) {
      this.latestSlot = this.latestSlot === null ? metrics.currentSlot : Math.max(this.latestSlot, metrics.currentSlot);
    }
    const consecutiveErrors = metrics.isError === true ? existing.consecutiveErrors + 1
      : metrics.isError === false ? 0 : existing.consecutiveErrors;
    const isHealthy = metrics.isHealthy ?? (consecutiveErrors < 3 && slotLag <= this.maxAllowedSlotLag && latencyMs <= this.maxAllowedLatencyMs);

    this.providers.set(providerId, {
      ...existing,
      latencyMs,
      slotLag,
      isHealthy,
      droppedFramesCount: metrics.droppedFrame ? existing.droppedFramesCount + 1 : existing.droppedFramesCount,
      consecutiveErrors,
      lastSeenAtMs: metrics.lastSeenAtMs ?? Date.now(),
    });

    this.evaluateActiveProvider();
  }

  private evaluateActiveProvider(): void {
    let bestProvider: StreamProviderId | null = null;
    let lowestLatency = Infinity;
    const now = Date.now();

    for (const [id, state] of this.providers.entries()) {
      if (this.isCurrentHealthy(state, now)) {
        if (state.latencyMs < lowestLatency) {
          lowestLatency = state.latencyMs;
          bestProvider = id;
        }
      }
    }

    this.activeProvider = bestProvider;
  }

  private isCurrentHealthy(state: StreamProviderState, now: number): boolean {
    const ageMs = now - state.lastSeenAtMs;
    return state.isHealthy && state.slotLag <= this.maxAllowedSlotLag && state.latencyMs <= this.maxAllowedLatencyMs &&
      ageMs >= 0 && ageMs <= this.maxProviderAgeMs;
  }

  public isDuplicate(signature: string): boolean {
    return this.deduplicator.isDuplicate(signature);
  }

  public getActiveProvider(): StreamProviderId | null {
    return this.activeProvider;
  }

  public getProvider(id: StreamProviderId): StreamProviderState | undefined {
    return this.providers.get(id);
  }

  public getAllProviders(): readonly StreamProviderState[] {
    return Array.from(this.providers.values());
  }

  public getReport(): MultiplexerReport {
    const all = Array.from(this.providers.values());
    const now = Date.now();
    const healthy = all.filter((provider) => this.isCurrentHealthy(provider, now));
    const meanLatency = healthy.length > 0
      ? Number((healthy.reduce((acc, p) => acc + p.latencyMs, 0) / healthy.length).toFixed(1))
      : null;

    const dedupStats = this.deduplicator.getStats();
    const quorumMet = healthy.length >= this.minQuorumCount;

    const digest = createHash('sha256')
      .update(`${this.activeProvider ?? 'UNKNOWN'}:${all.length}:${healthy.length}:${this.latestSlot ?? 'UNKNOWN'}:${meanLatency ?? 'UNKNOWN'}`)
      .digest('hex');

    return {
      activeProvider: this.activeProvider,
      totalProviders: all.length,
      healthyProviders: healthy.length,
      quorumMet,
      observedSlot: this.latestSlot,
      meanLatencyMs: meanLatency,
      dedupRatePct: dedupStats.dedupRatePct,
      multiplexerDigest: digest,
      hasLiveTransportConnection: false,
    };
  }
}
