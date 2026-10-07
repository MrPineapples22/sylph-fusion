import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildSealAuthority
} from '../../dist/platform/certification/build-seal.js';

function candidateParams(overrides = {}) {
  return {
    gitCommit: 'abcdef1234567890',
    treeHash: '1'.repeat(64),
    dependencyRootHash: '2'.repeat(64),
    nodeVersion: 'v24.21.0',
    typeScriptVersion: '5.9.3',
    compiledArtifactHashes: {
      'dist/fusion.js': '3'.repeat(64),
      'dist/execution.js': '4'.repeat(64),
      'dist/platform/signing/durable-live-signer.js': '5'.repeat(64)
    },
    sbomHash: '6'.repeat(64),
    modelManifestHash: '7'.repeat(64),
    protocolSchemaManifestHash: '8'.repeat(64),
    testEvidenceHash: '9'.repeat(64),
    certificationEvidenceHash: 'a'.repeat(64),
    builtAtMs: 1_791_300_000_000,
    isAuthorized: true,
    ...overrides,
  };
}

describe('BUILDSEAL: candidate identity and fail-closed release trust boundary', () => {
  it('keeps a caller-asserted authorized candidate blocked even when runtime bytes match', () => {
    const authority = new BuildSealAuthority();
    const params = candidateParams();
    const releaseRoot = authority.attestReleaseRoot(params);

    assert.match(releaseRoot.releaseRootId, /^RELEASE-ROOT-[a-f0-9]{16}$/);
    assert.equal(releaseRoot.isAuthorized, false);

    const result = authority.verifyRuntimeSigningAuthority({
      releaseRoot,
      observedArtifactHashes: { ...params.compiledArtifactHashes },
      currentNodeVersion: params.nodeVersion,
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /No trusted release-certificate verifier or provisioned release trust root/);
  });

  it('does not treat a nonempty signature string as a verified release certificate', () => {
    const authority = new BuildSealAuthority();
    const params = candidateParams({
      releaseCertificate: {
        certificateId: 'self-issued',
        releaseRootDigest: 'f'.repeat(64),
        status: 'PRODUCTION_CERTIFIED',
        issuer: 'caller-controlled',
        issuedAtMs: Date.now(),
        signature: 'not-a-signature',
      },
    });
    const releaseRoot = authority.attestReleaseRoot(params);

    assert.equal(authority.registerReleaseCertificate(params.releaseCertificate), false);
    assert.equal(releaseRoot.isAuthorized, false);
    assert.equal(authority.verifyRuntimeSigningAuthority({
      releaseRoot,
      observedArtifactHashes: { ...params.compiledArtifactHashes },
      currentNodeVersion: params.nodeVersion,
    }).allowed, false);
  });

  it('binds build identity independently of the caller authorization claim and snapshots artifacts', () => {
    const authorizedAuthority = new BuildSealAuthority();
    const untrustedAuthority = new BuildSealAuthority();
    const params = candidateParams();
    const authorizedClaim = authorizedAuthority.attestReleaseRoot(params);
    const untrustedClaim = untrustedAuthority.attestReleaseRoot(candidateParams({ isAuthorized: false }));

    assert.equal(authorizedClaim.releaseRootDigest, untrustedClaim.releaseRootDigest);
    params.compiledArtifactHashes['dist/fusion.js'] = 'b'.repeat(64);
    assert.equal(authorizedClaim.compiledArtifactHashes['dist/fusion.js'], '3'.repeat(64));
    assert.equal(authorizedClaim.isAuthorized, false);
  });

  it('retains bytecode mismatch diagnostics while refusing authority', () => {
    const authority = new BuildSealAuthority();
    const params = candidateParams();
    const releaseRoot = authority.attestReleaseRoot(params);

    const result = authority.verifyRuntimeSigningAuthority({
      releaseRoot,
      observedArtifactHashes: {
        ...params.compiledArtifactHashes,
        'dist/execution.js': 'tampered',
      },
      currentNodeVersion: params.nodeVersion,
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /Bytecode tampering detected/);
  });

  it('rejects copied or modified root objects rather than trusting digest lookup alone', () => {
    const authority = new BuildSealAuthority();
    const params = candidateParams();
    const releaseRoot = authority.attestReleaseRoot(params);
    const copiedRoot = { ...releaseRoot, isAuthorized: true };

    const result = authority.verifyRuntimeSigningAuthority({
      releaseRoot: copiedRoot,
      observedArtifactHashes: { ...params.compiledArtifactHashes },
      currentNodeVersion: params.nodeVersion,
    });
    assert.equal(result.allowed, false);
    assert.match(result.reason, /unchanged candidate registered by this authority/);
  });
});
