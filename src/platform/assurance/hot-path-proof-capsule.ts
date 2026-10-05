/**
 * SYLPH FUSION — HOT-PATH PROOF CAPSULE & FEATURE-SPECIFIC EVIDENCE LEASES
 * Specifications: Master Blueprint Sections 11 & 12 (Hot-Path Proof Capsule & Feature-Specific Freshness)
 *
 * Epistemic Invariants:
 * 1. Fast execution does not eliminate correctness checks; it computes them in background caches.
 * 2. Hot-path opportunity evaluation performs ZERO HTTP audit lookups, holder scans, ALT lookups,
 *    or remote API fetches; it uses local capsule lookup + feature-specific freshness verification.
 * 3. Freshness is strictly feature-specific: quotes (~500ms), priority fees (~2s), blockhashes (~60s),
 *    holder distribution (~5m), mint authority (~1h), program binary hash (~days).
 * 4. Expired evidence lease resolves strictly to UNKNOWN (never silent fallback or stale reuse).
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export type CapsuleFeatureClass =
  | 'QUICK_QUOTE'
  | 'PRIORITY_FEE'
  | 'BLOCKHASH'
  | 'HOLDER_CONCENTRATION'
  | 'MINT_AUTHORITY'
  | 'PROGRAM_HASH'
  | 'RISK_CERTIFICATE'
  | 'EXITABILITY'
  | 'PROVIDER_HEALTH';

export interface EvidenceLease<T> {
  readonly leaseId: string;
  readonly value: T | null;
  readonly isAvailable: boolean;
  readonly source: string;
  readonly observedAtMs: number;
  readonly knownAtMs: number;
  readonly expiresAtMs: number;
  readonly stateRoot: string;
  readonly featureClass: CapsuleFeatureClass;
}

export function createEvidenceLease<T>(params: {
  value: T | null;
  source: string;
  observedAtMs: number;
  knownAtMs: number;
  ttlMs: number;
  stateRoot: string;
  featureClass: CapsuleFeatureClass;
}): EvidenceLease<T> {
  const isAvailable = params.value !== null && params.value !== undefined;
  const expiresAtMs = params.knownAtMs + params.ttlMs;
  const leaseId = `lease_${params.featureClass.toLowerCase()}_${params.knownAtMs}_${hashCanonical(params.value ?? 'NULL').slice(0, 12)}`;

  return Object.freeze({
    leaseId,
    value: isAvailable ? params.value : null,
    isAvailable,
    source: params.source,
    observedAtMs: params.observedAtMs,
    knownAtMs: params.knownAtMs,
    expiresAtMs,
    stateRoot: params.stateRoot,
    featureClass: params.featureClass,
  });
}

export function isLeaseValid<T>(lease: EvidenceLease<T>, currentMs: number): boolean {
  return lease.isAvailable && lease.value !== null && currentMs <= lease.expiresAtMs;
}

export function getLeaseValueOrUnknown<T>(lease: EvidenceLease<T>, currentMs: number): T | 'UNKNOWN' {
  if (isLeaseValid(lease, currentMs)) {
    return lease.value as T;
  }
  return 'UNKNOWN';
}

export interface HotPathProofCapsule {
  readonly capsuleId: string;
  readonly mint: string;
  readonly bankFingerprint: EvidenceLease<string>;
  readonly blockhashState: EvidenceLease<{ readonly blockhash: string; readonly lastValidBlockHeight: bigint }>;
  readonly tokenSemantics: EvidenceLease<{ readonly mintAuthority: string | null; readonly freezeAuthority: string | null; readonly isToken2022: boolean }>;
  readonly creatorState: EvidenceLease<{ readonly creatorWallet: string; readonly solBalanceLamports: bigint }>;
  readonly holderState: EvidenceLease<{ readonly top10ConcentrationBps: number; readonly holderCount: number }>;
  readonly walletGraph: EvidenceLease<{ readonly clusterId: string; readonly sybilSuspicionBps: number }>;
  readonly poolReserves: EvidenceLease<{ readonly realQuoteReserves: bigint; readonly virtualTokenReserves: bigint }>;
  readonly feeEstimates: EvidenceLease<{ readonly priorityFeeLamports: bigint; readonly jitoTipLamports: bigint }>;
  readonly riskCertificate: EvidenceLease<string>;
  readonly exitabilityCertificate: EvidenceLease<string>;
  readonly providerHealthCertificate: EvidenceLease<string>;
  readonly capsuleHash: string;
  readonly assembledAtMs: number;
}

export class HotPathCapsuleRegistry {
  private readonly capsules = new Map<string, HotPathProofCapsule>();

  public storeCapsule(capsule: HotPathProofCapsule): void {
    this.capsules.set(capsule.mint, capsule);
  }

  public getCapsule(mint: string): HotPathProofCapsule | null {
    return this.capsules.get(mint) ?? null;
  }

  /**
   * Evaluates if all critical features for hot-path trade building are fresh and unexpired.
   * If any lease is expired, it returns isReady=false and identifies the expired leases.
   */
  public evaluateHotPathReadiness(
    mint: string,
    currentMs: number
  ): {
    readonly isReady: boolean;
    readonly capsule: HotPathProofCapsule | null;
    readonly expiredLeases: readonly string[];
    readonly reason?: string;
  } {
    const capsule = this.getCapsule(mint);
    if (!capsule) {
      return {
        isReady: false,
        capsule: null,
        expiredLeases: ['CAPSULE_MISSING'],
        reason: `NO_HOT_PATH_CAPSULE: No capsule found for mint ${mint}`,
      };
    }

    const expiredLeases: string[] = [];

    // Verify each feature-specific lease against its own TTL
    if (!isLeaseValid(capsule.poolReserves, currentMs)) expiredLeases.push('POOL_RESERVES_EXPIRED');
    if (!isLeaseValid(capsule.blockhashState, currentMs)) expiredLeases.push('BLOCKHASH_EXPIRED');
    if (!isLeaseValid(capsule.feeEstimates, currentMs)) expiredLeases.push('FEE_ESTIMATES_EXPIRED');
    if (!isLeaseValid(capsule.tokenSemantics, currentMs)) expiredLeases.push('TOKEN_SEMANTICS_EXPIRED');
    if (!isLeaseValid(capsule.holderState, currentMs)) expiredLeases.push('HOLDER_STATE_EXPIRED');
    if (!isLeaseValid(capsule.riskCertificate, currentMs)) expiredLeases.push('RISK_CERTIFICATE_EXPIRED');
    if (!isLeaseValid(capsule.exitabilityCertificate, currentMs)) expiredLeases.push('EXITABILITY_CERTIFICATE_EXPIRED');
    if (!isLeaseValid(capsule.providerHealthCertificate, currentMs)) expiredLeases.push('PROVIDER_HEALTH_EXPIRED');

    const isReady = expiredLeases.length === 0;

    return {
      isReady,
      capsule,
      expiredLeases: Object.freeze(expiredLeases),
      reason: isReady ? undefined : `STALE_LEASES: ${expiredLeases.join(', ')}`,
    };
  }
}
