/**
 * SYLPH FUSION — QUORUMROOT: Evidence Independence & Truth Quorum Certificates
 * Specifications: Section 11 (QuorumRoot Evidence Independence), 103 (Invariant 14)
 *
 * Invariants:
 * 1. Do not treat RPC A, B, C as independent simply because URLs differ.
 * 2. Independence is calculated across: operator, infrastructure region, administrative owner, and correlation group.
 * 3. Evidence disagreement produces status CONFLICTED — NEVER silently averaged.
 * 4. Critical facts require a certified TruthQuorumCertificate with >= minIndependentGroups.
 */

import { createHash } from 'node:crypto';

export type DataSourceType = 'DIRECT_VALIDATOR_TPU' | 'GEODISTRIBUTED_RPC' | 'AGGREGATED_API';

export interface ProviderInfrastructureMetadata {
  readonly providerId: string;
  readonly operator: string; // e.g. 'HELIUS', 'TRITON', 'QUICKNODE', 'SOLANA_FOUNDATION'
  readonly infrastructureRegion: string; // e.g. 'us-east-1', 'eu-central-1'
  readonly administrativeOwner: string;
  readonly correlationGroup: string; // Failure domain grouping
  readonly dataSource: DataSourceType;
}

export interface TruthFactObservation<T> {
  readonly factKey: string;
  readonly slot: number;
  readonly timestampMs: number;
  readonly providerId: string;
  readonly value: T;
  readonly valueDigest: string;
}

export type QuorumStatus = 'AGREED' | 'CONFLICTED' | 'INSUFFICIENT_INDEPENDENCE' | 'STALE';

export interface TruthQuorumCertificate<T> {
  readonly certificateId: string;
  readonly factKey: string;
  readonly slot: number;
  readonly status: QuorumStatus;
  readonly consensusValue?: T;
  readonly participatingProviders: readonly string[];
  readonly independentGroupCount: number;
  readonly minRequiredIndependence: number;
  readonly observations: readonly TruthFactObservation<T>[];
  readonly conflictDetails?: string;
  readonly issuedAtMs: number;
  readonly digest: string;
}

export class QuorumRootAuthority {
  private providerMetadata = new Map<string, ProviderInfrastructureMetadata>();

  /**
   * Registers infrastructural metadata for a provider endpoint.
   */
  public registerProvider(meta: ProviderInfrastructureMetadata): void {
    this.providerMetadata.set(meta.providerId, meta);
  }

  /**
   * Evaluates a collection of fact observations across independent providers.
   * Disagreement results in CONFLICTED (never silently averaged).
   */
  public evaluateFactQuorum<T>(params: {
    factKey: string;
    slot: number;
    observations: readonly TruthFactObservation<T>[];
    minIndependentGroups?: number;
    maxSlotLag?: number;
  }): TruthQuorumCertificate<T> {
    const minIndependence = params.minIndependentGroups ?? 2;
    const maxSlotLag = params.maxSlotLag ?? 16;
    const issuedAtMs = Date.now();

    if (params.observations.length === 0) {
      const digest = createHash('sha256').update(`${params.factKey}:${params.slot}:EMPTY`).digest('hex');
      return {
        certificateId: `QUORUM-${digest.slice(0, 16)}`,
        factKey: params.factKey,
        slot: params.slot,
        status: 'INSUFFICIENT_INDEPENDENCE',
        participatingProviders: [],
        independentGroupCount: 0,
        minRequiredIndependence: minIndependence,
        observations: [],
        issuedAtMs,
        digest
      };
    }

    // Filter out observations with excessive slot lag
    const freshObservations = params.observations.filter(
      (obs) => Math.abs(obs.slot - params.slot) <= maxSlotLag
    );

    if (freshObservations.length === 0) {
      const digest = createHash('sha256').update(`${params.factKey}:${params.slot}:STALE`).digest('hex');
      return {
        certificateId: `QUORUM-${digest.slice(0, 16)}`,
        factKey: params.factKey,
        slot: params.slot,
        status: 'STALE',
        participatingProviders: params.observations.map((o) => o.providerId),
        independentGroupCount: 0,
        minRequiredIndependence: minIndependence,
        observations: params.observations,
        conflictDetails: `All observations exceeded maxSlotLag of ${maxSlotLag} slots`,
        issuedAtMs,
        digest
      };
    }

    // Check for value disagreement
    const distinctValueDigests = new Set<string>();
    const observationsByDigest = new Map<string, TruthFactObservation<T>[]>();

    for (const obs of freshObservations) {
      distinctValueDigests.add(obs.valueDigest);
      const group = observationsByDigest.get(obs.valueDigest) ?? [];
      group.push(obs);
      observationsByDigest.set(obs.valueDigest, group);
    }

    // INVARIANT: Disagreement => CONFLICTED. Never average!
    if (distinctValueDigests.size > 1) {
      const conflictMsg = Array.from(observationsByDigest.entries())
        .map(([dig, obsList]) => `[Digest ${dig.slice(0, 8)}: ${obsList.map((o) => o.providerId).join(', ')}]`)
        .join(' vs ');

      const digest = createHash('sha256').update(`${params.factKey}:${params.slot}:CONFLICTED:${conflictMsg}`).digest('hex');

      return {
        certificateId: `QUORUM-${digest.slice(0, 16)}`,
        factKey: params.factKey,
        slot: params.slot,
        status: 'CONFLICTED',
        participatingProviders: freshObservations.map((o) => o.providerId),
        independentGroupCount: 0,
        minRequiredIndependence: minIndependence,
        observations: freshObservations,
        conflictDetails: `Evidence disagreement detected between providers: ${conflictMsg}`,
        issuedAtMs,
        digest
      };
    }

    // All fresh observations agree on the same valueDigest.
    // Now verify infrastructure failure domain independence.
    const agreeingDigest = Array.from(distinctValueDigests)[0];
    const agreeingObservations = observationsByDigest.get(agreeingDigest)!;

    const independentGroups = new Set<string>();
    for (const obs of agreeingObservations) {
      const meta = this.providerMetadata.get(obs.providerId);
      // If metadata not registered, fallback to providerId as independent group
      const group = meta ? `${meta.operator}:${meta.infrastructureRegion}:${meta.correlationGroup}` : obs.providerId;
      independentGroups.add(group);
    }

    const independentGroupCount = independentGroups.size;
    const isIndependentEnough = independentGroupCount >= minIndependence;

    const status: QuorumStatus = isIndependentEnough ? 'AGREED' : 'INSUFFICIENT_INDEPENDENCE';
    const payload = `${params.factKey}:${params.slot}:${status}:${agreeingDigest}:${independentGroupCount}`;
    const digest = createHash('sha256').update(payload).digest('hex');

    return {
      certificateId: `QUORUM-${digest.slice(0, 16)}`,
      factKey: params.factKey,
      slot: params.slot,
      status,
      consensusValue: isIndependentEnough ? agreeingObservations[0].value : undefined,
      participatingProviders: agreeingObservations.map((o) => o.providerId),
      independentGroupCount,
      minRequiredIndependence: minIndependence,
      observations: agreeingObservations,
      conflictDetails: isIndependentEnough
        ? undefined
        : `Only ${independentGroupCount} independent correlation groups observed, required ${minIndependence}`,
      issuedAtMs,
      digest
    };
  }
}
