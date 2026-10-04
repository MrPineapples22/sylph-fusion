/**
 * SYLPH FUSION — SAFE-CANARY-X: CANARY INVARIANT ENGINE
 * Specifications: Master Blueprint Section XXV (Canary Invariant)
 *
 * Invariant: An unresolved canary consumes full risk budget and blocks conflicting
 * new exposure until authoritative reconciliation.
 */

export interface ActiveCanaryState {
  readonly experimentId: string;
  readonly targetMint: string;
  readonly allocatedCapitalLamports: bigint;
  readonly isEntryExecuted: boolean;
  readonly isExitExecuted: boolean;
  readonly isAuthoritativelyReconciled: boolean;
}

export class CanaryInvariantController {
  private activeCanaries = new Map<string, ActiveCanaryState>();

  public registerCanary(experimentId: string, targetMint: string, allocatedLamports: bigint): void {
    this.activeCanaries.set(experimentId, {
      experimentId,
      targetMint,
      allocatedCapitalLamports: allocatedLamports,
      isEntryExecuted: true,
      isExitExecuted: false,
      isAuthoritativelyReconciled: false,
    });
  }

  public recordExit(experimentId: string): void {
    const existing = this.activeCanaries.get(experimentId);
    if (!existing) return;
    this.activeCanaries.set(experimentId, { ...existing, isExitExecuted: true });
  }

  public reconcileCanary(experimentId: string): void {
    const existing = this.activeCanaries.get(experimentId);
    if (!existing) return;
    this.activeCanaries.set(experimentId, { ...existing, isAuthoritativelyReconciled: true });
  }

  /**
   * Section XXV Invariant: An unresolved canary consumes full risk budget
   * and blocks conflicting new exposure until authoritative reconciliation.
   */
  public canAuthorizeNewExposure(targetMint: string): { allowed: boolean; reason?: string } {
    for (const canary of this.activeCanaries.values()) {
      if (!canary.isAuthoritativelyReconciled) {
        if (canary.targetMint === targetMint) {
          return {
            allowed: false,
            reason: `CANARY_CONFLICT: Unresolved canary ${canary.experimentId} is active on mint ${targetMint}; blocks new exposure`,
          };
        }
      }
    }
    return { allowed: true };
  }

  public getTotalUnresolvedCanaryRisk(): bigint {
    let sum = 0n;
    for (const canary of this.activeCanaries.values()) {
      if (!canary.isAuthoritativelyReconciled) {
        sum += canary.allocatedCapitalLamports;
      }
    }
    return sum;
  }
}
