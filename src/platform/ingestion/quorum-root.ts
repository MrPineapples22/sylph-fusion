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

export type QuorumStatus = 'AGREED' | 'AGREED_WITH_DISSENT' | 'CONFLICTED' | 'INSUFFICIENT_INDEPENDENCE' | 'STALE';

export const QUORUM_STATUS = {
  AGREED: 'AGREED',
  AGREED_WITH_DISSENT: 'AGREED_WITH_DISSENT',
  CONFLICTED: 'CONFLICTED',
  INSUFFICIENT_INDEPENDENCE: 'INSUFFICIENT_INDEPENDENCE',
  STALE: 'STALE',
} as const;

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
  readonly dissentingObservations?: readonly TruthFactObservation<T>[];
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

    const getDomain = (providerId: string) => {
      const meta = this.providerMetadata.get(providerId);
      // Invariant: Unregistered providers map to a single common unclassified failure domain.
      // Missing metadata must NEVER increase independent group count.
      return meta
        ? `${meta.administrativeOwner}:${meta.operator}:${meta.infrastructureRegion}:${meta.correlationGroup}`
        : 'UNREGISTERED_PROVIDER_DOMAIN';
    };

    // Group observations by canonical valueDigest
    const observationsByDigest = new Map<string, TruthFactObservation<T>[]>();
    for (const obs of freshObservations) {
      const group = observationsByDigest.get(obs.valueDigest) ?? [];
      group.push(obs);
      observationsByDigest.set(obs.valueDigest, group);
    }

    // Evaluate independent failure domains for each digest group
    // Sort deterministically to ensure quorum(obs) === quorum(shuffle(obs))
    const evaluatedGroups = Array.from(observationsByDigest.entries())
      .map(([valDigest, obsList]) => {
        const domains = new Set<string>();
        for (const obs of obsList) {
          domains.add(getDomain(obs.providerId));
        }
        return {
          valDigest,
          obsList,
          domains,
          independentCount: domains.size,
        };
      })
      .sort((a, b) => {
        if (b.independentCount !== a.independentCount) return b.independentCount - a.independentCount;
        if (b.obsList.length !== a.obsList.length) return b.obsList.length - a.obsList.length;
        return a.valDigest.localeCompare(b.valDigest);
      });

    const topGroup = evaluatedGroups[0];
    const secondGroup = evaluatedGroups[1];

    // Case 1: Multiple competing digest groups with a tie or insufficient majority
    if (secondGroup && topGroup.independentCount <= secondGroup.independentCount) {
      const conflictMsg = evaluatedGroups
        .map((g) => `[Digest ${g.valDigest.slice(0, 8)} (${g.independentCount} domains): ${g.obsList.map((o) => o.providerId).join(', ')}]`)
        .join(' vs ');

      const digest = createHash('sha256')
        .update(`${params.factKey}:${params.slot}:CONFLICTED:${conflictMsg}`)
        .digest('hex');

      return {
        certificateId: `QUORUM-${digest.slice(0, 16)}`,
        factKey: params.factKey,
        slot: params.slot,
        status: 'CONFLICTED',
        participatingProviders: freshObservations.map((o) => o.providerId),
        independentGroupCount: topGroup.independentCount,
        minRequiredIndependence: minIndependence,
        observations: freshObservations,
        dissentingObservations: secondGroup.obsList,
        conflictDetails: `Evidence disagreement detected between providers: ${conflictMsg}`,
        issuedAtMs,
        digest,
      };
    }

    // Case 2: Insufficient independent failure domains in the leading group
    if (topGroup.independentCount < minIndependence) {
      const payload = `${params.factKey}:${params.slot}:INSUFFICIENT:${topGroup.valDigest}:${topGroup.independentCount}`;
      const digest = createHash('sha256').update(payload).digest('hex');

      return {
        certificateId: `QUORUM-${digest.slice(0, 16)}`,
        factKey: params.factKey,
        slot: params.slot,
        status: 'INSUFFICIENT_INDEPENDENCE',
        participatingProviders: topGroup.obsList.map((o) => o.providerId),
        independentGroupCount: topGroup.independentCount,
        minRequiredIndependence: minIndependence,
        observations: topGroup.obsList,
        conflictDetails: `Only ${topGroup.independentCount} independent correlation groups observed, required ${minIndependence}`,
        issuedAtMs,
        digest,
      };
    }

    // Case 3: Leading group meets minIndependence.
    // If other groups exist, it is certified as AGREED_WITH_DISSENT with preserved dissent.
    const hasDissent = evaluatedGroups.length > 1;
    const status: QuorumStatus = hasDissent ? 'AGREED_WITH_DISSENT' : 'AGREED';

    const dissentingObs = hasDissent
      ? evaluatedGroups.slice(1).flatMap((g) => g.obsList)
      : undefined;

    const payload = `${params.factKey}:${params.slot}:${status}:${topGroup.valDigest}:${topGroup.independentCount}`;
    const digest = createHash('sha256').update(payload).digest('hex');

    return {
      certificateId: `QUORUM-${digest.slice(0, 16)}`,
      factKey: params.factKey,
      slot: params.slot,
      status,
      consensusValue: topGroup.obsList[0].value,
      participatingProviders: topGroup.obsList.map((o) => o.providerId),
      independentGroupCount: topGroup.independentCount,
      minRequiredIndependence: minIndependence,
      observations: topGroup.obsList,
      dissentingObservations: dissentingObs,
      conflictDetails: hasDissent
        ? `Consensus certified with minority dissent (${dissentingObs?.length ?? 0} dissenting observations preserved)`
        : undefined,
      issuedAtMs,
      digest,
    };
  }
}
