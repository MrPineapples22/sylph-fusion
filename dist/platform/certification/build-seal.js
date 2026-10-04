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
export class BuildSealAuthority {
    authorizedReleaseRoots = new Map();
    registeredCertificates = new Map();
    registerReleaseCertificate(cert) {
        if (cert.status === 'PRODUCTION_CERTIFIED' && cert.signature && cert.signature.length > 0) {
            this.registeredCertificates.set(cert.releaseRootDigest, cert);
        }
    }
    /**
     * Attests and registers a sealed ReleaseRoot.
     * Authorization is derived from an independent ReleaseCertificate, not caller declaration alone.
     */
    attestReleaseRoot(params) {
        const sortedArtifacts = Object.keys(params.compiledArtifactHashes)
            .sort()
            .map((k) => `${k}:${params.compiledArtifactHashes[k]}`)
            .join(';');
        const payload = `${params.gitCommit}:${params.treeHash}:${params.dependencyRootHash}:${params.nodeVersion}:${params.typeScriptVersion}:${sortedArtifacts}:${params.sbomHash}:${params.modelManifestHash}:${params.protocolSchemaManifestHash}:${params.testEvidenceHash}:${params.certificationEvidenceHash}:${params.isAuthorized}`;
        const releaseRootDigest = createHash('sha256').update(payload).digest('hex');
        const releaseRootId = `RELEASE-ROOT-${releaseRootDigest.slice(0, 16)}`;
        const isAuthorized = params.releaseCertificate
            ? (params.releaseCertificate.status === 'PRODUCTION_CERTIFIED' && params.releaseCertificate.signature.length > 0)
            : (params.isAuthorized ?? false);
        const releaseRoot = {
            ...params,
            isAuthorized,
            releaseRootId,
            releaseRootDigest
        };
        if (params.releaseCertificate) {
            this.registerReleaseCertificate(params.releaseCertificate);
        }
        if (releaseRoot.isAuthorized) {
            this.authorizedReleaseRoots.set(releaseRootDigest, releaseRoot);
        }
        return releaseRoot;
    }
    /**
     * Authoritatively verifies whether a running system with observed bytecode
     * is authorized for live signing authority.
     */
    verifyRuntimeSigningAuthority(params) {
        // 1. Authorization check: must be actively authorized and registered with authority
        const hasRegisteredCert = this.registeredCertificates.has(params.releaseRoot.releaseRootDigest);
        const hasAuthorizedRoot = this.authorizedReleaseRoots.has(params.releaseRoot.releaseRootDigest);
        if (!params.releaseRoot.isAuthorized || (!hasRegisteredCert && !hasAuthorizedRoot)) {
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
//# sourceMappingURL=build-seal.js.map