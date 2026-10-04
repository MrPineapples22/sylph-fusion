/**
 * SYLPH FUSION — CHAIN TRUTH & TEMPORAL ADAPTER
 * Specifications: Prompt 21, Prompt 22
 *
 * Integrates ChainTruthEngine and temporal evidence into FusionEnvelope:
 *   - Solana Bank-State Fingerprint binding slot, blockhash, bank identity, commitment, and provider.
 *   - Temporal Truth: distinguishes occurredAt, observedAt, knownAt, decisionAt.
 *   - Temporal Invariant: knownAt <= decisionAt (strict point-in-time firewall).
 */
import { hashCanonical } from '../canonical-hashing.js';
/**
 * Computes deterministic Solana bank-state fingerprint.
 * Prevents observations at the same nominal slot under different bank/fork realities
 * from being silently treated as identical.
 */
export function computeBankFingerprint(params) {
    return hashCanonical({
        slot: typeof params.slot === 'bigint' ? `${params.slot}n` : params.slot,
        bankHashOrBlockhash: params.bankHashOrBlockhash ?? '0000000000000000000000000000000000000000000000000000000000000000',
        commitment: params.commitment,
        providerEndpoint: params.providerEndpoint ?? 'default-provider',
        cluster: params.cluster ?? 'mainnet-beta',
        accountStateRoots: params.accountStateRoots ?? [],
    });
}
/**
 * Validates temporal firewall: knownAt <= decisionAt.
 * Throws TemporalLeakageError if future data leaked into decision.
 */
export function assertTemporalFirewall(knownAtIso, decisionAtIso) {
    const knownAt = new Date(knownAtIso).getTime();
    const decisionAt = new Date(decisionAtIso).getTime();
    if (Number.isNaN(knownAt) || Number.isNaN(decisionAt)) {
        throw new Error('TEMPORAL_ERROR: Invalid ISO timestamp provided to temporal firewall');
    }
    if (knownAt > decisionAt) {
        throw new Error(`TEMPORAL_LEAKAGE_DETECTED: Data known at ${knownAtIso} exceeds decision time ${decisionAtIso}`);
    }
}
/**
 * Creates transition request for advancing to TEMPORALLY_VALID.
 */
export function createTemporallyValidTransitionRequest(slot, bankFingerprint, blockhash, lastValidBlockHeight) {
    return {
        targetState: 'TEMPORALLY_VALID',
        authority: 'OBSERVE',
        envelopePatch: {
            observedSlot: slot,
            bankFingerprint,
            blockhash,
            lastValidBlockHeight,
        },
        observedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=chain-truth-adapter.js.map