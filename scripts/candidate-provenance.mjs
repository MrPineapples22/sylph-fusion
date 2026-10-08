import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const CANDIDATE_REPOSITORY = 'MrPineapples22/sylph-fusion';
export const CANDIDATE_WORKFLOW = '.github/workflows/candidate-provenance.yml';
export const CANDIDATE_REF = 'refs/heads/main';
const sha1 = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;

export function hashArtifact(file) {
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error('CANDIDATE_ARTIFACT_NOT_FILE');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

// These are comparison inputs from an independently reviewed revision, never
// defaults read from the candidate. They are policy, not trust by themselves.
export function validateExpectedSource(expected) {
  if (!expected || !sha1.test(expected.sourceCommitSha) || !sha1.test(expected.sourceTreeSha)) {
    throw new Error('CANDIDATE_EXPECTED_SOURCE_REQUIRED');
  }
  return {sourceCommitSha: expected.sourceCommitSha, sourceTreeSha: expected.sourceTreeSha};
}

export function candidateVerificationArgs(file, bundle, expected) {
  const source = validateExpectedSource(expected);
  return ['attestation', 'verify', path.resolve(file), '--bundle', path.resolve(bundle),
    '--repo', CANDIDATE_REPOSITORY, '--hostname', 'github.com',
    '--signer-workflow', `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}`,
    '--signer-digest', source.sourceCommitSha,
    '--source-digest', source.sourceCommitSha, '--source-ref', CANDIDATE_REF,
    '--cert-identity', `https://github.com/${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@${CANDIDATE_REF}`,
    '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '--predicate-type', 'https://slsa.dev/provenance/v1', '--deny-self-hosted-runners', '--format', 'json'];
}

// Pure structural check. Calling this function does NOT verify a signature.
export function validateCandidateIdentity(identity, archiveSha256, expected) {
  const source = validateExpectedSource(expected);
  const keys = ['schemaVersion', 'repository', 'workflow', 'sourceRef', 'sourceCommitSha', 'sourceTreeSha',
    'artifactName', 'artifactSha256', 'releaseStatus', 'runtimeAuthority'];
  if (!identity || typeof identity !== 'object' || Array.isArray(identity) ||
      Object.keys(identity).sort().join(',') !== keys.sort().join(',') ||
      identity.schemaVersion !== 'sylph.candidate.identity.v1' ||
      identity.repository !== CANDIDATE_REPOSITORY || identity.workflow !== CANDIDATE_WORKFLOW ||
      identity.sourceRef !== CANDIDATE_REF || identity.sourceCommitSha !== source.sourceCommitSha ||
      identity.sourceTreeSha !== source.sourceTreeSha ||
      identity.artifactName !== 'sylph-windows-candidate.tar.gz' ||
      !sha256.test(archiveSha256) || identity.artifactSha256 !== archiveSha256 ||
      identity.releaseStatus !== 'UNVERIFIED_CANDIDATE' || identity.runtimeAuthority !== false) {
    throw new Error('CANDIDATE_IDENTITY_MISMATCH');
  }
  return Object.freeze({...identity});
}

function verifyWithGitHub(file, bundle, expected, digest) {
  // No shell, caller-supplied JSON, injected verifier, or success boolean. gh is
  // part of the trusted local verifier installation; failures/timeouts deny.
  const output = execFileSync('gh', candidateVerificationArgs(file, bundle, expected), {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, GH_HOST: 'github.com'},
  });
  const results = JSON.parse(output);
  if (!Array.isArray(results) || results.length === 0 || !results.some(result => {
    const statement = result?.verificationResult?.statement;
    return statement?._type === 'https://in-toto.io/Statement/v1' &&
      statement.predicateType === 'https://slsa.dev/provenance/v1' &&
      Array.isArray(statement.subject) && statement.subject.some(subject => subject?.digest?.sha256 === digest);
  })) throw new Error('CANDIDATE_VERIFIED_SUBJECT_MISSING');
  return createHash('sha256').update(output).digest('hex');
}

export function verifyCandidateProvenance({archive, identityFile, bundle, expected}) {
  const source = validateExpectedSource(expected);
  for (const file of [archive, identityFile, bundle]) {
    if (typeof file !== 'string' || !fs.lstatSync(file).isFile()) throw new Error('CANDIDATE_INPUT_NOT_FILE');
  }
  if (fs.statSync(identityFile).size > 64 * 1024) throw new Error('CANDIDATE_IDENTITY_TOO_LARGE');
  const archiveDigest = hashArtifact(archive), identityDigest = hashArtifact(identityFile), bundleDigest = hashArtifact(bundle);
  const identity = validateCandidateIdentity(JSON.parse(fs.readFileSync(identityFile, 'utf8')), archiveDigest, source);
  const archiveVerificationSha256 = verifyWithGitHub(archive, bundle, source, archiveDigest);
  const identityVerificationSha256 = verifyWithGitHub(identityFile, bundle, source, identityDigest);
  if (hashArtifact(archive) !== archiveDigest || hashArtifact(identityFile) !== identityDigest || hashArtifact(bundle) !== bundleDigest) {
    throw new Error('CANDIDATE_INPUT_CHANGED_DURING_VERIFICATION');
  }
  // Informational receipt only: consumers must rerun verification on the files.
  // This is deliberately not a BuildSeal, C5 artifact, or runtime capability.
  return {schemaVersion: 'sylph.candidate.provenance-receipt.v1',
    status: 'VERIFIED_CANDIDATE_PROVENANCE', identity, archiveVerificationSha256,
    identityVerificationSha256, bundleSha256: bundleDigest, runtimeAuthority: false,
    certificationGranted: false, extractedRuntimeVerified: false};
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [archive, identityFile, bundle, sourceCommitSha, sourceTreeSha, ...extra] = process.argv.slice(2);
    if (extra.length || !archive || !identityFile || !bundle) throw new Error('Usage: node scripts/candidate-provenance.mjs ARCHIVE IDENTITY BUNDLE EXPECTED_COMMIT EXPECTED_TREE');
    console.log(JSON.stringify(verifyCandidateProvenance({archive, identityFile, bundle, expected: {sourceCommitSha, sourceTreeSha}}), null, 2));
  } catch (error) {
    // Avoid printing subprocess stderr, which may include credential diagnostics.
    console.error(`Candidate provenance verification failed: ${error.code ?? error.message}`);
    process.exitCode = 1;
  }
}
