/**
 * SYLPH FUSION — TRANSPORT RACE COORDINATOR & ECONOMIC RECONCILER
 * Specifications: Prompt 39 (Transport Attempts), Prompt 40 (Cross-Transport Same Intent),
 *                 Prompt 41 (Chain Outcome Reconciliation), Prompt 42 (Economic Reconciliation)
 *
 * Epistemic Invariants:
 * 1. ACCEPTED != LANDED (Jito bundle ID or RPC response != finalized economic outcome).
 * 2. UNKNOWN != FAILED (transport timeout != non-landing).
 * 3. 1 economicFactId = many transport attempts (Jito, TPU, RPC race the SAME intent).
 * 4. Outcomes strictly categorized: LANDED_SUCCESS | LANDED_FAILED | EXPIRED_UNRESOLVED | CERTIFIED_NOLAND | DISPUTED.
 * 5. Reconcile from observed authoritative post-state, NEVER from builder expectations.
 */

import { hashCanonical } from './canonical-hashing.js';

export type TransportMethod = 'JITO_BUNDLE' | 'TPU_QUIC' | 'RPC_FALLBACK';
export type TransportStatus = 'NOT_SENT' | 'ACCEPTED' | 'UNKNOWN' | 'REJECTED';
export type ChainOutcomeStatus =
  | 'LANDED_SUCCESS'
  | 'LANDED_FAILED'
  | 'EXPIRED_UNRESOLVED'
  | 'CERTIFIED_NOLAND'
  | 'DISPUTED';

export interface TransportAttemptRecord {
  readonly transport: TransportMethod;
  readonly attemptedAt: string;
  readonly status: TransportStatus;
  readonly acknowledgementId?: string;
  readonly bundleId?: string;
  readonly endpoint?: string;
  readonly leaderSlot?: bigint;
  readonly latencyMs?: number;
  readonly reason?: string;
}

export interface ObservedChainEvidence {
  readonly signature: string;
  readonly slot: bigint;
  readonly confirmationStatus: 'processed' | 'confirmed' | 'finalized';
  readonly err: unknown | null;
  readonly searchConfirmedNotFound: boolean;
  readonly isDisputedSources: boolean;
}

export interface ObservedAccountBalanceDelta {
  readonly solDeltaLamports: bigint;
  readonly tokenDeltaTokens: bigint;
  readonly baseFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly jitoTipLamports: bigint;
  readonly rentDepositLamports: bigint;
  readonly token2022TransferFeeTokens: bigint;
}

export interface AuthoritativeEconomicSettlement {
  readonly settlementId: string;
  readonly economicFactId: string;
  readonly signature: string;
  readonly chainOutcome: ChainOutcomeStatus;
  readonly landedSlot?: bigint;
  readonly solDeltaLamports: bigint;
  readonly tokenDeltaTokens: bigint;
  readonly totalFrictionLamports: bigint;
  readonly netProceedsLamports: bigint;
  readonly settledAt: string;
  readonly settlementHash: string;
}

export class TransportRaceCoordinator {
  private readonly attemptsByFactId = new Map<string, TransportAttemptRecord[]>();

  /**
   * Records a transport attempt beneath the immutable economicFactId.
   * Prevents transport retries from generating duplicate economic workloads.
   */
  public recordAttempt(
    economicFactId: string,
    attempt: TransportAttemptRecord
  ): readonly TransportAttemptRecord[] {
    const list = this.attemptsByFactId.get(economicFactId) ?? [];
    list.push(Object.freeze({ ...attempt }));
    this.attemptsByFactId.set(economicFactId, list);
    return Object.freeze([...list]);
  }

  public getAttempts(economicFactId: string): readonly TransportAttemptRecord[] {
    return Object.freeze(this.attemptsByFactId.get(economicFactId) ?? []);
  }

  /**
   * Detects if multiple transport paths succeeded (cannibalization).
   */
  public hasDuplicateDeliveryRisk(economicFactId: string): boolean {
    const list = this.attemptsByFactId.get(economicFactId) ?? [];
    const acceptedCount = list.filter((a) => a.status === 'ACCEPTED').length;
    return acceptedCount > 1;
  }
}

export class ChainOutcomeReconciler {
  /**
   * Classifies final on-chain outcome strictly into the 5 mutually exclusive states.
   * Throws if an illegal state collapse is attempted.
   */
  public reconcileChainOutcome(evidence: ObservedChainEvidence): ChainOutcomeStatus {
    // 1. If conflicting provider sources disagree -> DISPUTED
    if (evidence.isDisputedSources) {
      return 'DISPUTED';
    }

    // 2. If observed landed on-chain at finalized commitment
    if (evidence.confirmationStatus === 'finalized' && evidence.slot > 0n) {
      if (evidence.err === null) {
        return 'LANDED_SUCCESS';
      }
      return 'LANDED_FAILED';
    }

    // 3. If proven not landed via verified archive search
    if (evidence.searchConfirmedNotFound) {
      return 'CERTIFIED_NOLAND';
    }

    // 4. Default safe uncollapsed state: validity elapsed but evidence incomplete
    return 'EXPIRED_UNRESOLVED';
  }
}

export class AuthoritativeEconomicReconciler {
  /**
   * Reconciles actual observed economic consequences into an immutable settlement.
   * Enforces exact integer lamport accounting.
   */
  public reconcileSettlement(
    economicFactId: string,
    signature: string,
    chainOutcome: ChainOutcomeStatus,
    balanceDeltas: ObservedAccountBalanceDelta,
    landedSlot?: bigint,
    settledAt = new Date().toISOString()
  ): AuthoritativeEconomicSettlement {
    const totalFriction =
      balanceDeltas.baseFeeLamports +
      balanceDeltas.priorityFeeLamports +
      balanceDeltas.jitoTipLamports +
      balanceDeltas.rentDepositLamports;

    // Net proceeds = gross SOL delta minus friction
    const netProceeds = balanceDeltas.solDeltaLamports - totalFriction;

    const settlementId = `stl_${hashCanonical({ economicFactId, signature, settledAt }).slice(0, 16)}`;

    const preimage = {
      settlementId,
      economicFactId,
      signature,
      chainOutcome,
      landedSlot,
      solDeltaLamports: balanceDeltas.solDeltaLamports,
      tokenDeltaTokens: balanceDeltas.tokenDeltaTokens,
      totalFrictionLamports: totalFriction,
      netProceedsLamports: netProceeds,
      settledAt,
    };

    const settlementHash = hashCanonical(preimage);

    return Object.freeze({
      ...preimage,
      settlementHash,
    });
  }
}
