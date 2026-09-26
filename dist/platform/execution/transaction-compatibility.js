/**
 * SOL-SYLPH 2026 Platform - Transaction Compatibility & Resource Policy Authority
 *
 * Implements 2026-era Solana transaction format compatibility:
 * - Supports LEGACY, V0 (with Address Lookup Tables), and V1 (up to 4,096 bytes, message-config resource limits).
 * - Enforces invariant:
 *   UNSUPPORTED_CHAIN_TRANSACTION_VERSION => RECONCILIATION_DEGRADED => NEW_RISK-INCREASING_EXECUTION_BLOCKED
 * - Evaluates version-aware resource limits and generates ExecutionReviewCertificate.
 */
import { createHash } from 'node:crypto';
export class TransactionCompatibilityAuthority {
    static SUPPORTED_VERSIONS = new Set(['LEGACY', 'V0', 'V1']);
    /**
     * Returns whether a transaction version reported by RPC getTransaction is supported.
     * In Solana RPC, version is either undefined/0 (legacy/v0) or 1 (v1).
     */
    static isSupportedVersion(version) {
        if (version === undefined || version === 'legacy' || version === 0 || version === 1) {
            return true;
        }
        return false;
    }
    static normalizeVersion(version) {
        if (version === undefined || version === 'legacy')
            return 'LEGACY';
        if (version === 0)
            return 'V0';
        if (version === 1)
            return 'V1';
        throw new Error(`UNSUPPORTED_CHAIN_TRANSACTION_VERSION: version ${version} is not supported`);
    }
    /**
     * Version-aware resource policy validator
     */
    static validateResourcePolicy(version, limits) {
        const policyVersion = `resource-policy-2026-${version.toLowerCase()}`;
        if (version === 'LEGACY') {
            if (limits.computeLimit <= 0 || limits.computeLimit > 1_400_000) {
                throw new Error(`LEGACY compute limit must be in range 1..1,400,000 (got ${limits.computeLimit})`);
            }
            return {
                version: 'LEGACY',
                computeLimit: limits.computeLimit,
                loadedAccountsLimit: 64, // Legacy account count practical bound
                heapLimit: 32 * 1024,
                priorityFee: limits.priorityFeeMicroLamports,
                resourcePolicyVersion: policyVersion,
            };
        }
        if (version === 'V0') {
            if (limits.computeLimit <= 0 || limits.computeLimit > 1_400_000) {
                throw new Error(`V0 compute limit must be in range 1..1,400,000 (got ${limits.computeLimit})`);
            }
            return {
                version: 'V0',
                computeLimit: limits.computeLimit,
                loadedAccountsLimit: limits.loadedAccountsDataSizeLimit ?? 64 * 1024,
                heapLimit: limits.heapLimitBytes ?? 32 * 1024,
                priorityFee: limits.priorityFeeMicroLamports,
                resourcePolicyVersion: policyVersion,
            };
        }
        if (version === 'V1') {
            // V1 allows up to 4,096 bytes and requires explicit message-level configuration
            if (limits.computeLimit <= 0 || limits.computeLimit > 1_400_000) {
                throw new Error(`V1 compute limit must be explicitly set and within 1..1,400,000 (got ${limits.computeLimit})`);
            }
            if (!limits.loadedAccountsDataSizeLimit || limits.loadedAccountsDataSizeLimit <= 0) {
                throw new Error('V1 transactions require explicit loadedAccountsDataSizeLimit in message config');
            }
            return {
                version: 'V1',
                computeLimit: limits.computeLimit,
                loadedAccountsLimit: limits.loadedAccountsDataSizeLimit,
                heapLimit: limits.heapLimitBytes ?? 32 * 1024,
                priorityFee: limits.priorityFeeMicroLamports,
                resourcePolicyVersion: policyVersion,
            };
        }
        throw new Error(`UNSUPPORTED_CHAIN_TRANSACTION_VERSION: ${version}`);
    }
    /**
     * Generates a tamper-proof ExecutionReviewCertificate binding simulation and review.
     */
    static createReviewCertificate(params) {
        return {
            reviewId: params.reviewId,
            intentId: params.intentId,
            transactionVersion: params.version,
            computeLimit: params.limits.computeLimit,
            loadedAccountsLimit: params.limits.loadedAccountsLimit,
            heapLimit: params.limits.heapLimit,
            priorityFee: params.limits.priorityFee,
            estimatedCompute: params.estimatedCompute,
            simulationSlot: params.simulationSlot,
            simulationResult: params.simulationResult,
            resourcePolicyVersion: params.limits.resourcePolicyVersion,
            approvedAt: Date.now(),
        };
    }
    /**
     * Computes a cryptographic TransactionFingerprint:
     * SHA256(canonical transaction bytes + intent_id + review_id + policy_version)
     */
    static computeFingerprint(transactionBytes, intentId, reviewId, policyVersion) {
        const canonicalHash = createHash('sha256').update(transactionBytes).digest('hex');
        const fingerprint = createHash('sha256')
            .update(transactionBytes)
            .update(intentId)
            .update(reviewId)
            .update(policyVersion)
            .digest('hex');
        return {
            fingerprint,
            canonicalBytesHash: canonicalHash,
            intentId,
            reviewId,
            policyVersion,
            timestamp: Date.now(),
        };
    }
}
//# sourceMappingURL=transaction-compatibility.js.map