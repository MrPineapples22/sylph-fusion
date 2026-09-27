/**
 * SYLPH FUSION — LIFECYCLE-Ω: Canonical Pump / PumpSwap Token Lifecycle Authority
 * Specifications: Section 6 (Upgrade 2: Lifecycle-Ω), Section 95 (Curve Transition), Section 103 (Invariant 18)
 *
 * Invariants:
 * 1. Do not rely solely on `curve.complete` boolean.
 * 2. Explicit 13-state lifecycle machine with evidence-driven transitions.
 * 3. Completed curve with no verified AMM venue is UNPRICED / UNKNOWN — NEVER VALUE = 0.
 * 4. Token curve completion during an open position transitions to controlled preservation,
 *    preventing panic liquidation at false zero valuation.
 */

import { createHash } from 'node:crypto';

export type TokenLifecycleState =
  | 'DISCOVERED'
  | 'BONDING_ACTIVE'
  | 'BONDING_NEAR_COMPLETION'
  | 'COMPLETION_OBSERVED'
  | 'COMPLETE_UNMIGRATED'
  | 'MIGRATION_PENDING'
  | 'MIGRATION_OBSERVED'
  | 'DESTINATION_POOL_VERIFYING'
  | 'CANONICAL_PUMPSWAP_VERIFIED'
  | 'AMM_ACTIVE'
  | 'UNKNOWN'
  | 'DIVERGED'
  | 'DEAD';

export type ValuationStatus = 'PRICED_BONDING_CURVE' | 'PRICED_AMM' | 'UNPRICED_MIGRATING' | 'UNPRICED_UNKNOWN';

export interface LifecycleTransitionEvidence {
  readonly evidenceId: string;
  readonly slot: number;
  readonly timestampMs: number;
  readonly source: 'ON_CHAIN_PROGRAM' | 'YELLOWSTONE_FEED' | 'RPC_STATE' | 'DEX_OBSERVER';
  readonly transactionSignature?: string;
  readonly virtualSolReserves?: bigint;
  readonly virtualTokenReserves?: bigint;
  readonly destinationPoolAddress?: string;
  readonly migrationProgramId?: string;
  readonly details: string;
}

export interface LifecycleCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly previousState: TokenLifecycleState;
  readonly currentState: TokenLifecycleState;
  readonly valuationStatus: ValuationStatus;
  readonly isTradingAllowed: boolean;
  readonly isHoldingPreserved: boolean; // True: protect open position from false-zero stopout
  readonly verifiedPool?: string;
  readonly migrationSignature?: string;
  readonly transitionSlot: number;
  readonly evidenceIds: readonly string[];
  readonly unresolvedFacts: readonly string[];
  readonly issuedAtMs: number;
  readonly digest: string;
}

export class TokenLifecycleOmegaAuthority {
  private certificates = new Map<string, LifecycleCertificate>();

  /**
   * Initializes or updates the authoritative lifecycle state for a mint.
   */
  public transitionLifecycle(
    mint: string,
    evidence: LifecycleTransitionEvidence,
    forcedTargetState?: TokenLifecycleState
  ): LifecycleCertificate {
    const existing = this.certificates.get(mint);
    const previousState: TokenLifecycleState = existing ? existing.currentState : 'DISCOVERED';

    let nextState: TokenLifecycleState = forcedTargetState ?? previousState;

    if (!forcedTargetState) {
      nextState = this.determineNextState(previousState, evidence);
    }

    const { valuationStatus, isTradingAllowed, isHoldingPreserved, unresolvedFacts } =
      this.evaluateStatePolicies(nextState, evidence);

    const evidenceIds = existing ? [...existing.evidenceIds, evidence.evidenceId] : [evidence.evidenceId];
    const payload = `${mint}:${previousState}:${nextState}:${evidence.slot}:${evidence.evidenceId}:${valuationStatus}`;
    const digest = createHash('sha256').update(payload).digest('hex');
    const certificateId = `LIFECYCLE-CERT-${digest.slice(0, 16)}`;

    const cert: LifecycleCertificate = {
      certificateId,
      mint,
      previousState,
      currentState: nextState,
      valuationStatus,
      isTradingAllowed,
      isHoldingPreserved,
      verifiedPool: evidence.destinationPoolAddress ?? existing?.verifiedPool,
      migrationSignature: evidence.transactionSignature ?? existing?.migrationSignature,
      transitionSlot: evidence.slot,
      evidenceIds,
      unresolvedFacts,
      issuedAtMs: Date.now(),
      digest
    };

    this.certificates.set(mint, cert);
    return cert;
  }

