/**
 * SYLPH FUSION — EXECUTION ADAPTATION-X: POLICY ARTIFACTS & PROMOTION
 * Specifications: Master Blueprint Section XXIII (Execution Policy Promotion)
 *
 * Invariant: Production policy artifacts are immutable.
 * The learner cannot modify active policy directly.
 * Tiers: CHAMPION, CHALLENGER, PROBE.
 */
import { createHash } from 'node:crypto';
export function createPolicyArtifact(params) {
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
//# sourceMappingURL=policy-artifact.js.map