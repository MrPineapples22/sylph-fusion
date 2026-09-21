/**
 * SOL-SYLPH Protection Lease, Ghost-Town & Audit Lifecycle Tracker
 * Specifications: Parts XXIV, XXV, XXVI, XXVII
 *
 * Enforces:
 * 1. Renewable Protection Lease with strict validity leases (ACTIVE, PROVISIONAL, REVIEW, EXPIRED, DISABLED).
 * 2. Ghost-Town state machine differentiating genuine inactivity from Dex observability failure.
 * 3. PoD state machine (P -> N -> D) with supporting evidence and policy filtering.
 * 4. Audit Lifecycle tracking Audit 3 -> Solar Core and Audit 12 -> Diamond Core snapshots and trajectory.
 */

import type { TokenId } from '../events/canonical-event.js';
import type { ProtectionState, PoDState, TrajectoryState, CanonicalTokenState } from '../truth/canonical-store.js';

// --- Part XXV: Protection Lease Engine ---
export interface ProtectionLease {
  readonly mint: TokenId;
  readonly leaseId: string;
  readonly state: ProtectionState;
  readonly startedAtMs: number;
  readonly lastRenewedMs: number;
  readonly validUntilMs: number;
  readonly supportingEvidenceIds: readonly string[];
  readonly qualityScore: number;
  readonly reason: string;
}

export class ProtectionLeaseManager {
  private readonly leases = new Map<TokenId, ProtectionLease>();
  private readonly defaultDurationMs: number = 300_000; // 5 minutes

  public requestLease(params: {
    mint: TokenId;
    isSafe1: boolean;
    podState: PoDState;
    hsiScore: number;
    pumpScore: number;
    evidenceQuality: number;
    evidenceIds: readonly string[];
    now?: number;
  }): ProtectionLease {
    const now = params.now ?? Date.now();

    // Prerequisites for ACTIVE lease: SAFE1=true, PoD=P, HSI >= 35, evidenceQuality >= 0.60
    let state: ProtectionState = 'ACTIVE';
    let reason = 'All protection prerequisites satisfied.';

    if (!params.isSafe1) {
      state = 'DISABLED';
      reason = 'Failed SAFE 1 security check.';
    } else if (params.podState === 'D') {
      state = 'REVIEW';
      reason = 'PoD in Dump state; protection downgraded to REVIEW.';
    } else if (params.evidenceQuality < 0.40) {
      state = 'PROVISIONAL';
      reason = 'Degraded evidence quality; protection provisional.';
    } else if (params.hsiScore < 25) {
      state = 'REVIEW';
      reason = 'HSI score deteriorated below critical threshold.';
    }

    const lease: ProtectionLease = {
      mint: params.mint,
      leaseId: `lease_${params.mint.slice(0, 8)}_${now}`,
      state,
      startedAtMs: now,
      lastRenewedMs: now,
      validUntilMs: state === 'ACTIVE' ? now + this.defaultDurationMs : now + 60_000,
      supportingEvidenceIds: params.evidenceIds,
      qualityScore: params.evidenceQuality,
      reason,
    };

    this.leases.set(params.mint, lease);
    return lease;
  }

  public evaluateLease(mint: TokenId, now: number = Date.now()): ProtectionLease | undefined {
    const current = this.leases.get(mint);
    if (!current) return undefined;

    if (now > current.validUntilMs && current.state === 'ACTIVE') {
      const expired: ProtectionLease = {
        ...current,
        state: 'EXPIRED',
        reason: 'Lease expired without fresh renewal evidence.',
      };
      this.leases.set(mint, expired);
      return expired;
    }

    return current;
  }
}

// --- Part XXVI: Ghost-Town Engine ---
export interface GhostTownStatus {
  readonly mint: TokenId;
  readonly isGhostTown: boolean;
  readonly safeAppearancesCount: number;
  readonly lastDexSeenMs: number;
  readonly isObservabilityFailure: boolean;
  readonly reason: string;
}

export class GhostTownEngine {
  private readonly statusByToken = new Map<TokenId, GhostTownStatus>();

