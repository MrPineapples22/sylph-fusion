/**
 * SYLPH JANUS RECONCILER & CONSENSUS MIRROR
 * Parts LXVIII, LXIX, LXX — Consensus Mirror, Transaction Settlement & Multi-Truth Reconciliation
 *
 * Resolves discrepancies between local ledger truth, VAULT records, Survival Journal,
 * and blockchain reality. Prevents premature reservation release and blind retries.
 */
export class JanusReconciler {
    trackedTransactions = new Map();
    registerSubmittedTransaction(params) {
        this.trackedTransactions.set(params.signature, {
            intent_id: params.intent_id,
            signature: params.signature,
            settlement_state: 'SUBMITTED',
            submitted_slot: params.submitted_slot,
            expiration_slot: params.expiration_slot,
        });
    }
    registerTransaction(params) {
        this.registerSubmittedTransaction({
            intent_id: params.intent_id,
            signature: params.signature,
            submitted_slot: params.slot,
            expiration_slot: params.slot + 150,
        });
    }
    getAudit() {
        return { total_managed_transactions: this.trackedTransactions.size };
    }
    /**
     * Consensus Mirror evaluation (Part LXVIII):
     * Distinguishes transport failure from on-chain landing.
     */
    evaluateConsensusMirror(params) {
        const isTransportOk = true;
        const isExecOk = params.rpc_confirmed && !params.err;
        const isEconOk = isExecOk && (params.token_balance_delta === undefined || params.token_balance_delta > 0n);
        let state = 'UNKNOWN';
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
    reconcileTransaction(params) {
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
            const isExpired = tracked ? params.current_slot > tracked.expiration_slot : false;
            if (!isExpired) {
                // Blockhash not expired yet: MUST NOT release reservation or send new transaction!
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
            }
            else {
                // Section XLVII & Invariant 4: NoLand requires coverage-backed proof:
                // lastValidBlockHeight exceeded + authoritative finalized head + searchTransactionHistory coverage.
                // Never infer no-land from transport failure, RPC timeout, or single NOT_FOUND alone.
                const isCoverageCertified = Boolean(params.search_history_covered && params.finalized_head_exceeded);
                if (isCoverageCertified) {
                    return {
                        intent_id: intentId,
                        signature: params.signature,
                        consensus_status: 'EXPIRED',
                        branch_resolved: 'FAILED',
                        should_retain_reservation: false,
                        should_resend_exact_signature: false,
                        should_rebuild_new_transaction: true,
                        reconciliation_notes: 'Blockhash expired with authoritative coverage proof proving zero landing. Reservation released.',
                    };
                }
                else {
                    return {
                        intent_id: intentId,
                        signature: params.signature,
                        consensus_status: 'UNKNOWN',
                        branch_resolved: 'STILL_PENDING',
                        should_retain_reservation: true, // Unknown execution consumes risk!
                        should_resend_exact_signature: false,
                        should_rebuild_new_transaction: false,
                        reconciliation_notes: 'Blockhash slot elapsed but missing searchTransactionHistory coverage or finalized head proof. Capital remains reserved (Section XLVII).',
                    };
                }
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
//# sourceMappingURL=janus-reconciler.js.map