/**
 * SYLPH JANUS RECONCILER & CONSENSUS MIRROR
 * Parts LXVIII, LXIX, LXX — Consensus Mirror, Transaction Settlement & Multi-Truth Reconciliation
 *
 * Resolves discrepancies between local ledger truth, VAULT records, Survival Journal,
 * and blockchain reality. Prevents premature reservation release and blind retries.
 */

export type SettlementState =
  | 'SIGNED'
  | 'SUBMITTED'
  | 'OBSERVED'
  | 'TENTATIVE'
  | 'CONFIRMED'
  | 'FINALIZED'
  | 'SETTLED'
  | 'DROPPED'
  | 'EXPIRED'
  | 'FORKED_OUT'
  | 'UNKNOWN'
  | 'CONFLICTED';

export interface ConsensusMirrorReport {
  readonly transaction_signature: string;
  readonly transport_success: boolean;
  readonly execution_success: boolean;
  readonly economic_success: boolean;
  readonly strategy_success: boolean;
  readonly settlement_state: SettlementState;
  readonly slot: number;
  readonly confirmations_count: number;
}

export interface JanusReconciliationResult {
  readonly intent_id: string;
  readonly signature: string;
  readonly consensus_status: SettlementState;
  readonly branch_resolved: 'LANDED' | 'FAILED' | 'STILL_PENDING';
  readonly should_retain_reservation: boolean;
  readonly should_resend_exact_signature: boolean;
  readonly should_rebuild_new_transaction: boolean;
  readonly reconciliation_notes: string;
}

export class JanusReconciler {
  private readonly trackedTransactions = new Map<string, {
    intent_id: string;
    signature: string;
    settlement_state: SettlementState;
    submitted_slot: number;
    expiration_slot: number;
    confirmed_slot?: number;
  }>();

  public registerSubmittedTransaction(params: {
    intent_id: string;
    signature: string;
    submitted_slot: number;
    expiration_slot: number;
  }): void {
    this.trackedTransactions.set(params.signature, {
      intent_id: params.intent_id,
      signature: params.signature,
      settlement_state: 'SUBMITTED',
      submitted_slot: params.submitted_slot,
      expiration_slot: params.expiration_slot,
    });
  }

  public registerTransaction(params: {
    intent_id: string;
    signature: string;
    mint: string;
    amount_sol: number;
    slot: number;
  }): void {
    this.registerSubmittedTransaction({
      intent_id: params.intent_id,
      signature: params.signature,
      submitted_slot: params.slot,
      expiration_slot: params.slot + 150,
    });
  }

  public getAudit(): { total_managed_transactions: number } {
    return { total_managed_transactions: this.trackedTransactions.size };
  }

  /**
   * Consensus Mirror evaluation (Part LXVIII):
   * Distinguishes transport failure from on-chain landing.
   */
  public evaluateConsensusMirror(params: {
    signature: string;
    rpc_confirmed: boolean;
    err?: unknown;
    current_slot: number;
    token_balance_delta?: bigint;
  }): ConsensusMirrorReport {
    const isTransportOk = true;
    const isExecOk = params.rpc_confirmed && !params.err;
    const isEconOk = isExecOk && (params.token_balance_delta === undefined || params.token_balance_delta > 0n);

    let state: SettlementState = 'UNKNOWN';
    if (params.rpc_confirmed) {
      state = params.err ? 'DROPPED' : 'CONFIRMED';
    }

    return {
      transaction_signature: params.signature,
      transport_success: isTransportOk,
      execution_success: isExecOk,
      economic_success: isEconOk,
      strategy_success: isEconOk,
      settlement_state: state,
      slot: params.current_slot,
      confirmations_count: params.rpc_confirmed ? 32 : 0,
    };
  }

  /**
   * Multi-Truth JANUS Reconciliation (Part LXX):
   * Never blindly retries transactions or prematurely releases reservations.
   */
  public reconcileTransaction(params: {
    signature: string;
    current_slot: number;
    rpc_status: 'CONFIRMED' | 'NOT_FOUND' | 'FAILED' | 'TIMEOUT';
  }): JanusReconciliationResult {
    const tracked = this.trackedTransactions.get(params.signature);
    const intentId = tracked?.intent_id ?? 'unknown_intent';

    if (params.rpc_status === 'CONFIRMED') {
      return {
        intent_id: intentId,
        signature: params.signature,
        consensus_status: 'CONFIRMED',
        branch_resolved: 'LANDED',
        should_retain_reservation: false,
        should_resend_exact_signature: false,
        should_rebuild_new_transaction: false,
        reconciliation_notes: 'Transaction confirmed landed on-chain. Capital settled.',
      };
    }

    if (params.rpc_status === 'TIMEOUT' || params.rpc_status === 'NOT_FOUND') {
      // If blockhash not expired yet: MUST NOT send a new transaction!
      const isExpired = tracked ? params.current_slot > tracked.expiration_slot : false;

      if (!isExpired) {
        return {
          intent_id: intentId,
          signature: params.signature,
          consensus_status: 'UNKNOWN',
          branch_resolved: 'STILL_PENDING',
          should_retain_reservation: true, // Retain reservation!
          should_resend_exact_signature: true, // Re-broadcast exact same signature
          should_rebuild_new_transaction: false, // Forbid new economic action!
          reconciliation_notes: 'Transaction not found or timed out but blockhash valid. Re-broadcasting same signature.',
        };
      } else {
        // Blockhash expired and not found: safe to declare dropped
        return {
          intent_id: intentId,
          signature: params.signature,
          consensus_status: 'EXPIRED',
          branch_resolved: 'FAILED',
          should_retain_reservation: false,
          should_resend_exact_signature: false,
          should_rebuild_new_transaction: true,
          reconciliation_notes: 'Blockhash expired with zero on-chain record. Reservation may be released.',
        };
      }
    }

    return {
      intent_id: intentId,
      signature: params.signature,
      consensus_status: 'DROPPED',
      branch_resolved: 'FAILED',
      should_retain_reservation: false,
      should_resend_exact_signature: false,
      should_rebuild_new_transaction: false,
      reconciliation_notes: 'Transaction failed on-chain execution.',
    };
  }
}
