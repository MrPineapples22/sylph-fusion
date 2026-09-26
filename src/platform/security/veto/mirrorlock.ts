/**
 * PHASE 15, 16 & 17 — QUORUMROOT, MIRRORLOCK & ECLIPSE-GUARD
 *
 * Implements:
 * - Signed ObservationReceipts for provider responses
 * - Provider Equivocation Detection (MirrorLock)
 * - Provider Failure Domain Independence (QuorumRoot)
 * - Missingness Security Dimension Classifier (EclipseGuard)
 *
 * Prime Invariant:
 * Provider failure or equivocation reduces provider authority;
 * it NEVER manufactures token guilt or a protected VETO.
 */

import { BankIdentity, SubjectIdentity, sha256Hex } from './types.js';

export interface ObservationReceipt {
  readonly receiptId: string;
  readonly providerId: string;
  readonly failureDomainId: string; // Causal infrastructure failure domain
  readonly endpoint: string;
  readonly subject: SubjectIdentity;
  readonly canonicalRequestHash: string;
  readonly rawResponseHash: string;
  readonly bankSlot: bigint;
  readonly bankBlockhash: string;
  readonly observedAtUnixMs: number;
  readonly signature?: string;
}

export type MissingnessClass =
  | 'NORMAL_LATENCY'
  | 'PROVIDER_OUTAGE'
  | 'RATE_LIMIT'
  | 'SCHEMA_FAILURE'
  | 'NETWORK_PARTITION'
  | 'CHAIN_UNAVAILABLE'
  | 'SELECTIVE_GAP'
  | 'CORRELATED_PROVIDER_GAP'
  | 'POSSIBLE_ADVERSARIAL_SUPPRESSION'
  | 'UNKNOWN_CAUSE';

export interface EquivocationReport {
  readonly providerId: string;
  readonly detectedAtUnixMs: number;
  readonly conflictingReceipts: readonly [ObservationReceipt, ObservationReceipt];
  readonly reason: string;
}

export class MirrorLock {
  private readonly receiptsByReqKey = new Map<string, ObservationReceipt[]>();
  private readonly quarantinedProviders = new Set<string>();
  private readonly equivocationLog: EquivocationReport[] = [];

  private reqKey(receipt: ObservationReceipt): string {
    return `${receipt.subject.kind}:${(receipt.subject as { mint?: string }).mint ?? ''}:${receipt.bankSlot}:${receipt.canonicalRequestHash}`;
  }

  /**
   * Records an observation receipt and actively checks for provider equivocation.
   * Equivocation occurs when the SAME provider reports DIFFERENT response hashes
   * for the exact same semantic request and bank slot.
   */
  public recordReceipt(receipt: ObservationReceipt): {
    readonly isAccepted: boolean;
    readonly equivocationDetected: boolean;
    readonly report?: EquivocationReport;
  } {
    if (this.quarantinedProviders.has(receipt.providerId)) {
      return { isAccepted: false, equivocationDetected: true };
    }

    const key = this.reqKey(receipt);
    const existing = this.receiptsByReqKey.get(key) ?? [];

    for (const prev of existing) {
      if (prev.providerId === receipt.providerId && prev.rawResponseHash !== receipt.rawResponseHash) {
        // Provider Equivocation confirmed!
        this.quarantinedProviders.add(receipt.providerId);
        const report: EquivocationReport = {
          providerId: receipt.providerId,
          detectedAtUnixMs: Date.now(),
          conflictingReceipts: [prev, receipt],
          reason: `Provider ${receipt.providerId} returned conflicting hashes for slot ${receipt.bankSlot}`,
        };
        this.equivocationLog.push(report);
        return { isAccepted: false, equivocationDetected: true, report };
      }
    }

    existing.push(receipt);
    this.receiptsByReqKey.set(key, existing);
    return { isAccepted: true, equivocationDetected: false };
  }

  public isProviderQuarantined(providerId: string): boolean {
    return this.quarantinedProviders.has(providerId);
  }

  public getEquivocations(): readonly EquivocationReport[] {
    return [...this.equivocationLog];
  }
}

export class QuorumRoot {
  /**
   * Verifies that corroborating receipts come from INDEPENDENT causal failure domains,
   * not merely multiple endpoints behind the same provider backend.
   */
  public static verifyFailureDomainDiversity(
    receipts: readonly ObservationReceipt[],
    requiredIndependentDomains: number
  ): { readonly satisfiesDiversity: boolean; readonly uniqueDomains: readonly string[] } {
    const domains = new Set<string>();
    for (const r of receipts) {
      domains.add(r.failureDomainId);
    }
    const uniqueDomains = Array.from(domains);
    return {
      satisfiesDiversity: uniqueDomains.length >= requiredIndependentDomains,
      uniqueDomains,
    };
  }
}

export class EclipseGuard {
  /**
   * Classifies missing evidence into a typed security dimension.
   * Missing evidence triggers operational containment (WAIT, QUARANTINE), NEVER a token VETO.
   */
  public static classifyMissingness(params: {
    latencyMs: number;
    httpStatus?: number;
    failedProvidersCount: number;
    totalProvidersCount: number;
    isSchemaError: boolean;
    isSelectiveGap: boolean;
  }): { readonly classification: MissingnessClass; readonly operationalAction: 'WAIT' | 'QUARANTINE' | 'BLOCK_NEW_ENTRY' } {
    if (params.isSchemaError) {
      return { classification: 'SCHEMA_FAILURE', operationalAction: 'QUARANTINE' };
    }
    if (params.httpStatus === 429) {
      return { classification: 'RATE_LIMIT', operationalAction: 'WAIT' };
    }
    if (params.isSelectiveGap) {
      return { classification: 'POSSIBLE_ADVERSARIAL_SUPPRESSION', operationalAction: 'BLOCK_NEW_ENTRY' };
    }
    if (params.failedProvidersCount === params.totalProvidersCount && params.totalProvidersCount > 0) {
      return { classification: 'CORRELATED_PROVIDER_GAP', operationalAction: 'QUARANTINE' };
    }
    if (params.failedProvidersCount > 0) {
      return { classification: 'PROVIDER_OUTAGE', operationalAction: 'WAIT' };
    }
    if (params.latencyMs > 5000) {
      return { classification: 'NORMAL_LATENCY', operationalAction: 'WAIT' };
    }
    return { classification: 'UNKNOWN_CAUSE', operationalAction: 'WAIT' };
  }
}
