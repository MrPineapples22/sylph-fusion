/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: POLICY ARTIFACTS & PROMOTION
 * Specifications: Master Blueprint Section XXIII (Execution Policy Promotion)
 *
 * Invariant: Production policy artifacts are immutable.
 * The learner cannot modify active policy directly.
 * Tiers: CHAMPION, CHALLENGER, PROBE.
 */

import { createHash } from 'node:crypto';

export type PolicyTier = 'CHAMPION' | 'CHALLENGER' | 'PROBE';

export interface ExecutionPolicyArtifact {
  readonly policyId: string;
  readonly tier: PolicyTier;
  readonly version: string;
  readonly basePriorityFeeMicroLamports: bigint;
  readonly baseJitoTipLamports: bigint;
  readonly maxSlippageBps: number;
  readonly targetCuBufferFraction: number;
  readonly preferredTransport: 'DIRECT_RPC' | 'DIRECT_TPU' | 'JITO_SINGLE_TX_BUNDLE';
  readonly policyHash: string;
  readonly approvedAtMs: number;
}

export function createPolicyArtifact(params: Omit<ExecutionPolicyArtifact, 'policyId' | 'policyHash' | 'approvedAtMs'>): ExecutionPolicyArtifact {
  const approvedAtMs = Date.now();
  const serialized = JSON.stringify({
    tier: params.tier,
    version: params.version,
    priority: params.basePriorityFeeMicroLamports.toString(),
    tip: params.baseJitoTipLamports.toString(),
    slippage: params.maxSlippageBps,
    cu: params.targetCuBufferFraction,
    transport: params.preferredTransport,
    approvedAtMs,
  });

  const policyHash = createHash('sha256').update(serialized).digest('hex');
  const policyId = `pol_${params.tier.toLowerCase()}_${policyHash.slice(0, 16)}`;

  return {
    ...params,
    policyId,
    policyHash,
    approvedAtMs,
  };
}
