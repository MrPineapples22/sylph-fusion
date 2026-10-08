import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {packageCandidate} from './package-windows-release.mjs';
import {CANDIDATE_REPOSITORY, CANDIDATE_WORKFLOW, CANDIDATE_REF, hashArtifact} from './candidate-provenance.mjs';

export function prepareCiCandidate(root, destination, environment = process.env) {
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_REPOSITORY !== CANDIDATE_REPOSITORY ||
      environment.GITHUB_REF !== CANDIDATE_REF || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      environment.GITHUB_WORKFLOW_REF !== `${CANDIDATE_REPOSITORY}/${CANDIDATE_WORKFLOW}@${CANDIDATE_REF}`) {
    throw new Error('CANDIDATE_CI_CONTEXT_REQUIRED');
  }
  root = fs.realpathSync(root);
  destination = path.resolve(destination);
  if (destination === root || destination.startsWith(root + path.sep) || root.startsWith(destination + path.sep)) {
    throw new Error('CANDIDATE_OUTPUT_MUST_BE_OUTSIDE_SOURCE');
  }
function getGitExecutable() {
  if (process.env.GIT_PATH && fs.existsSync(process.env.GIT_PATH)) return process.env.GIT_PATH;
  for (const c of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']) {
    if (c === 'git') {
      try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch {}
    } else if (fs.existsSync(c)) {
      return c;
    }
  }
  return 'git';
}

  if (fs.existsSync(destination)) throw new Error('CANDIDATE_OUTPUT_EXISTS');
  const git = args => execFileSync(getGitExecutable(), args, {cwd: root, encoding: 'utf8', windowsHide: true}).trim();
  const sourceCommitSha = git(['rev-parse', 'HEAD']), sourceTreeSha = git(['rev-parse', 'HEAD^{tree}']);
  if (sourceCommitSha !== environment.GITHUB_SHA || !/^[a-f0-9]{40}$/.test(sourceCommitSha) || !/^[a-f0-9]{40}$/.test(sourceTreeSha)) {
    throw new Error('CANDIDATE_CHECKOUT_IDENTITY_MISMATCH');
  }
  // Build outputs are expected to change. All other tracked inputs must remain
  // the checked-out revision; dependencies and outputs are inventoried separately.
  const changed = git(['diff', '--name-only', 'HEAD', '--', '.', ':!dist', ':!terminal/dist']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  if (changed || untracked) throw new Error('CANDIDATE_SOURCE_CHANGED');
  fs.mkdirSync(destination);
  const packaged = path.join(destination, 'candidate');
  packageCandidate(root, packaged);
  const artifactName = 'sylph-windows-candidate.tar.gz', archive = path.join(destination, artifactName);
  execFileSync('tar', ['--format=ustar', '-czf', archive, '-C', packaged, '.'], {cwd: root, windowsHide: true, timeout: 120_000});
  const identity = {schemaVersion: 'sylph.candidate.identity.v1', repository: CANDIDATE_REPOSITORY,
    workflow: CANDIDATE_WORKFLOW, sourceRef: CANDIDATE_REF, sourceCommitSha, sourceTreeSha,
    artifactName, artifactSha256: hashArtifact(archive), releaseStatus: 'UNVERIFIED_CANDIDATE', runtimeAuthority: false};
  fs.writeFileSync(path.join(destination, 'candidate-identity.json'), JSON.stringify(identity, null, 2) + '\n', {flag: 'wx'});
  return identity;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/prepare-ci-candidate.mjs OUTPUT_DIRECTORY');
    console.log(JSON.stringify(prepareCiCandidate(fileURLToPath(new URL('../', import.meta.url)), process.argv[2])));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
