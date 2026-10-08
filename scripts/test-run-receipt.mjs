import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { canonicalJsonV10, hashCanonicalV10 } from './canonicalization-v10.mjs';

export const RECEIPT_PATH = 'artifacts/connectivity/test-run-receipt.json';
export const CERTIFIED_TEST_COMMAND = 'npm run build:engine && npm run test:all';
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_ROOTS = ['src', 'scripts', 'test', 'config', 'terminal'];
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage', '.next']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function collectSourceInventory() {
  const files = [];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('TEST_RECEIPT_UNSAFE_SYMLINK');
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) walk(absolutePath);
      } else if (entry.isFile()) files.push(absolutePath);
    }
  }
  for (const root of SOURCE_ROOTS) walk(resolve(ROOT, root));
  const inventory = files.map((file) => {
    const relPath = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const bytes = readFileSync(file);
    return { relPath, sourceHash: sha256(bytes), sizeBytes: bytes.length };
  }).sort((a, b) => a.relPath.localeCompare(b.relPath));
  const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
  if (!configPath) throw new Error('TEST_RECEIPT_CONFIG_MISSING');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) throw new Error('TEST_RECEIPT_CONFIG_INVALID');
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  if (parsed.errors.length) throw new Error('TEST_RECEIPT_CONFIG_INVALID');
  const typeFiles = parsed.fileNames.filter((file) => !file.endsWith('.d.ts') && /[\\/]src[\\/]/.test(file));
  const typeInventory = typeFiles.map((file) => {
    const relPath = file.slice(ROOT.length + 1).replace(/\\/g, '/');
    const bytes = readFileSync(file);
    return { relPath, sourceHash: sha256(bytes), sizeBytes: bytes.length };
  }).sort((a, b) => a.relPath.localeCompare(b.relPath));
  return {
    inventory,
    sourceInventoryRoot: hashCanonicalV10(typeInventory),
    executionInventoryRoot: hashCanonicalV10(inventory),
  };
}

export function collectTestConfigurationIdentity() {
  const readHash = (relativePath) => sha256(readFileSync(resolve(ROOT, relativePath)));
  return {
    packageJsonHash: readHash('package.json'),
    packageLockHash: readHash('package-lock.json'),
    tsconfigHash: readHash('tsconfig.json'),
    terminalPackageJsonHash: readHash('terminal/package.json'),
    terminalPackageLockHash: readHash('terminal/package-lock.json'),
  };
}

