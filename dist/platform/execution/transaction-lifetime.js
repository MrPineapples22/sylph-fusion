/**
 * Transaction lifetime is an authorization boundary, not a retry hint.
 *
 * A payload whose blockhash lifetime cannot be proven must never be submitted.
 * This module is deliberately transport-agnostic so a signer, RPC adapter, or
 * Jito backend can enforce the same decision before it sends bytes anywhere.
 */
export const DEFAULT_TRANSACTION_LIFETIME_POLICY = Object.freeze({
    minimumBlocksForSigning: 20,
    minimumBlocksForSubmission: 4,
});
function validNonNegativeInteger(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
export class TransactionLifetimeAuthority {
    static assess(blockhash, blockhashContextSlot, blockhashObservedAt, lastValidBlockHeight, currentBlockHeight, policy = DEFAULT_TRANSACTION_LIFETIME_POLICY) {
        if (!blockhash || !validNonNegativeInteger(blockhashContextSlot) || !validNonNegativeInteger(blockhashObservedAt) ||
            !validNonNegativeInteger(lastValidBlockHeight) || !this.validPolicy(policy) || !validNonNegativeInteger(currentBlockHeight)) {
            return Object.freeze({ blockhash, blockhashContextSlot, blockhashObservedAt, lastValidBlockHeight, currentBlockHeight, state: 'UNKNOWN' });
        }
        const remainingBlocks = lastValidBlockHeight - currentBlockHeight;
        const state = remainingBlocks < 0
            ? 'EXPIRED'
            : remainingBlocks < policy.minimumBlocksForSubmission
                ? 'NEAR_EXPIRY'
                : remainingBlocks < policy.minimumBlocksForSigning
                    ? 'AGING'
                    : 'FRESH';
        return Object.freeze({ blockhash, blockhashContextSlot, blockhashObservedAt, lastValidBlockHeight, currentBlockHeight, remainingBlocks, state });
    }
    static authorizeSigning(lifetime, policy = DEFAULT_TRANSACTION_LIFETIME_POLICY) {
        const remaining = lifetime.remainingBlocks;
        if (lifetime.state === 'EXPIRED' || (remaining !== undefined && remaining < 0))
            return this.denied('EXPIRED', 'BLOCKHASH_EXPIRED');
        if (!this.validPolicy(policy) || !validNonNegativeInteger(remaining))
            return this.denied('UNKNOWN', 'BLOCKHASH_LIFETIME_UNKNOWN');
        if (remaining < policy.minimumBlocksForSigning)
            return this.denied(lifetime.state, 'BLOCKHASH_INSUFFICIENT_FOR_SIGNING');
        return Object.freeze({ allowed: true, state: lifetime.state === 'FRESH' ? 'FRESH' : 'AGING', remainingBlocks: remaining });
    }
    static authorizeSubmission(lifetime, policy = DEFAULT_TRANSACTION_LIFETIME_POLICY) {
        const remaining = lifetime.remainingBlocks;
        if (lifetime.state === 'EXPIRED' || (remaining !== undefined && remaining < 0))
            return this.denied('EXPIRED', 'BLOCKHASH_EXPIRED');
        if (!this.validPolicy(policy) || !validNonNegativeInteger(remaining))
            return this.denied('UNKNOWN', 'BLOCKHASH_LIFETIME_UNKNOWN');
        if (remaining < policy.minimumBlocksForSubmission)
            return this.denied(lifetime.state, 'BLOCKHASH_NEAR_EXPIRY');
        return Object.freeze({ allowed: true, state: lifetime.state === 'FRESH' ? 'FRESH' : 'AGING', remainingBlocks: remaining });
    }
    static validPolicy(policy) {
        return validNonNegativeInteger(policy.minimumBlocksForSubmission) && validNonNegativeInteger(policy.minimumBlocksForSigning) &&
            policy.minimumBlocksForSigning >= policy.minimumBlocksForSubmission && policy.minimumBlocksForSubmission > 0;
    }
    static denied(state, reason) {
        return Object.freeze({ allowed: false, state, reason });
    }
}
//# sourceMappingURL=transaction-lifetime.js.map