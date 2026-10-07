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

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export interface ReleaseCertificate {
  readonly certificateId: string;
  readonly releaseRootDigest: string;
  readonly status: 'PRODUCTION_CERTIFIED' | 'UNVERIFIED_CANDIDATE' | 'RELEASE_REJECTED';
  readonly issuer: string;
  readonly issuedAtMs: number;
  readonly signature: string;
}

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
  readonly releaseCertificate?: ReleaseCertificate;
}

export class BuildSealAuthority {
  private readonly candidateReleaseRoots = new Map<string, ReleaseRoot>();

  /**
   * A status string and non-empty signature are not certificate verification.
   * This build has no provisioned release trust root or verifier, so it cannot
   * register a certificate as signing authority.
   */
  public registerReleaseCertificate(_cert: ReleaseCertificate): false {
    return false;
  }

  /**
   * Computes and registers an immutable candidate root. This class has no
   * trusted release verifier, so a candidate can never authorize live signing.
   */
  public attestReleaseRoot(params: Omit<ReleaseRoot, 'releaseRootId' | 'releaseRootDigest'>): ReleaseRoot {
    const payload = {
      schema: 'SYLPH_BUILDSEAL_ROOT_V1',
      gitCommit: params.gitCommit,
      treeHash: params.treeHash,
      dependencyRootHash: params.dependencyRootHash,
      nodeVersion: params.nodeVersion,
      typeScriptVersion: params.typeScriptVersion,
      compiledArtifactHashes: params.compiledArtifactHashes,
      sbomHash: params.sbomHash,
      modelManifestHash: params.modelManifestHash,
      protocolSchemaManifestHash: params.protocolSchemaManifestHash,
      testEvidenceHash: params.testEvidenceHash,
      certificationEvidenceHash: params.certificationEvidenceHash,
      builtAtMs: params.builtAtMs,
    };
    const releaseRootDigest = hashCanonical(payload);
    const releaseRootId = `RELEASE-ROOT-${releaseRootDigest.slice(0, 16)}`;

    const releaseRoot: ReleaseRoot = {
      ...params,
      compiledArtifactHashes: Object.freeze({ ...params.compiledArtifactHashes }),
      releaseCertificate: params.releaseCertificate
        ? Object.freeze({ ...params.releaseCertificate })
        : undefined,
      isAuthorized: false,
      releaseRootId,
      releaseRootDigest
    };

    this.candidateReleaseRoots.set(releaseRootDigest, Object.freeze(releaseRoot));

    return this.candidateReleaseRoots.get(releaseRootDigest)!;
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
    // Caller-provided isAuthorized/certificate fields are descriptive data,
    // not trusted verifier output. No release trust root is configured here.
    const registeredCandidate = this.candidateReleaseRoots.get(params.releaseRoot.releaseRootDigest);
    if (!registeredCandidate || registeredCandidate !== params.releaseRoot || params.releaseRoot.isAuthorized !== false) {
      return {
        allowed: false,
        reason: `ReleaseRoot ${params.releaseRoot.releaseRootId} is not an unchanged candidate registered by this authority`
      };
    }

    // Preserve useful runtime diagnostics even though this class cannot grant
    // authorization without an independently configured verifier.
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

    return {
      allowed: false,
      reason: 'No trusted release-certificate verifier or provisioned release trust root is configured'
    };
  }
}
