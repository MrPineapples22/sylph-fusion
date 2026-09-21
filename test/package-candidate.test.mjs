import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {packageCandidate} from '../scripts/package-windows-release.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

test('candidate package includes runtime helpers, UI, lockfiles and correct launchers', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sylph-package-audit-'));
  const target = path.join(scratch, 'candidate');
  const manifest = packageCandidate(root, target);
  assert.equal(manifest.releaseStatus, 'UNVERIFIED_CANDIDATE');
  const paths = manifest.files.map(file => file.path);
  for (const required of ['terminal/evidence-view.mjs', 'terminal/local-request.mjs', 'terminal/astra-feed.mjs',
    'terminal/soak-reader.mjs', 'ui/index.html', 'ui/app.js', 'ui/style.css', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    assert.ok(paths.includes(required), required);
  }
  assert.ok(!paths.some(name => name === '.env' || name.startsWith('data/') || name.startsWith('sessions/') || name.startsWith('node_modules/')));
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
