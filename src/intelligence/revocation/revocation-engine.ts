/**
 * SYLPH REVOCATION ENGINE & PRE-SIGN REVOCATION BARRIER
 * Parts LV, LVI, LVII, LVIII, LIX, LX, LXI, LXII, LXIII, LXIV —
 * Monotonic Revocation Epoch, Selective Scopes, Revocation Barrier & Last-Moment Revalidation
 *
 * Implements fine-grained, instantaneous revocation that cascades through
 * proof leases, commit certificates, and the atomic signature gate.
 */

export type RevocationScope =
  | 'INTENT'
  | 'POSITION'
  | 'TOKEN'
  | 'PROGRAM'
  | 'ROUTE'
  | 'STRATEGY'
  | 'WALLET'
  | 'SIGNER'
  | 'GLOBAL';

export type RevocationPriority =
  | 'R0_INFORMATIONAL'
  | 'R1_REVALIDATE'
  | 'R2_BLOCK_NEW_EXPOSURE'
  | 'R3_REDUCE_ONLY'
  | 'R4_POSITION_LOCK'
  | 'R5_GLOBAL_SIGNER_LOCK';

export interface RevocationRecord {
  readonly revocation_id: string;
  readonly epoch: number;
  readonly scope: RevocationScope;
  readonly target_entity_id: string;
  readonly priority: RevocationPriority;
  readonly reason: string;
  readonly slot: number;
  readonly timestamp_ms: number;
}

export interface RevalidationReport {
  readonly is_cleared_to_sign: boolean;
  readonly active_revocation_epoch: number;
  readonly blocking_revocations: readonly RevocationRecord[];
  readonly latency_ms: number;
}

export class RevocationEngine {
  private currentEpoch = 1;
  private readonly activeRevocations = new Map<string, RevocationRecord>();
  private readonly resolvedRevocations = new Map<string, { record: RevocationRecord; resolvedSlot: number; resolutionReason: string }>();
  private readonly latencySamplesMs: number[] = [];

  public getCurrentEpoch(): number {
    return this.currentEpoch;
  }

  /**
   * Triggers a selective or global revocation (Parts LVII & LVIII).
   * Monotonically advances RevocationEpoch.
   */
  public triggerRevocation(params: {
    scope: RevocationScope;
    target_entity_id: string;
    priority: RevocationPriority;
    reason: string;
    slot: number;
  }): RevocationRecord {
    const startMs = Date.now();
    this.currentEpoch++;

    const id = `rev_${this.currentEpoch}_${params.scope}_${params.target_entity_id.slice(0, 8)}`;
    const record: RevocationRecord = {
      revocation_id: id,
      epoch: this.currentEpoch,
      scope: params.scope,
      target_entity_id: params.target_entity_id,
      priority: params.priority,
      reason: params.reason,
      slot: params.slot,
      timestamp_ms: startMs,
    };

    this.activeRevocations.set(id, record);
    this.latencySamplesMs.push(Date.now() - startMs);

    return record;
  }

  /**
   * Resolves an active revocation after verified remediation or recovery (Section 12).
   * Advances the revocation epoch so active leases revalidate cleanly.
   */
  public resolveRevocation(revocationId: string, reason: string, slot: number): boolean {
    const existing = this.activeRevocations.get(revocationId);
    if (!existing) return false;

    this.activeRevocations.delete(revocationId);
    this.resolvedRevocations.set(revocationId, {
      record: existing,
      resolvedSlot: slot,
      resolutionReason: reason,
    });
    this.currentEpoch++;
    return true;
  }

  /**
   * Expires stale time-bounded revocations (Section 12).
   */
  public expireRevocations(currentSlot: number, maxAgeSlots = 300): number {
    let expiredCount = 0;
    for (const [id, rev] of Array.from(this.activeRevocations.entries())) {
      if (rev.slot > 0 && currentSlot - rev.slot > maxAgeSlots) {
        this.resolveRevocation(id, `EXPIRED_AGE_SLOTS_${currentSlot - rev.slot}`, currentSlot);
        expiredCount++;
      }
    }
    return expiredCount;
  }

