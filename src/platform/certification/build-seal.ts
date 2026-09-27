/**
 * SYLPH FUSION — BUILDSEAL: Immutable ReleaseRoot & Bytecode Attestation
 * Specifications: Sections 70 (BuildSeal), 71 (DependencyRoot), 103 (Invariant 15)
 *
 * Invariants:
 * 1. BUILD ONCE, TEST SAME BYTES, SCAN SAME BYTES, ATTEST SAME BYTES, RUN SAME BYTES.
 * 2. ReleaseRoot binds Git commit, tree hash, dependency root, Node version, compiled artifact hashes,
 *    SBOM, model manifest, protocol schema manifest, test evidence, and certification evidence.
 * 3. Runtime signs only if active ReleaseRoot is authorized and bytecode hashes match.
 */

import { createHash } from 'node:crypto';

export interface ReleaseRoot {
  readonly releaseRootId: string;
  readonly gitCommit: string;
  readonly treeHash: string;
  readonly dependencyRootHash: string;
  readonly nodeVersion: string;
  readonly typeScriptVersion: string;
  readonly compiledArtifactHashes: Readonly<Record<string, string>>;
  readonly sbomHash: string;
  readonly modelManifestHash: string;
  readonly protocolSchemaManifestHash: string;
  readonly testEvidenceHash: string;
  readonly certificationEvidenceHash: string;
  readonly builtAtMs: number;
  readonly isAuthorized: boolean;
  readonly releaseRootDigest: string;
}

export class BuildSealAuthority {
  private authorizedReleaseRoots = new Map<string, ReleaseRoot>();

  /**
   * Attests and registers a sealed ReleaseRoot.
   */
  public attestReleaseRoot(params: Omit<ReleaseRoot, 'releaseRootId' | 'releaseRootDigest'>): ReleaseRoot {
    const sortedArtifacts = Object.keys(params.compiledArtifactHashes)
      .sort()
      .map((k) => `${k}:${params.compiledArtifactHashes[k]}`)
      .join(';');

    const payload = `${params.gitCommit}:${params.treeHash}:${params.dependencyRootHash}:${params.nodeVersion}:${params.typeScriptVersion}:${sortedArtifacts}:${params.sbomHash}:${params.modelManifestHash}:${params.protocolSchemaManifestHash}:${params.testEvidenceHash}:${params.certificationEvidenceHash}:${params.isAuthorized}`;

    const releaseRootDigest = createHash('sha256').update(payload).digest('hex');
    const releaseRootId = `RELEASE-ROOT-${releaseRootDigest.slice(0, 16)}`;

    const releaseRoot: ReleaseRoot = {
      ...params,
      releaseRootId,
      releaseRootDigest
    };

    if (releaseRoot.isAuthorized) {
      this.authorizedReleaseRoots.set(releaseRootDigest, releaseRoot);
    }

    return releaseRoot;
  }

  /**
   * Authoritatively verifies whether a running system with observed bytecode
   * is authorized for live signing authority.
   */
  public verifyRuntimeSigningAuthority(params: {
    releaseRoot: ReleaseRoot;
    observedArtifactHashes: Record<string, string>;
    currentNodeVersion: string;
  }): { allowed: boolean; reason?: string } {
    // 1. Authorization check
    if (!params.releaseRoot.isAuthorized) {
      return {
        allowed: false,
        reason: `ReleaseRoot ${params.releaseRoot.releaseRootId} is NOT authorized for production live signing`
      };
    }

    // 2. Node version parity
    if (params.currentNodeVersion !== params.releaseRoot.nodeVersion) {
      return {
        allowed: false,
        reason: `Node runtime mismatch: compiled on ${params.releaseRoot.nodeVersion}, running on ${params.currentNodeVersion}`
      };
    }

    // 3. Exact bytecode match (same bytes invariant)
    for (const [file, expectedHash] of Object.entries(params.releaseRoot.compiledArtifactHashes)) {
      const observed = params.observedArtifactHashes[file];
      if (!observed) {
        return {
          allowed: false,
          reason: `Missing compiled artifact at runtime: ${file}`
        };
      }
      if (observed !== expectedHash) {
        return {
          allowed: false,
          reason: `Bytecode tampering detected on ${file}: expected ${expectedHash}, observed ${observed}`
        };
      }
    }

    return { allowed: true };
  }
}
