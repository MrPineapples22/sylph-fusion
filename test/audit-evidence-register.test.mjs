import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, copyFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditEvidenceRegister } from '../scripts/audit-evidence-register.mjs';

const header = '| Requirement ID | Description | Status | Tests |';
const row = (id, description, status = 'PARTIAL', tests = 'None') => `| ${id} | ${description} | ${status} | ${tests} |`;
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-audit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src')); await mkdir(join(root, 'test'));
  await writeFile(join(root, 'src', 'present.ts'), ''); await writeFile(join(root, 'test', 'present.test.mjs'), '');
  return async (...rows) => auditEvidenceRegister({ root, text: [header, ...rows].join('\n') });
}

test('existing partial and verified references count statuses without certification', async t => {
  const audit = await fixture(t);
  const report = await audit(row('REQ-001', '`src/present.ts`'), row('REQ-002', 'escaped \\| pipe and `src/present.ts,`', 'VERIFIED', '`test/present.test.mjs`'));
  assert.equal(report.valid, true); assert.equal(report.requirementCount, 2);
  assert.deepEqual(report.statusCounts, { PARTIAL: 1, VERIFIED: 1 });
  assert.match(report.scope, /do not establish/);
});
test('missing references and absent verified test references fail independently', async t => {
  const audit = await fixture(t);
  const report = await audit(row('REQ-001', '`src/missing.ts`', 'VERIFIED'), row('REQ-002', '`src/present.ts`', 'VERIFIED', '`test/missing.test.mjs`'));
  assert.equal(report.valid, false);
  assert.equal(report.errors.filter(e => e.code === 'MISSING_REFERENCE').length, 2);
  assert.equal(report.errors.filter(e => e.code === 'VERIFIED_WITHOUT_TEST_REFERENCE').length, 1);
});
test('duplicate IDs, malformed rows and unknown statuses fail', async t => {
  const audit = await fixture(t);
  const report = await audit(row('REQ-001', 'ok'), row('REQ-001', 'ok'), '| REQ-003 | too short |', row('REQ-004', 'ok', 'APPROVED'));
  assert.deepEqual(report.errors.map(e => e.code), ['DUPLICATE_ID', 'MALFORMED_ROW', 'INVALID_STATUS']);
});
test('traversal and absolute references are rejected without reading targets', async t => {
  const audit = await fixture(t);
  for (const path of ['src/../../outside.ts', '../src/outside.ts', '/src/outside.ts', 'C:\\src\\outside.ts', 'src\\..\\outside.ts']) {
    const report = await audit(row('REQ-001', `\`${path}\``));
    assert.equal(report.errors[0]?.code, 'UNSAFE_REFERENCE', path);
  }
});
test('external directory symlink cannot supply evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-link-'));
  const outside = await mkdtemp(join(tmpdir(), 'evidence-outside-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await writeFile(join(outside, 'secret.ts'), '');
  await symlink(outside, join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  const report = await auditEvidenceRegister({ root, text: `${header}\n${row('REQ-001', '`src/secret.ts`')}` });
  assert.equal(report.errors[0]?.code, 'UNSAFE_REFERENCE');
});
test('empty input and unclosed code span cannot silently pass', async t => {
  const audit = await fixture(t);
  assert.equal((await audit()).valid, false);
  const report = await audit('| REQ-001 | `src/present.ts | PARTIAL | None |');
  assert.ok(report.errors.some(e => e.code === 'MALFORMED_ROW'));
});
test('CLI emits JSON and nonzero for invalid evidence, zero for valid evidence', async t => {
  const root = await mkdtemp(join(tmpdir(), 'evidence-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  const script = join(root, 'scripts', 'audit-evidence-register.mjs');
  await copyFile(new URL('../scripts/audit-evidence-register.mjs', import.meta.url), script);
  for (const [description, expected] of [['`src/missing.ts`', 1], ['No implementation yet', 0]]) {
    await writeFile(join(root, 'UPGRADES_REQUIREMENT_REGISTER.md'), `${header}\n${row('REQ-001', description)}`);
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    assert.equal(result.status, expected); assert.equal(result.stderr, '');
    assert.equal(JSON.parse(result.stdout).valid, expected === 0);
  }
});
