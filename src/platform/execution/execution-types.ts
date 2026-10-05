/**
 * SYLPH FUSION — EXECUTION TYPES, BRANDED UNITS & LIFETIMES
 * Specifications: Blueprint Section 21, 22, 23
 *
 * Invariant: Slot and BlockHeight are branded types.
 * Comparing Slot and BlockHeight directly will cause a TypeScript compile error.
 */

export type Slot = bigint & { readonly __slot: unique symbol };
export type BlockHeight = bigint & { readonly __blockHeight: unique symbol };

export function asSlot(val: bigint | number): Slot {
  return BigInt(val) as Slot;
}

export function asBlockHeight(val: bigint | number): BlockHeight {
  return BigInt(val) as BlockHeight;
}

export interface RecentBlockhashLifetime {
  readonly kind: 'RECENT_BLOCKHASH';
  readonly blockhash: string;
  readonly lastValidBlockHeight: BlockHeight;
}

export interface DurableNonceLifetime {
  readonly kind: 'DURABLE_NONCE';
  readonly nonceAccount: string;
  readonly nonceValue: string;
  readonly nonceAuthority: string;
  readonly nonceStateRoot: string;
}

export type ExecutionLifetime = RecentBlockhashLifetime | DurableNonceLifetime;

export type ExecutionBuildState = 'PENDING' | 'BUILD_SUCCEEDED' | 'BUILD_FAILED';
export type ExecutionSigningState = 'UNSIGNED' | 'SIGNING_CLAIMED' | 'SIGNED' | 'SIGN_FAILED';
export type ExecutionSubmissionState = 'UNSUBMITTED' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'SUBMIT_FAILED';
export type ExecutionTerminalityState =
  | 'UNKNOWN'
  | 'LANDED_SUCCESS'
  | 'LANDED_FAILED'
  | 'CERTIFIED_NOLAND'
  | 'EXPIRED_UNRESOLVED'
  | 'DISPUTED';

export interface ExecutionGeneration {
  readonly generationId: string;
  readonly economicFactId: string;
  readonly economicIntentId: string;
  readonly generationNumber: number;
  readonly lifetime: ExecutionLifetime;
  readonly exactMessageHash: string;
  readonly transactionSignature?: string;
  readonly buildState: ExecutionBuildState;
  readonly signingState: ExecutionSigningState;
  readonly submissionState: ExecutionSubmissionState;
  readonly terminalityState: ExecutionTerminalityState;
  readonly createdAt: number;
  readonly supersededBy?: string;
}
