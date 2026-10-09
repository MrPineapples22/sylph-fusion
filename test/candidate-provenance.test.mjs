import {test, mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {candidateVerificationArgs, validateCandidateIdentity, verifyCandidateProvenance,
  hashArtifact, CANDIDATE_REPOSITORY, CANDIDATE_WORKFLOW, CANDIDATE_REF} from '../scripts/candidate-provenance.mjs';
import {prepareCiCandidate} from '../scripts/prepare-ci-candidate.mjs';
import {verifyExtractedCandidate} from '../scripts/candidate-extracted-integrity.mjs';

const expected = {sourceCommitSha: 'a'.repeat(40), sourceTreeSha: 'b'.repeat(40)};
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-provenance-'));
  const archive = path.join(root, 'sylph-windows-candidate.tar.gz');
  const identityFile = path.join(root, 'candidate-identity.json'), bundle = path.join(root, 'bundle.json');
  fs.writeFileSync(archive, 'fixture archive bytes; this is not a real signed artifact');
  fs.writeFileSync(bundle, 'fixture bundle; no cryptographic verification claim');
  const identity = {schemaVersion: 'sylph.candidate.identity.v1', repository: CANDIDATE_REPOSITORY,
    workflow: CANDIDATE_WORKFLOW, sourceRef: CANDIDATE_REF, ...expected,
    artifactName: 'sylph-windows-candidate.tar.gz', artifactSha256: hashArtifact(archive),
    releaseStatus: 'UNVERIFIED_CANDIDATE', runtimeAuthority: false};
  fs.writeFileSync(identityFile, JSON.stringify(identity));
  return {archive, identityFile, bundle, identity, expected};
}
function withGhStub(implementation, callback) {
  // Test the real process boundary without adding an injectable trust bypass to
  // the production API. This stub does not test Sigstore cryptography.
  const stub = mock.method(childProcess, 'execFileSync', implementation);
  syncBuiltinESMExports();
  try { return callback(stub); }
  finally { stub.mock.restore(); syncBuiltinESMExports(); }
}
const verifiedOutput = file => JSON.stringify([{verificationResult: {statement: {
  _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
  subject: [{name: path.basename(file), digest: {sha256: hashArtifact(file)}}],
}}}]);

test('candidate verification pins repository, exact workflow/ref, source and signer revision, issuer and hosted runner', () => {
  const args = candidateVerificationArgs('candidate.tar.gz', 'bundle.json', expected);
  for (const [flag, value] of Object.entries({'--repo': CANDIDATE_REPOSITORY,
    '--hostname': 'github.com', '--signer-workflow': `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}`,
    '--source-digest': expected.sourceCommitSha, '--signer-digest': expected.sourceCommitSha,
    '--source-ref': CANDIDATE_REF, '--cert-oidc-issuer': 'https://token.actions.githubusercontent.com',
    '--cert-identity': `https://github.com/${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@${CANDIDATE_REF}`,
    '--predicate-type': 'https://slsa.dev/provenance/v1'})) assert.equal(args[args.indexOf(flag) + 1], value);
  assert.ok(args.includes('--deny-self-hosted-runners'));
  for (const bad of [undefined, {}, {...expected, sourceCommitSha: '--help'}, {...expected, sourceTreeSha: 'x'.repeat(40)}]) {
    assert.throws(() => candidateVerificationArgs('archive', 'bundle', bad), /EXPECTED_SOURCE_REQUIRED/);
  }
});

