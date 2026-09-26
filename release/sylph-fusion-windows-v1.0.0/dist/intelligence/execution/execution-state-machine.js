/**
 * SOL-SYLPH Master Production Intelligence - Execution State Machine & Assertions
 * Specifications: Sections 60 (Position State Machine), 61 (Execution State Machine),
 * 63 (Execution Assertions), 64 (Execution Economics).
 */
export class ExecutionStateMachine {
    static VALID_TRANSITIONS = {
        CREATED: ['QUOTED', 'VALIDATED'],
        QUOTED: ['VALIDATED'],
        VALIDATED: ['BUILT'],
        BUILT: ['SIGNED'],
        SIGNED: ['SUBMITTED'],
        SUBMITTED: ['RECEIVED', 'PROCESSED', 'CONFIRMED'],
        RECEIVED: ['PROCESSED', 'CONFIRMED'],
        PROCESSED: ['CONFIRMED'],
        CONFIRMED: ['FINALIZED', 'RECONCILED'],
        FINALIZED: ['RECONCILED'],
        RECONCILED: [],
    };
    static transition(current, next) {
        const allowed = ExecutionStateMachine.VALID_TRANSITIONS[current];
        if (!allowed || !allowed.includes(next)) {
            throw new Error(`Illegal execution transition: Cannot transition from ${current} to ${next}`);
        }
        return next;
    }
    /**
     * Pre-execution sanity assertions. Fails closed if any invariant is violated.
     */
    static assertPreExecution(params) {
        if (!params.riskAuthorized) {
            throw new Error('PRE_EXECUTION_ASSERTION_FAILED: Risk is not authorized');
        }
        if (!params.capitalReserved) {
            throw new Error('PRE_EXECUTION_ASSERTION_FAILED: Capital reservation is missing');
        }
        if (params.cashBalanceLamports < params.orderCostLamports) {
            throw new Error(`PRE_EXECUTION_ASSERTION_FAILED: Cash balance (${params.cashBalanceLamports}) < order cost (${params.orderCostLamports})`);
        }
        if (params.quoteAgeMs > params.maxQuoteAgeMs) {
            throw new Error(`PRE_EXECUTION_ASSERTION_FAILED: Quote is stale (${params.quoteAgeMs} ms > max ${params.maxQuoteAgeMs} ms)`);
        }
        if (!params.blockhashValid) {
            throw new Error('PRE_EXECUTION_ASSERTION_FAILED: Blockhash is expired or invalid');
        }
    }
    /**
     * Post-execution reconciliation assertions.
     */
    static assertPostExecution(params) {
        if (!params.signature || params.signature.length < 32) {
            throw new Error('POST_EXECUTION_ASSERTION_FAILED: Invalid transaction signature');
        }
        if (!params.chainConfirmed) {
            throw new Error('POST_EXECUTION_ASSERTION_FAILED: Transaction not confirmed on chain');
        }
        if (params.expectedSide === 'buy') {
            if (params.tokenDelta <= 0n) {
                throw new Error('POST_EXECUTION_ASSERTION_FAILED: Buy execution resulted in non-positive token delta');
            }
            if (params.solDelta >= 0n) {
                throw new Error('POST_EXECUTION_ASSERTION_FAILED: Buy execution resulted in non-negative SOL delta');
            }
        }
        else {
            if (params.tokenDelta >= 0n) {
                throw new Error('POST_EXECUTION_ASSERTION_FAILED: Sell execution resulted in non-negative token delta');
            }
            if (params.solDelta <= 0n) {
                throw new Error('POST_EXECUTION_ASSERTION_FAILED: Sell execution resulted in non-positive SOL delta');
            }
        }
    }
}
//# sourceMappingURL=execution-state-machine.js.map