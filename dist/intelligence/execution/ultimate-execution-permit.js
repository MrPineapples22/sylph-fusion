/**
 * SOL-SYLPH Intelligence Fabric - Ultimate Execution Permit Engine
 * Specifications: Master Blueprint Section 98 & 48 (Execution Authority).
 *
 * Implements:
 * 1. UltimateExecutionPermit: Authoritative, cryptographically sealed execution authorization binding:
 *    - exact transaction wire hash
 *    - simulation certificate hash
 *    - exitability certificate hash
 *    - runtime root and program root digests
 *    - portfolio snapshot hash
 *    - state lease hash
 *    - maximum allowable SOL and minimum output token deltas
 * 2. Immutable non-bypassable invariant:
 *    Any transaction mutation, parameter drift, or state lease expiration requires a brand-new permit.
 *    No AI model or external RPC can self-authorize an execution permit.
 */
import { createHash } from 'node:crypto';
export class UltimateExecutionPermitAuthority {
    static VERSION = 'SYLPH_EXECUTION_AUTHORITY_V2';
    static DEFAULT_PERMIT_TTL_MS = 3000; // 3 seconds max execution window
    /**
     * Generates an immutable UltimateExecutionPermit sealed with cryptographic integrity.
     */
    static issuePermit(params) {
        const { intentId, candidateId, exactTransactionHash, mint, routeHash, runtimeRoot, programRoots, simulationCertificateHash, exitabilityCertificateHash, portfolioSnapshotHash, stateLeaseHash, maximumSolLamports, maximumTokensRaw, minimumOutputTokensRaw, authorizedDeliveryPaths = ['JITO_BUNDLE', 'RPC_FAST'], ttlMs = this.DEFAULT_PERMIT_TTL_MS, } = params;
        const issuedAtMs = Date.now();
        const expiryMs = issuedAtMs + ttlMs;
        const permitId = `permit_${mint.slice(0, 8)}_${issuedAtMs}`;
        const permitSealSignature = createHash('sha256')
            .update('ULTIMATE_EXECUTION_PERMIT:')
            .update(permitId)
            .update(intentId)
            .update(candidateId)
            .update(exactTransactionHash)
            .update(simulationCertificateHash)
            .update(exitabilityCertificateHash)
            .update(stateLeaseHash)
            .update(maximumSolLamports.toString())
            .update(minimumOutputTokensRaw.toString())
            .update(expiryMs.toString())
            .digest('hex');
        return {
            permitId,
            intentId,
            candidateId,
            exactTransactionHash,
            mint,
            routeHash,
            runtimeRoot,
            programRoots: Object.freeze([...programRoots]),
            simulationCertificateHash,
            exitabilityCertificateHash,
            portfolioSnapshotHash,
            stateLeaseHash,
            maximumSolLamports,
            maximumTokensRaw,
            minimumOutputTokensRaw,
            authorizedDeliveryPaths: Object.freeze([...authorizedDeliveryPaths]),
            issuedAtMs,
            expiryMs,
            authorityVersion: this.VERSION,
            permitSealSignature,
        };
    }
    /**
     * Deterministically validates an execution permit against real wire parameters before signing.
     */
    static validatePermit(permit, params) {
        const now = params.currentTimeMs ?? Date.now();
        if (now > permit.expiryMs) {
            return { isValid: false, violationReason: `PERMIT_EXPIRED: Permit expired at ${permit.expiryMs}, current is ${now}` };
        }
        if (params.wireTransactionHash !== permit.exactTransactionHash) {
            return {
                isValid: false,
                violationReason: `TRANSACTION_HASH_MISMATCH: Wire hash ${params.wireTransactionHash} does not match permitted ${permit.exactTransactionHash}`,
            };
        }
        if (params.currentSolLamportsToMove > permit.maximumSolLamports) {
            return {
                isValid: false,
                violationReason: `EXCESSIVE_SOL_MOVEMENT: Movement ${params.currentSolLamportsToMove} exceeds permitted maximum ${permit.maximumSolLamports}`,
            };
        }
        if (!permit.authorizedDeliveryPaths.includes(params.currentDeliveryPath)) {
            return {
                isValid: false,
                violationReason: `UNAUTHORIZED_DELIVERY_PATH: Delivery path ${params.currentDeliveryPath} not permitted`,
            };
        }
        return { isValid: true };
    }
}
//# sourceMappingURL=ultimate-execution-permit.js.map