test('candidate structural identity rejects unknown authority, stale source, foreign workflow/ref, and mismatched archive', () => {
  const {identity} = fixture();
  assert.equal(validateCandidateIdentity(identity, identity.artifactSha256, expected).runtimeAuthority, false);
  for (const patch of [{runtimeAuthority: true}, {releaseStatus: 'CERTIFIED'}, {extra: true},
    {sourceCommitSha: 'c'.repeat(40)}, {sourceTreeSha: 'd'.repeat(40)}, {repository: 'foreign/repo'},
    {workflow: '.github/workflows/untrusted.yml'}, {sourceRef: 'refs/pull/1/merge'},
    {artifactName: '../other.tar.gz'}, {artifactSha256: 'e'.repeat(64)}]) {
    assert.throws(() => validateCandidateIdentity({...identity, ...patch}, identity.artifactSha256, expected), /IDENTITY_MISMATCH/);
  }
});

test('candidate verifier independently invokes gh on both signed subjects and emits no runtime capability', () => {
  const input = fixture(), calls = [];
  withGhStub((command, args, options) => {
    calls.push(args);
    assert.equal(command, 'gh'); assert.notEqual(options.shell, true);
    assert.equal(options.env.GH_HOST, 'github.com');
    return verifiedOutput(args[2]);
  }, () => {
    const receipt = verifyCandidateProvenance(input);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(args => args[2]), [input.archive, input.identityFile]);
    assert.equal(receipt.status, 'VERIFIED_CANDIDATE_PROVENANCE');
    assert.equal(receipt.runtimeAuthority, false);
    assert.equal(receipt.certificationGranted, false);
    assert.equal(receipt.extractedRuntimeVerified, false);
  });
});

test('candidate verifier fails closed on process failure, malformed/empty output and missing verified subject', () => {
  for (const response of [new Error('untrusted signer'), 'not json', '[]', '{}',
    JSON.stringify([{verificationResult: {statement: {_type: 'https://in-toto.io/Statement/v1',
      predicateType: 'https://slsa.dev/provenance/v1', subject: [{digest: {sha256: '0'.repeat(64)}}]}}}])]) {
    const input = fixture();
    withGhStub(() => { if (response instanceof Error) throw response; return response; },
      () => assert.throws(() => verifyCandidateProvenance(input)));
  }
});

test('a valid archive result cannot substitute for failed identity verification', () => {
  const input = fixture();
  let calls = 0;
  withGhStub((_command, args) => {
    if (++calls === 2) throw new Error('identity signature rejected');
    return verifiedOutput(args[2]);
  }, () => assert.throws(() => verifyCandidateProvenance(input), /identity signature rejected/));
  assert.equal(calls, 2);
});

test('candidate verifier detects archive, identity, or bundle changes during verification', () => {
  for (const key of ['archive', 'identityFile', 'bundle']) {
    const input = fixture(); let calls = 0;
    withGhStub((_command, args) => {
      const result = verifiedOutput(args[2]);
      if (++calls === 2) fs.appendFileSync(input[key], 'changed');
      return result;
    }, () => assert.throws(() => verifyCandidateProvenance(input), /INPUT_CHANGED_DURING_VERIFICATION/));
  }
});

test('candidate CI packaging denies local, fork, branch, pull request and other workflow contexts', () => {
  const valid = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: CANDIDATE_REPOSITORY,
    GITHUB_REF: CANDIDATE_REF, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_WORKFLOW_REF: `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@${CANDIDATE_REF}`};
  for (const env of [{}, {...valid, GITHUB_REPOSITORY: 'foreign/repo'}, {...valid, GITHUB_REF: 'refs/heads/feature'},
    {...valid, GITHUB_EVENT_NAME: 'pull_request'}, {...valid, GITHUB_WORKFLOW_REF: 'other-workflow'}]) {
    assert.throws(() => prepareCiCandidate('not-read', 'not-created', env), /CI_CONTEXT_REQUIRED/);
  }
});

