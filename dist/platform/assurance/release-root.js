/**
 * SYLPH FUSION — DETERMINISTIC RELEASE ROOT COMPUTATION
 * Specifications: Blueprint Section 57
 *
 * Invariant:
 * The ReleaseRoot cryptographically binds:
 * 1. Git commit SHA
 * 2. package-lock.json hash
 * 3. Cargo.lock hash
 * 4. TypeScript compiler version
 * 5. Rust toolchain version
 * 6. Config schema root
 * 7. Policy root
 * 8. Canonical encoding version (V1)
 * 9. Authority-kernel specification evidence root
 * 10. Test verification evidence root
 *
 * Every production-capable permit must bind this release root.
 */
import { createHash } from 'node:crypto';
export class ReleaseRootManager {
    static computeReleaseRoot(components) {
        const canonicalPayload = [
            components.gitCommitSha,
            components.packageLockHash,
            components.cargoLockHash,
            components.typeScriptVersion,
            components.rustToolchainVersion,
            components.configSchemaRoot,
            components.policyRoot,
            components.canonicalEncodingVersion,
            components.formalSpecEvidenceRoot,
            components.testVerificationEvidenceRoot,
        ].join('::');
        const releaseRootHash = createHash('sha256').update(canonicalPayload).digest('hex');
        return {
            components,
            releaseRootHash,
            computedAt: Date.now(),
        };
    }
    static verifyReleaseRoot(root) {
        const recomputed = ReleaseRootManager.computeReleaseRoot(root.components);
        return recomputed.releaseRootHash === root.releaseRootHash;
    }
}
//# sourceMappingURL=release-root.js.map