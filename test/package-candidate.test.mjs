import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {packageCandidate, isDirectInvocation, runtimeModuleClosure} from '../scripts/package-windows-release.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

test('release packager recognizes direct invocation using canonical file URLs', () => {
  const script = path.join(root, 'scripts', 'package-windows-release.mjs');
  assert.equal(isDirectInvocation(script, pathToFileURL(script).href), true);
  assert.equal(isDirectInvocation('scripts\\package-windows-release.mjs', 'file:///normalized/scripts/package-windows-release.mjs'), true);
  assert.equal(isDirectInvocation(path.join(root, 'package.json'), pathToFileURL(script).href), false);
});

test('candidate package includes runtime helpers, UI, lockfiles and correct launchers', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-package-audit-'));
  const target = path.join(scratch, 'candidate');
  const manifest = packageCandidate(root, target);
  assert.equal(manifest.releaseStatus, 'UNVERIFIED_CANDIDATE');
  const paths = manifest.files.map(file => file.path);
  for (const required of ['terminal/evidence-view.mjs', 'terminal/local-request.mjs', 'terminal/astra-feed.mjs',
    'terminal/soak-reader.mjs', 'terminal/static-files.mjs', 'terminal/goal-loop-health.mjs', 'ui/index.html', 'ui/app.js', 'ui/style.css', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    assert.ok(paths.includes(required), required);
  }
  assert.ok(!paths.some(name => name === '.env' || name.startsWith('data/') || name.startsWith('sessions/') || name.startsWith('node_modules/')));
  // Resolve the copied server graph from the candidate itself, never the source tree.
  assert.deepEqual(runtimeModuleClosure(target), runtimeModuleClosure(root));
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(target, file.path));
    assert.equal(bytes.length, file.sizeBytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
  const launcher = fs.readFileSync(path.join(target, 'start-dashboard.bat'), 'utf8');
  assert.match(launcher, /cd \/d "%~dp0"/);
  assert.match(launcher, /TERMINAL_PORT=8793/);
  assert.throws(() => packageCandidate(root, target), /already exists/);
  // Retained for inspection; no recursive deletion is performed by the test.
});

function moduleFixture(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-module-closure-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, content);
  }
  return directory;
}

test('runtime closure includes transitive, re-exported and dynamic literal imports exactly once', () => {
  const directory = moduleFixture({
    'terminal/server.mjs': `import './helper.mjs'; export {value} from '../dist/value.js'; await import('./lazy.mjs'); // import './missing.mjs'`,
    'terminal/helper.mjs': `import './server.mjs'; const text = "import './not-real.mjs'";`,
    'terminal/lazy.mjs': `export {value} from '../dist/value.js';`,
    'dist/value.js': 'export const value = 1;',
  });
  assert.deepEqual(runtimeModuleClosure(directory).map(value => value.replaceAll('\\', '/')), [
    'dist/value.js', 'terminal/helper.mjs', 'terminal/lazy.mjs', 'terminal/server.mjs',
  ]);
});

test('runtime closure fails closed on missing, private, escaping and computed dependencies', () => {
  for (const statement of [
    "import './missing.mjs';", "import '../.env';", "import '../data/wallet.json';",
    "import '../../outside.mjs';", "await import(process.env.MODULE);",
  ]) {
    const directory = moduleFixture({'terminal/server.mjs': statement});
    assert.throws(() => runtimeModuleClosure(directory), /ENOENT|Disallowed runtime dependency|Computed runtime import/);
  }
});

test('runtime closure refuses linked directory components', () => {
  const directory = moduleFixture({'terminal/server.mjs': "import '../dist/linked/helper.js';", 'outside/helper.js': 'export {};'});
  fs.mkdirSync(path.join(directory, 'dist'));
  fs.symlinkSync(path.join(directory, 'outside'), path.join(directory, 'dist/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => runtimeModuleClosure(directory), /may not be a link/);
});
