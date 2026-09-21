/**
 * SYLPH HIERARCHICAL & SERIALIZABLE RESERVATION ENGINE
 * Parts VIII, IX, X, XI — Serializable Commit, Hierarchical Ownership,
 * Worst-Case Accounting & Economic Intent Identity
 *
 * Prevents concurrent trades from violating portfolio boundaries.
 * Decouples economic intents from transaction candidate IDs.
 */
export class HierarchicalReservationEngine {
    intents = new Map(); // key = economic_intent_id
    reservations = new Map();
    /**
     * Calculates total worst-case capital requirement including all edge fees (Part X).
     */
    calculateWorstCase(params) {
        const baseFee = 0.000005;
        const prioMult = params.priority_fee_multiplier ?? 1.5;
        const maxPrioFee = 0.0005 * prioMult;
        const jitoTip = (params.jito_tip_lamports ?? 100_000) / 1e9;
        const ataRent = params.needs_ata_creation ? 0.00203928 : 0.0;
        const slippageBps = params.max_slippage_bps ?? 300;
        const slippageBuffer = params.input_sol * (slippageBps / 10000);
        const total = params.input_sol + baseFee + maxPrioFee + jitoTip + ataRent + slippageBuffer;
        return {
            max_input_sol: params.input_sol,
            max_base_fee_sol: baseFee,
            max_priority_fee_sol: maxPrioFee,
            max_jito_tip_sol: jitoTip,
            ata_rent_sol: ataRent,
            max_slippage_bps: slippageBps,
            total_worst_case_sol: Number(total.toFixed(8)),
        };
    }
    /**
     * Prepares and registers an EconomicIntent decoupled from physical tx hash (Part XI).
     */
    createEconomicIntent(params) {
        const reservationId = `res_${params.economic_intent_id}_${params.state_version}`;
        // Exactly-once invariant: prevent duplicate economic intent creation
        if (this.intents.has(params.economic_intent_id)) {
            throw new Error(`DUPLICATE_ECONOMIC_INTENT: ${params.economic_intent_id} already exists`);
        }
        const intent = {
            economic_intent_id: params.economic_intent_id,
            candidate_transaction_id: params.candidate_transaction_id,
            reservation_id: reservationId,
            owner: params.owner,
            accounting: params.accounting,
            state: 'PREPARED',
            created_at_ms: Date.now(),
            expires_at_slot: params.expires_at_slot,
        };
        this.intents.set(params.economic_intent_id, intent);
        this.reservations.set(reservationId, {
            owner: params.owner,
            accounting: params.accounting,
            state_version_at_creation: params.state_version,
        });
        return intent;
    }
    /**
     * Updates candidate tx ID without duplicating economic action (e.g. fee requoting) (Part XI).
     */
    replaceCandidateTransaction(intentId, newCandidateTxId, newAccounting) {
        const intent = this.intents.get(intentId);
        if (!intent)
            throw new Error(`Intent not found: ${intentId}`);
        const updated = {
            ...intent,
            candidate_transaction_id: newCandidateTxId,
            accounting: newAccounting ?? intent.accounting,
        };
        this.intents.set(intentId, updated);
        return updated;
    }
    /**
     * Transition to UNKNOWN on timeout: reservation remains locked! (Part X).
     */
    markIntentUnknown(intentId) {
        const intent = this.intents.get(intentId);
        if (!intent)
            return;
        this.intents.set(intentId, { ...intent, state: 'UNKNOWN' });
    }
    getIntent(intentId) {
        return this.intents.get(intentId);
    }
    getActiveIntentCount() {
        let count = 0;
        for (const intent of this.intents.values()) {
            if (intent.state === 'PREPARED' || intent.state === 'RESERVED' || intent.state === 'COMMITTED' || intent.state === 'UNKNOWN') {
                count++;
            }
        }
        return count;
    }
}
//# sourceMappingURL=reservations.js.map