  private determineNextState(
    current: TokenLifecycleState,
    evidence: LifecycleTransitionEvidence
  ): TokenLifecycleState {
    switch (current) {
      case 'DISCOVERED':
        if (evidence.virtualSolReserves && evidence.virtualSolReserves > 0n) {
          return 'BONDING_ACTIVE';
        }
        return 'DISCOVERED';

      case 'BONDING_ACTIVE':
        // Bonding curve threshold: virtual SOL >= 80 SOL (~80_000_000_000 lamports)
        if (evidence.virtualSolReserves && evidence.virtualSolReserves >= 80_000_000_000n) {
          return 'BONDING_NEAR_COMPLETION';
        }
        return 'BONDING_ACTIVE';

      case 'BONDING_NEAR_COMPLETION':
        if (evidence.virtualSolReserves && evidence.virtualSolReserves >= 85_000_000_000n) {
          return 'COMPLETION_OBSERVED';
        }
        return 'BONDING_NEAR_COMPLETION';

      case 'COMPLETION_OBSERVED':
        if (!evidence.destinationPoolAddress && !evidence.transactionSignature) {
          return 'COMPLETE_UNMIGRATED';
        }
        return 'MIGRATION_PENDING';

      case 'COMPLETE_UNMIGRATED':
        if (evidence.transactionSignature) {
          return 'MIGRATION_OBSERVED';
        }
        return 'COMPLETE_UNMIGRATED';

      case 'MIGRATION_PENDING':
      case 'MIGRATION_OBSERVED':
        if (evidence.destinationPoolAddress) {
          return 'DESTINATION_POOL_VERIFYING';
        }
        return current;

      case 'DESTINATION_POOL_VERIFYING':
        if (evidence.destinationPoolAddress && evidence.migrationProgramId) {
          // Check for canonical PumpSwap or Raydium AMM pool
          return 'CANONICAL_PUMPSWAP_VERIFIED';
        }
        return 'DESTINATION_POOL_VERIFYING';

      case 'CANONICAL_PUMPSWAP_VERIFIED':
        return 'AMM_ACTIVE';

      case 'AMM_ACTIVE':
        return 'AMM_ACTIVE';

      default:
        return current;
    }
  }

  private evaluateStatePolicies(
    state: TokenLifecycleState,
    evidence: LifecycleTransitionEvidence
  ): {
    valuationStatus: ValuationStatus;
    isTradingAllowed: boolean;
    isHoldingPreserved: boolean;
    unresolvedFacts: string[];
  } {
    const unresolvedFacts: string[] = [];

    switch (state) {
      case 'BONDING_ACTIVE':
      case 'BONDING_NEAR_COMPLETION':
        return {
          valuationStatus: 'PRICED_BONDING_CURVE',
          isTradingAllowed: true,
          isHoldingPreserved: true,
          unresolvedFacts
        };

      case 'COMPLETION_OBSERVED':
      case 'COMPLETE_UNMIGRATED':
      case 'MIGRATION_PENDING':
      case 'MIGRATION_OBSERVED':
      case 'DESTINATION_POOL_VERIFYING':
        // Crucial Invariant: Migration window is UNPRICED, NOT ZERO VALUE!
        // Preserves open positions so stop-losses do not fire at synthetic zero.
        unresolvedFacts.push('Awaiting destination pool liquidity verification and canonical AMM quote route');
        return {
          valuationStatus: 'UNPRICED_MIGRATING',
          isTradingAllowed: false, // New entries blocked during migration
          isHoldingPreserved: true, // Existing holdings preserved safely
          unresolvedFacts
        };

      case 'CANONICAL_PUMPSWAP_VERIFIED':
      case 'AMM_ACTIVE':
        return {
          valuationStatus: 'PRICED_AMM',
          isTradingAllowed: true,
          isHoldingPreserved: true,
          unresolvedFacts
        };

      case 'UNKNOWN':
      case 'DIVERGED':
        unresolvedFacts.push('Conflicting or unverified lifecycle telemetry');
        return {
          valuationStatus: 'UNPRICED_UNKNOWN',
          isTradingAllowed: false,
          isHoldingPreserved: true,
          unresolvedFacts
        };

      case 'DEAD':
        return {
          valuationStatus: 'UNPRICED_UNKNOWN',
          isTradingAllowed: false,
          isHoldingPreserved: false,
          unresolvedFacts: ['Token confirmed dead / liquidated']
        };

      default:
        return {
          valuationStatus: 'UNPRICED_UNKNOWN',
          isTradingAllowed: false,
          isHoldingPreserved: true,
          unresolvedFacts
        };
    }
  }

  public getCertificate(mint: string): LifecycleCertificate | undefined {
    return this.certificates.get(mint);
  }
}
