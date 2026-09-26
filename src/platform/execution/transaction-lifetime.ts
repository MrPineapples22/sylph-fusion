/**
 * Transaction lifetime is an authorization boundary, not a retry hint.
 *
 * A payload whose blockhash lifetime cannot be proven must never be submitted.
 * This module is deliberately transport-agnostic so a signer, RPC adapter, or
 * Jito backend can enforce the same decision before it sends bytes anywhere.
 */

export type TransactionLifetimeState = 'FRESH' | 'AGING' | 'NEAR_EXPIRY' | 'EXPIRED' | 'UNKNOWN';

export interface TransactionLifetime {
  readonly blockhash: string;
  readonly blockhashContextSlot: number;
  readonly blockhashObservedAt: number;
  readonly lastValidBlockHeight: number;
  readonly currentBlockHeight?: number;
  readonly remainingBlocks?: number;
  readonly state: TransactionLifetimeState;
}

export interface TransactionLifetimePolicy {
  /** A new signing sequence must retain at least this many blocks. */
  readonly minimumBlocksForSigning: number;
  /** Submission may use a smaller buffer, but never an expired/unknown lifetime. */
  readonly minimumBlocksForSubmission: number;
}

export const DEFAULT_TRANSACTION_LIFETIME_POLICY: TransactionLifetimePolicy = Object.freeze({
  minimumBlocksForSigning: 20,
  minimumBlocksForSubmission: 4,
});

export type LifetimeDecision =
  | { readonly allowed: true; readonly state: 'FRESH' | 'AGING'; readonly remainingBlocks: number }
  | { readonly allowed: false; readonly state: TransactionLifetimeState; readonly reason: string };

function validNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export class TransactionLifetimeAuthority {
  public static assess(
    blockhash: string,
    blockhashContextSlot: number,
    blockhashObservedAt: number,
    lastValidBlockHeight: number,
    currentBlockHeight: number | undefined,
    policy: TransactionLifetimePolicy = DEFAULT_TRANSACTION_LIFETIME_POLICY,
  ): TransactionLifetime {
    if (!blockhash || !validNonNegativeInteger(blockhashContextSlot) || !validNonNegativeInteger(blockhashObservedAt) ||
        !validNonNegativeInteger(lastValidBlockHeight) || !this.validPolicy(policy) || !validNonNegativeInteger(currentBlockHeight)) {
      return Object.freeze({ blockhash, blockhashContextSlot, blockhashObservedAt, lastValidBlockHeight, currentBlockHeight, state: 'UNKNOWN' });
    }

    const remainingBlocks = lastValidBlockHeight - currentBlockHeight;
    const state: TransactionLifetimeState = remainingBlocks < 0
      ? 'EXPIRED'
      : remainingBlocks < policy.minimumBlocksForSubmission
        ? 'NEAR_EXPIRY'
        : remainingBlocks < policy.minimumBlocksForSigning
          ? 'AGING'
          : 'FRESH';
    return Object.freeze({ blockhash, blockhashContextSlot, blockhashObservedAt, lastValidBlockHeight, currentBlockHeight, remainingBlocks, state });
  }

  public static authorizeSigning(lifetime: TransactionLifetime, policy: TransactionLifetimePolicy = DEFAULT_TRANSACTION_LIFETIME_POLICY): LifetimeDecision {
    const remaining = lifetime.remainingBlocks;
    if (lifetime.state === 'EXPIRED' || (remaining !== undefined && remaining < 0)) return this.denied('EXPIRED', 'BLOCKHASH_EXPIRED');
    if (!this.validPolicy(policy) || !validNonNegativeInteger(remaining)) return this.denied('UNKNOWN', 'BLOCKHASH_LIFETIME_UNKNOWN');
    if (remaining < policy.minimumBlocksForSigning) return this.denied(lifetime.state, 'BLOCKHASH_INSUFFICIENT_FOR_SIGNING');
    return Object.freeze({ allowed: true, state: lifetime.state === 'FRESH' ? 'FRESH' : 'AGING', remainingBlocks: remaining });
  }

  public static authorizeSubmission(lifetime: TransactionLifetime, policy: TransactionLifetimePolicy = DEFAULT_TRANSACTION_LIFETIME_POLICY): LifetimeDecision {
    const remaining = lifetime.remainingBlocks;
    if (lifetime.state === 'EXPIRED' || (remaining !== undefined && remaining < 0)) return this.denied('EXPIRED', 'BLOCKHASH_EXPIRED');
    if (!this.validPolicy(policy) || !validNonNegativeInteger(remaining)) return this.denied('UNKNOWN', 'BLOCKHASH_LIFETIME_UNKNOWN');
    if (remaining < policy.minimumBlocksForSubmission) return this.denied(lifetime.state, 'BLOCKHASH_NEAR_EXPIRY');
    return Object.freeze({ allowed: true, state: lifetime.state === 'FRESH' ? 'FRESH' : 'AGING', remainingBlocks: remaining });
  }

  private static validPolicy(policy: TransactionLifetimePolicy): boolean {
    return validNonNegativeInteger(policy.minimumBlocksForSubmission) && validNonNegativeInteger(policy.minimumBlocksForSigning) &&
      policy.minimumBlocksForSigning >= policy.minimumBlocksForSubmission && policy.minimumBlocksForSubmission > 0;
  }

  private static denied(state: TransactionLifetimeState, reason: string): LifetimeDecision {
    return Object.freeze({ allowed: false, state, reason });
  }
}