  /**
   * Pre-Sign Revocation Barrier & Last-Moment Revalidation (Parts LIX & LX):
   * Placed immediately before irreversible signing to verify no material dependency
   * has changed, expired, or been revoked.
   * Checks all supported scopes: GLOBAL, TOKEN, POSITION, PROGRAM, WALLET, ROUTE, STRATEGY, SIGNER.
   */
  public verifyRevocationBarrier(params: {
    token_mint: string;
    intent_id: string;
    strategy_id: string;
    route_name: string;
    request_revocation_epoch: number;
    wallet_address?: string;
    program_id?: string;
    position_id?: string;
    signer_id?: string;
  }): RevalidationReport {
    const startMs = Date.now();
    const blocking: RevocationRecord[] = [];

    // Check epoch stale (TOCTOU fence)
    if (params.request_revocation_epoch !== this.currentEpoch) {
      blocking.push({
        revocation_id: `STALE_EPOCH_${params.request_revocation_epoch}`,
        epoch: this.currentEpoch,
        scope: 'GLOBAL',
        target_entity_id: 'SYSTEM',
        priority: 'R2_BLOCK_NEW_EXPOSURE',
        reason: `Revocation epoch advanced: request=${params.request_revocation_epoch}, active=${this.currentEpoch}`,
        slot: 0,
        timestamp_ms: Date.now(),
      });
    }

    // Check active revocations matching target scopes
    for (const rev of this.activeRevocations.values()) {
      if (rev.priority === 'R0_INFORMATIONAL' || rev.priority === 'R1_REVALIDATE') continue;

      if (rev.scope === 'GLOBAL') {
        blocking.push(rev);
      } else if (rev.scope === 'TOKEN' && rev.target_entity_id === params.token_mint) {
        blocking.push(rev);
      } else if (rev.scope === 'INTENT' && rev.target_entity_id === params.intent_id) {
        blocking.push(rev);
      } else if (rev.scope === 'STRATEGY' && rev.target_entity_id === params.strategy_id) {
        blocking.push(rev);
      } else if (rev.scope === 'ROUTE' && rev.target_entity_id === params.route_name) {
        blocking.push(rev);
      } else if (rev.scope === 'WALLET' && params.wallet_address && rev.target_entity_id === params.wallet_address) {
        blocking.push(rev);
      } else if (rev.scope === 'PROGRAM' && params.program_id && rev.target_entity_id === params.program_id) {
        blocking.push(rev);
      } else if (rev.scope === 'POSITION' && ((params.position_id && rev.target_entity_id === params.position_id) || rev.target_entity_id === params.token_mint)) {
        blocking.push(rev);
      } else if (rev.scope === 'SIGNER' && params.signer_id && rev.target_entity_id === params.signer_id) {
        blocking.push(rev);
      }
    }

    const elapsed = Date.now() - startMs;
    this.latencySamplesMs.push(elapsed);

    return {
      is_cleared_to_sign: blocking.length === 0,
      active_revocation_epoch: this.currentEpoch,
      blocking_revocations: blocking,
      latency_ms: elapsed,
    };
  }

  /**
   * Returns revocation latency stats (Part LXIII).
   */
  public getLatencyMetrics(): { p50_ms: number; p95_ms: number; max_ms: number } {
    if (this.latencySamplesMs.length === 0) return { p50_ms: 0, p95_ms: 0, max_ms: 0 };
    const sorted = [...this.latencySamplesMs].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];
    return { p50_ms: p50, p95_ms: p95, max_ms: max };
  }

  public getActiveRevocations(): readonly RevocationRecord[] {
    return Array.from(this.activeRevocations.values());
  }

  public getResolvedRevocations(): readonly RevocationRecord[] {
    return Array.from(this.resolvedRevocations.values()).map(r => r.record);
  }
}