test('candidate CI packager binds a real archive to source identity and rejects later source edits', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-ci-package-'));
  const root = path.join(scratch, 'source'); fs.mkdirSync(root);
  const files = {
    'package.json': '{"name":"fixture","version":"1.0.0"}', 'pnpm-lock.yaml': 'lockfileVersion: 9',
    'pnpm-workspace.yaml': 'packages: []', '.env.example': 'EXAMPLE=true',
    'scripts/windows-process-identity.ps1': 'param([int] $ProcessId)\n# Test fixture helper; candidate packaging requires the runtime dependency.\n',
    'terminal/server.mjs': 'export {};', 'terminal/astra-feed.mjs': 'export {};',
    'terminal/soak-reader.mjs': 'export {};', 'terminal/evidence-view.mjs': 'export {};',
    'terminal/local-request.mjs': 'export {};', 'dist/fusion.js': 'export {};',
    'dist/execution-engine.js': 'export {};', 'terminal/dist/index.html': '<html></html>',
    'ui/index.html': '<html></html>', 'ui/app.js': 'export {};', 'ui/style.css': 'body{}',
  };
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, bytes);
  }
  function getGitExecutable() {
    if (process.env.GIT_PATH && fs.existsSync(process.env.GIT_PATH)) return process.env.GIT_PATH;
    for (const c of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']) {
      if (c === 'git') {
        try { childProcess.execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch {}
      } else if (fs.existsSync(c)) {
        return c;
      }
    }
    return 'git';
  }
  const git = args => childProcess.execFileSync(getGitExecutable(), args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
  git(['init', '--quiet']); git(['add', '.']);
  git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  const env = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: CANDIDATE_REPOSITORY,
    GITHUB_REF: CANDIDATE_REF, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: git(['rev-parse', 'HEAD']),
    GITHUB_WORKFLOW_REF: `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@${CANDIDATE_REF}`};
  const destination = path.join(scratch, 'output'), identity = prepareCiCandidate(root, destination, env);
  assert.equal(identity.sourceCommitSha, env.GITHUB_SHA);
  assert.equal(identity.sourceTreeSha, git(['rev-parse', 'HEAD^{tree}']));
  assert.equal(identity.artifactSha256, hashArtifact(path.join(destination, identity.artifactName)));
  assert.equal(identity.runtimeAuthority, false);
  const archived = childProcess.execFileSync('tar', ['-tzf', path.join(destination, identity.artifactName)], {encoding: 'utf8', windowsHide: true});
  for (const required of ['./.env.example', './RELEASE_MANIFEST.json', './dist/fusion.js', './terminal/dist/index.html']) assert.ok(archived.split(/\r?\n/).includes(required), required);
  const bundle = path.join(scratch, 'fixture-bundle.json'); fs.writeFileSync(bundle, 'test-only gh stub');
  const realExec = childProcess.execFileSync;
  withGhStub((command, args, options) => command === 'gh' ? verifiedOutput(args[2]) : realExec(command, args, options), () => {
    const verified = verifyExtractedCandidate({archive:path.join(destination, identity.artifactName),
      identityFile:path.join(destination, 'candidate-identity.json'), bundle,
      expected:{sourceCommitSha:identity.sourceCommitSha, sourceTreeSha:identity.sourceTreeSha}, extractedDirectory:path.join(destination, 'candidate')});
    const win32TreeVerified = process.platform === 'win32';
    assert.equal(verified.status, win32TreeVerified ? 'VERIFIED_EXTRACTED_CANDIDATE' : 'EXTRACTED_INVENTORY_MATCHED',
      'real producer USTAR must match the strict parser subset');
    assert.equal(verified.win32TreeVerified, win32TreeVerified);
  });
  assert.throws(() => prepareCiCandidate(root, destination, env), /OUTPUT_EXISTS/);
  assert.throws(() => prepareCiCandidate(root, path.join(root, 'nested'), env), /OUTPUT_MUST_BE_OUTSIDE_SOURCE/);
  fs.appendFileSync(path.join(root, 'terminal/server.mjs'), '// edited');
  assert.throws(() => prepareCiCandidate(root, path.join(scratch, 'dirty-output'), env), /SOURCE_CHANGED/);
  assert.equal(fs.existsSync(path.join(scratch, 'dirty-output')), false);
});
