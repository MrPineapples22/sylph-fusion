import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildSealAuthority
} from '../../dist/platform/certification/build-seal.js';

describe('BUILDSEAL: Immutable ReleaseRoot & Bytecode Attestation (Sections 70, 71)', () => {
  it('permits runtime signing only when exact bytecode matches and release is authorized', () => {
    const authority = new BuildSealAuthority();

    const artifactHashes = {
      'dist/fusion.js': 'hash_fusion_123',
      'dist/execution.js': 'hash_execution_456',
      'dist/platform/signing/durable-live-signer.js': 'hash_signer_789'
    };

    const releaseRoot = authority.attestReleaseRoot({
      gitCommit: 'git_commit_abcdef123456',
      treeHash: 'tree_hash_987654321',
      dependencyRootHash: 'dep_lock_hash_111',
      nodeVersion: 'v24.21.0',
      typeScriptVersion: '5.9.3',
      compiledArtifactHashes: artifactHashes,
      sbomHash: 'sbom_hash_333',
      modelManifestHash: 'models_hash_444',
      protocolSchemaManifestHash: 'schemas_hash_555',
      testEvidenceHash: 'test_evidence_666',
      certificationEvidenceHash: 'cert_evidence_777',
      builtAtMs: Date.now(),
      isAuthorized: true
    });

    assert.ok(releaseRoot.releaseRootId.startsWith('RELEASE-ROOT-'));

    // 1. Exact match -> ALLOWED
    const validCheck = authority.verifyRuntimeSigningAuthority({
      releaseRoot,
      observedArtifactHashes: { ...artifactHashes },
      currentNodeVersion: 'v24.21.0'
    });
    assert.equal(validCheck.allowed, true);

    // 2. Modified bytecode -> BLOCKED (Bytecode tampering)
    const tamperedCheck = authority.verifyRuntimeSigningAuthority({
      releaseRoot,
      observedArtifactHashes: {
        ...artifactHashes,
        'dist/execution.js': 'tampered_malicious_code_hash'
      },
      currentNodeVersion: 'v24.21.0'
    });
    assert.equal(tamperedCheck.allowed, false);
    assert.ok(tamperedCheck.reason?.includes('Bytecode tampering detected'));

    // 3. Unauthorized release candidate -> BLOCKED
    const unauthRoot = { ...releaseRoot, isAuthorized: false };
    const unauthCheck = authority.verifyRuntimeSigningAuthority({
      releaseRoot: unauthRoot,
      observedArtifactHashes: { ...artifactHashes },
      currentNodeVersion: 'v24.21.0'
    });
    assert.equal(unauthCheck.allowed, false);
    assert.ok(unauthCheck.reason?.includes('NOT authorized'));
  });
});