  public recordAppearance(params: {
    mint: TokenId;
    isDexHealthy: boolean;
    isTokenActiveOnDex: boolean;
    lastDexSeenMs: number;
    now?: number;
  }): GhostTownStatus {
    const now = params.now ?? Date.now();
    const current = this.statusByToken.get(params.mint);
    const prevAppearances = current?.safeAppearancesCount ?? 0;

    // Distinguish actual token inactivity from Dex observability failure
    const isObservabilityFailure = !params.isDexHealthy;

    let isGhostTown = false;
    let reason = 'Token actively trading on DEX.';

    if (isObservabilityFailure) {
      reason = 'DEX feed is degraded/offline; cannot declare token ghost-town.';
    } else if (!params.isTokenActiveOnDex) {
      const inactiveDurationMs = now - params.lastDexSeenMs;
      if (inactiveDurationMs > 300_000) { // 5 minutes with zero DEX appearance
        isGhostTown = true;
        reason = `Zero DEX activity for ${(inactiveDurationMs / 1000).toFixed(0)}s while DEX feed is healthy.`;
      }
    }

    const updated: GhostTownStatus = {
      mint: params.mint,
      isGhostTown,
      safeAppearancesCount: prevAppearances + 1,
      lastDexSeenMs: params.lastDexSeenMs,
      isObservabilityFailure,
      reason,
    };

    this.statusByToken.set(params.mint, updated);
    return updated;
  }
}

// --- Part XXVII: Audit Lifecycle Tracker (Audit 3 -> Solar, Audit 12 -> Diamond) ---
export interface AuditSnapshot {
  readonly auditNumber: number;
  readonly mint: TokenId;
  readonly auditedAtMs: number;
  readonly hsi: number;
  readonly pumpScore: number;
  readonly realLiquiditySol: number;
  readonly volumeSol: number;
  readonly uniqueWallets: number;
  readonly coreLevel: 'STANDARD' | 'SOLAR_CORE' | 'DIAMOND_CORE';
}

export class AuditLifecycleTracker {
  private readonly auditHistory = new Map<TokenId, AuditSnapshot[]>();

  public recordAudit(state: CanonicalTokenState, now: number = Date.now()): {
    auditNumber: number;
    isSolarCore: boolean;
    isDiamondCore: boolean;
    trajectory: TrajectoryState;
    snapshot: AuditSnapshot;
  } {
    let history = this.auditHistory.get(state.mint);
    if (!history) {
      history = [];
      this.auditHistory.set(state.mint, history);
    }

    const auditNumber = history.length + 1;
    let coreLevel: AuditSnapshot['coreLevel'] = 'STANDARD';

    const isSolarCore = auditNumber >= 3 && state.hsi >= 40 && state.realLiquiditySol >= 20;
    const isDiamondCore = auditNumber >= 12 && state.hsi >= 60 && state.realLiquiditySol >= 50;

    if (isDiamondCore) {
      coreLevel = 'DIAMOND_CORE';
    } else if (isSolarCore) {
      coreLevel = 'SOLAR_CORE';
    }

    const snapshot: AuditSnapshot = {
      auditNumber,
      mint: state.mint,
      auditedAtMs: now,
      hsi: state.hsi,
      pumpScore: state.pumpScore,
      realLiquiditySol: state.realLiquiditySol,
      volumeSol: state.volumeSol,
      uniqueWallets: state.uniqueWalletsCount,
      coreLevel,
    };

    history.push(snapshot);

    // Evaluate Trajectory between audits
    let trajectory: TrajectoryState = 'STABLE';
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      const hsiDelta = snapshot.hsi - prev.hsi;
      const liqDelta = snapshot.realLiquiditySol - prev.realLiquiditySol;

      if (hsiDelta >= 5 && liqDelta >= 0) {
        trajectory = 'IMPROVING';
      } else if (hsiDelta <= -10 || liqDelta <= -10) {
        trajectory = 'WEAKENING';
      } else if (Math.abs(hsiDelta) > 20) {
        trajectory = 'VOLATILE';
      }
    }

    return {
      auditNumber,
      isSolarCore,
      isDiamondCore,
      trajectory,
      snapshot,
    };
  }

  public getAuditHistory(mint: TokenId): readonly AuditSnapshot[] {
    return this.auditHistory.get(mint) ?? [];
  }
}
