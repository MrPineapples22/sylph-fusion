import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntimeIdentity} from '../runtime-identity.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'sylph-runtime-identity-'));
  mkdirSync(join(root, 'terminal'));
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}');
  writeFileSync(join(root, 'terminal', 'package.json'), '{"name":"terminal"}');
  return root;
}

test('runtime identity reports unchanged artifacts with stable fingerprints', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'terminal', 'server.mjs'), 'export {};');
    writeFileSync(join(root, 'terminal', 'helper.mjs'), 'export const value = 1;');
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'fusion.js'), 'export {};');
    mkdirSync(join(root, 'terminal', 'dist', 'assets'), {recursive: true});
    writeFileSync(join(root, 'terminal', 'dist', 'index.html'), '<main></main>');
    writeFileSync(join(root, 'terminal', 'dist', 'assets', 'app.js'), 'void 0;');

    const identity = await createRuntimeIdentity(root, 100);
    const first = await identity.getReport();
    const second = await identity.getReport();
    assert.equal(first.status, 'UNCHANGED_SINCE_STARTUP');
    assert.equal(first.capturedAtMs, 100);
    assert.match(first.startupFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(first.currentFingerprint, first.startupFingerprint);
    assert.deepEqual(second, first);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('runtime identity reports added, changed, and removed artifacts without exposing absolute paths', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'terminal', 'server.mjs'), 'export {};');
    mkdirSync(join(root, 'dist'));
    writeFileSync(join(root, 'dist', 'fusion.js'), 'old runtime');
    mkdirSync(join(root, 'terminal', 'dist'));
    writeFileSync(join(root, 'terminal', 'dist', 'index.html'), 'old ui');
    const identity = await createRuntimeIdentity(root, 200);

    writeFileSync(join(root, 'dist', 'fusion.js'), 'new runtime');
    rmSync(join(root, 'terminal', 'dist', 'index.html'));
    writeFileSync(join(root, 'terminal', 'dist', 'added.css'), 'body{}');
    const report = await identity.getReport();
    assert.equal(report.status, 'CHANGED_SINCE_STARTUP');
    assert.equal(report.changedArtifactCount, 3);
    assert.deepEqual(report.changedArtifacts, ['dist/fusion.js', 'terminal/dist/added.css', 'terminal/dist/index.html']);
    assert.ok(report.changedArtifacts.every(path => !path.includes(root)));
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('runtime identity fails closed when a required artifact is removed after startup', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'terminal', 'server.mjs'), 'export {};');
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, 'terminal', 'dist'));
    const identity = await createRuntimeIdentity(root, 300);
    rmSync(join(root, 'dist'), {recursive: true, force: true});
    const report = await identity.getReport();
    assert.equal(report.status, 'UNKNOWN');
    assert.equal(report.reason, 'RUNTIME_ARTIFACT_SCAN_FAILED');
    assert.equal(report.currentFingerprint, null);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('runtime identity enforces per-artifact and aggregate byte budgets before reading large files', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'terminal', 'server.mjs'), 'export {};');
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, 'terminal', 'dist'));
    const oversized = join(root, 'dist', 'oversized.js');
    writeFileSync(oversized, 'x');
    truncateSync(oversized, 32 * 1024 * 1024 + 1);
    await assert.rejects(createRuntimeIdentity(root, 400), /RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED/);

    rmSync(oversized);
    for (let index = 0; index < 4; index += 1) {
      const path = join(root, 'dist', `aggregate-${index}.js`);
      writeFileSync(path, 'x');
      truncateSync(path, 32 * 1024 * 1024);
    }
    await assert.rejects(createRuntimeIdentity(root, 401), /RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED/);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('runtime identity maps scan-budget failures to UNKNOWN after startup', async () => {
  const root = fixture();
  try {
    writeFileSync(join(root, 'terminal', 'server.mjs'), 'export {};');
    mkdirSync(join(root, 'dist'));
    mkdirSync(join(root, 'terminal', 'dist'));
    const identity = await createRuntimeIdentity(root, 500);
    const oversized = join(root, 'dist', 'oversized.js');
    writeFileSync(oversized, 'x');
    truncateSync(oversized, 32 * 1024 * 1024 + 1);
    const report = await identity.getReport();
    assert.equal(report.status, 'UNKNOWN');
    assert.equal(report.reason, 'RUNTIME_ARTIFACT_SCAN_FAILED');
    assert.equal(report.currentFingerprint, null);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
