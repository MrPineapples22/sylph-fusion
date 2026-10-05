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

export interface ReleaseComponents {
  readonly gitCommitSha: string;
  readonly packageLockHash: string;
  readonly cargoLockHash: string;
  readonly typeScriptVersion: string;
  readonly rustToolchainVersion: string;
  readonly configSchemaRoot: string;
  readonly policyRoot: string;
  readonly canonicalEncodingVersion: string;
  readonly formalSpecEvidenceRoot: string;
  readonly testVerificationEvidenceRoot: string;
}

export interface ReleaseRoot {
  readonly components: ReleaseComponents;
  readonly releaseRootHash: string;
  readonly computedAt: number;
}

export class ReleaseRootManager {
  public static computeReleaseRoot(components: ReleaseComponents): ReleaseRoot {
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

  public static verifyReleaseRoot(root: ReleaseRoot): boolean {
    const recomputed = ReleaseRootManager.computeReleaseRoot(root.components);
    return recomputed.releaseRootHash === root.releaseRootHash;
  }
}