function runtimeIdentity() {
  let npm = 'UNAVAILABLE';
  try {
    const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd --version'] : ['--version'];
    npm = execFileSync(executable, args, {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Node remains useful context; verifier still checks the supported runtime identity.
  }
  return { node: process.version, npm, platform: process.platform, architecture: process.arch };
}

export function createTestRunReceipt({ command, exitCode, output, outputSha256, startedAt, completedAt,
  sourceSnapshot = collectSourceInventory(), configurationSnapshot = collectTestConfigurationIdentity() }) {
  const outputDigest = outputSha256 ?? (typeof output === 'string' ? sha256(Buffer.from(output, 'utf8')) : undefined);
  if (command !== CERTIFIED_TEST_COMMAND || !Number.isInteger(exitCode) ||
      typeof outputDigest !== 'string' || !/^[0-9a-f]{64}$/.test(outputDigest)) {
    throw new Error('TEST_RECEIPT_INVALID_RUN_INPUT');
  }
  const currentSource = collectSourceInventory();
  const currentConfiguration = collectTestConfigurationIdentity();
  if (currentSource.sourceInventoryRoot !== sourceSnapshot.sourceInventoryRoot ||
      currentSource.executionInventoryRoot !== sourceSnapshot.executionInventoryRoot ||
      hashCanonicalV10(currentSource.inventory) !== hashCanonicalV10(sourceSnapshot.inventory) ||
      hashCanonicalV10(currentConfiguration) !== hashCanonicalV10(configurationSnapshot)) {
    throw new Error('TEST_RECEIPT_SOURCE_CHANGED_DURING_RUN');
  }
  const { inventory, sourceInventoryRoot } = sourceSnapshot;
  const payload = {
    schemaVersion: 1,
    status: exitCode === 0 ? 'PASS' : 'FAIL',
    command,
    startedAt,
    completedAt,
    runtime: runtimeIdentity(),
    sourceInventoryRoot,
    executionInventoryRoot: sourceSnapshot.executionInventoryRoot,
    sourceFileCount: inventory.length,
    sourceManifestHash: hashCanonicalV10(inventory),
    ...configurationSnapshot,
    outputSha256: outputDigest,
    exitCode,
  };
  return { ...payload, receiptHash: hashCanonicalV10(payload) };
}

export function verifyTestRunReceipt(receipt, expectedSourceInventoryRoot) {
  const fail = (reason) => ({ verified: false, status: 'UNPROVEN', reason });
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return fail('RECEIPT_MISSING_OR_INVALID');
  const { receiptHash, ...payload } = receipt;
  if (receipt.schemaVersion !== 1 || receipt.status !== 'PASS' || receipt.exitCode !== 0 ||
      receipt.command !== CERTIFIED_TEST_COMMAND ||
      typeof receipt.outputSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.outputSha256) ||
      !Number.isInteger(receipt.sourceFileCount) || receipt.sourceFileCount < 1 ||
      typeof receipt.executionInventoryRoot !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.executionInventoryRoot) ||
      typeof receipt.sourceManifestHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.sourceManifestHash) ||
      typeof receipt.startedAt !== 'string' || typeof receipt.completedAt !== 'string' ||
      !receipt.runtime || receipt.runtime.node !== process.version ||
      typeof receipt.runtime.npm !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(receipt.runtime.npm) ||
      !['win32', 'linux', 'darwin'].includes(receipt.runtime.platform) ||
      typeof receipt.runtime.architecture !== 'string' ||
      receipt.runtime.platform !== process.platform || receipt.runtime.architecture !== process.arch ||
      typeof receipt.packageJsonHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.packageJsonHash) ||
      typeof receipt.packageLockHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.packageLockHash) ||
      typeof receipt.tsconfigHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.tsconfigHash) ||
      typeof receipt.terminalPackageJsonHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.terminalPackageJsonHash) ||
      typeof receipt.terminalPackageLockHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.terminalPackageLockHash) ||
      !Number.isFinite(Date.parse(receipt.startedAt)) || !Number.isFinite(Date.parse(receipt.completedAt)) ||
      Date.parse(receipt.completedAt) < Date.parse(receipt.startedAt) ||
      receipt.sourceInventoryRoot !== expectedSourceInventoryRoot ||
      receipt.receiptHash !== hashCanonicalV10(payload)) return fail('RECEIPT_FIELDS_OR_ROOT_MISMATCH');

  const currentSource = collectSourceInventory();
  const { inventory, sourceInventoryRoot } = currentSource;
  const identities = collectTestConfigurationIdentity();
  if (sourceInventoryRoot !== receipt.sourceInventoryRoot || currentSource.executionInventoryRoot !== receipt.executionInventoryRoot ||
      inventory.length !== receipt.sourceFileCount || hashCanonicalV10(inventory) !== receipt.sourceManifestHash ||
      identities.packageJsonHash !== receipt.packageJsonHash ||
      identities.packageLockHash !== receipt.packageLockHash ||
      identities.tsconfigHash !== receipt.tsconfigHash ||
      identities.terminalPackageJsonHash !== receipt.terminalPackageJsonHash ||
      identities.terminalPackageLockHash !== receipt.terminalPackageLockHash) return fail('CURRENT_SOURCE_OR_CONFIGURATION_DRIFT');
  return { verified: true, status: 'PASS', receiptHash, command: receipt.command, outputSha256: receipt.outputSha256 };
}

export function readAndVerifyTestRunReceipt(expectedSourceInventoryRoot, receiptPath = RECEIPT_PATH) {
  const path = resolve(ROOT, receiptPath);
  if (!existsSync(path)) return { verified: false, status: 'UNPROVEN', reason: 'RECEIPT_NOT_FOUND' };
  try {
    return verifyTestRunReceipt(JSON.parse(readFileSync(path, 'utf8')), expectedSourceInventoryRoot);
  } catch {
    return { verified: false, status: 'UNPROVEN', reason: 'RECEIPT_UNREADABLE_OR_INVALID' };
  }
}

export function serializeReceipt(receipt) {
  return canonicalJsonV10(receipt);
}
