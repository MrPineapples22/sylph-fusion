/**
 * SOL-SYLPH Master Production Intelligence - Quorum-Aware RPC Provider Pool
 * Specifications: Section 7 (RPC Provider Pool).
 *
 * Rules:
 * 1. Do not use simplistic failover (RPC A fails -> RPC B).
 * 2. Measure latency, slot lag, error rate, 429 rate, and blockhash agreement across all endpoints.
 * 3. Sensitive reads require cross-provider quorum verification.
 * 4. Disagreement between providers becomes observable evidence.
 */

import type { RpcEndpointHealth } from './types.js';

export interface RpcEndpointConfig {
  readonly endpointId: string;
  readonly url: string;
  readonly weight?: number;
}

export interface QuorumVerificationResult<T> {
  readonly agreed: boolean;
  readonly primaryValue: T;
  readonly agreeingEndpoints: readonly string[];
  readonly dissentingEndpoints: readonly string[];
  readonly maxSlotDiscrepancy: number;
  readonly consensusBlockhash?: string;
  readonly timestampMs: number;
}

export class RPCProviderPool {
  private readonly endpoints = new Map<string, RpcEndpointHealth>();

  constructor(configs: readonly RpcEndpointConfig[] = []) {
    for (const cfg of configs) {
      this.endpoints.set(cfg.endpointId, {
        endpointId: cfg.endpointId,
        url: cfg.url,
        latencyMs: 0,
        slotLag: 0,
        currentSlot: 0,
        blockhash: '',
        errorRateBps: 0,
        rateLimitCount429: 0,
        consecutiveTimeouts: 0,
        isHealthy: true,
        lastCheckedAtMs: Date.now(),
      });
    }
  }

  public registerEndpoint(cfg: RpcEndpointConfig): void {
    this.endpoints.set(cfg.endpointId, {
      endpointId: cfg.endpointId,
      url: cfg.url,
      latencyMs: 0,
      slotLag: 0,
      currentSlot: 0,
      blockhash: '',
      errorRateBps: 0,
      rateLimitCount429: 0,
      consecutiveTimeouts: 0,
      isHealthy: true,
      lastCheckedAtMs: Date.now(),
    });
  }

  public recordTelemetry(
    endpointId: string,
    params: {
      latencyMs: number;
      slot: number;
      blockhash?: string;
      is429?: boolean;
      isTimeout?: boolean;
      isError?: boolean;
    }
  ): void {
    const ep = this.endpoints.get(endpointId);
    if (!ep) return;

    let maxSlot = 0;
    for (const e of this.endpoints.values()) {
      if (e.currentSlot > maxSlot) maxSlot = e.currentSlot;
    }
    if (params.slot > maxSlot) maxSlot = params.slot;

    const slotLag = Math.max(0, maxSlot - params.slot);
    const consecutiveTimeouts = params.isTimeout ? ep.consecutiveTimeouts + 1 : 0;
    const rateLimitCount429 = params.is429 ? ep.rateLimitCount429 + 1 : ep.rateLimitCount429;
    const isHealthy = consecutiveTimeouts < 3 && slotLag <= 5 && !params.is429;

    this.endpoints.set(endpointId, {
      ...ep,
      latencyMs: params.latencyMs,
      currentSlot: params.slot,
      slotLag,
      blockhash: params.blockhash ?? ep.blockhash,
      consecutiveTimeouts,
      rateLimitCount429,
      isHealthy,
      lastCheckedAtMs: Date.now(),
    });
  }

  /**
   * Verify cross-provider quorum consensus on sensitive read operations.
   */
  public verifyQuorum<T>(
    observations: ReadonlyArray<{ endpointId: string; value: T; slot: number; blockhash?: string }>
  ): QuorumVerificationResult<T> {
    const now = Date.now();
    if (observations.length === 0) {
      throw new Error('Cannot verify quorum on empty observation set');
    }

    const primary = observations[0];
    const agreeing: string[] = [];
    const dissenting: string[] = [];
    let minSlot = primary.slot;
    let maxSlot = primary.slot;

    const bigintReplacer = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
    const serializedPrimary = JSON.stringify(primary.value, bigintReplacer);

    for (const obs of observations) {
      if (obs.slot < minSlot) minSlot = obs.slot;
      if (obs.slot > maxSlot) maxSlot = obs.slot;

      if (JSON.stringify(obs.value, bigintReplacer) === serializedPrimary) {
        agreeing.push(obs.endpointId);
      } else {
        dissenting.push(obs.endpointId);
      }
    }

    const slotDiscrepancy = maxSlot - minSlot;
    const quorumMajority = agreeing.length >= Math.ceil(observations.length * 0.6);
    const agreed = quorumMajority && slotDiscrepancy <= 2;

    return {
      agreed,
      primaryValue: primary.value,
      agreeingEndpoints: agreeing,
      dissentingEndpoints: dissenting,
      maxSlotDiscrepancy: slotDiscrepancy,
      consensusBlockhash: primary.blockhash,
      timestampMs: now,
    };
  }

  public getHealthyEndpoints(): readonly RpcEndpointHealth[] {
    return Array.from(this.endpoints.values()).filter((e) => e.isHealthy);
  }

  public getEndpointHealth(endpointId: string): RpcEndpointHealth | undefined {
    return this.endpoints.get(endpointId);
  }
}
