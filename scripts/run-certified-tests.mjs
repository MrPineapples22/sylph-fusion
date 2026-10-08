import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSourceInventory, collectTestConfigurationIdentity, createTestRunReceipt, RECEIPT_PATH, serializeReceipt } from './test-run-receipt.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const command = 'npm run build:engine && npm run test:all';
const startedAt = new Date().toISOString();
const outputHasher = createHash('sha256');
const sourceSnapshot = collectSourceInventory();
const configurationSnapshot = collectTestConfigurationIdentity();
const npmExecutable = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm';

const run = (script) => new Promise((resolveExit) => {
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm.cmd run ${script}`]
    : ['run', script];
  const child = spawn(npmExecutable, args, { cwd: ROOT, shell: false, windowsHide: true });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { outputHasher.update(chunk); process.stdout.write(chunk); });
  child.stderr.on('data', (chunk) => { outputHasher.update(chunk); process.stderr.write(chunk); });
  child.once('error', (error) => {
    const message = `${error.name}: ${error.message}\n`;
    outputHasher.update(message);
    process.stderr.write(message);
    resolveExit(1);
  });
  child.once('close', (code) => resolveExit(code ?? 1));
});

const buildExitCode = await run('build:engine');
const exitCode = buildExitCode === 0 ? await run('test:all') : buildExitCode;
const receipt = createTestRunReceipt({
  command,
  exitCode,
  outputSha256: outputHasher.digest('hex'),
  startedAt,
  completedAt: new Date().toISOString(),
  sourceSnapshot,
  configurationSnapshot,
});
const path = resolve(ROOT, RECEIPT_PATH);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, serializeReceipt(receipt), { encoding: 'utf8', flag: 'w' });
process.stdout.write(`\nTEST_RUN_RECEIPT: ${RECEIPT_PATH}\nTEST_RUN_STATUS: ${receipt.status}\nTEST_RUN_RECEIPT_HASH: ${receipt.receiptHash}\n`);
process.exitCode = exitCode === 0 ? 0 : 1;
