/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: ACTION VECTOR
 * Specifications: Master Blueprint Section XXI (Execution Action Vector)
 *
 * Invariant: Action represents transport, route, transaction structure, fees, tips, and expiry.
 */

export type ExecutionTransportType =
  | 'DIRECT_RPC'
  | 'DIRECT_TPU'
  | 'JITO_SEND_TRANSACTION'
  | 'JITO_SINGLE_TX_BUNDLE'
  | 'JITO_MULTI_TX_BUNDLE';

export interface ExecutionActionVector {
  readonly transport: ExecutionTransportType;
  readonly route: string;
  readonly txVersion: 'legacy' | 'v0';
  readonly targetSlot: bigint;
  readonly region: string;
  readonly cuLimit: number;
  readonly priorityFeeMicroLamports: bigint;
  readonly jitoTipLamports: bigint;
  readonly slippageBps: number;
  readonly expirySlots: number;
  readonly retryPolicy: {
    readonly maxRetries: number;
    readonly retryIntervalMs: number;
  };
}
