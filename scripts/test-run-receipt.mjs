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
const RECEIPT_KEYS = ['schemaVersion', 'status', 'command', 'startedAt', 'completedAt', 'runtime', 'sourceInventoryRoot',
  'executionInventoryRoot', 'sourceFileCount', 'sourceManifestHash', 'packageManager', 'packageJsonHash', 'packageLockHash',
  'pnpmLockHash', 'pnpmWorkspaceHash', 'tsconfigHash', 'terminalPackageJsonHash', 'terminalPackageLockHash', 'outputSha256',
  'exitCode', 'receiptHash'];
const RUNTIME_KEYS = ['node', 'npm', 'pnpm', 'platform', 'architecture'];
const SOURCE_ROOTS = ['src', 'scripts', 'test', 'config', 'terminal'];
const EXCLUDED_DIRECTORIES = new Set(['node_modules', 'dist', '.git', 'coverage', '.next']);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = new Set(keys);
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.size && actual.every((key) => typeof key === 'string' && expected.has(key));
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
  const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
  if (typeof packageJson.packageManager !== 'string' || !/^pnpm@\d+\.\d+\.\d+$/.test(packageJson.packageManager)) {
    throw new Error('TEST_RECEIPT_PACKAGE_MANAGER_PIN_REQUIRED');
  }
  return {
    packageManager: packageJson.packageManager,
    packageJsonHash: readHash('package.json'),
    packageLockHash: readHash('package-lock.json'),
    pnpmLockHash: readHash('pnpm-lock.yaml'),
    pnpmWorkspaceHash: readHash('pnpm-workspace.yaml'),
    tsconfigHash: readHash('tsconfig.json'),
    terminalPackageJsonHash: readHash('terminal/package.json'),
    terminalPackageLockHash: readHash('terminal/package-lock.json'),
  };
}

function runtimeIdentity() {
  let npm = 'UNAVAILABLE';
  let pnpm = 'UNAVAILABLE';
  try {
    const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'npm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd --version'] : ['--version'];
    npm = execFileSync(executable, args, {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // Node remains useful context; verifier still checks the supported runtime identity.
  }
  try {
    const executable = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm.cmd --version'] : ['--version'];
    pnpm = execFileSync(executable, args, {
      cwd: ROOT,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 64 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // A missing package manager keeps the receipt unverified rather than inventing a version.
  }
  return { node: process.version, npm, pnpm, platform: process.platform, architecture: process.arch };
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
    schemaVersion: 2,
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
  if (!hasExactKeys(receipt, RECEIPT_KEYS) || !hasExactKeys(receipt.runtime, RUNTIME_KEYS)) return fail('RECEIPT_SCHEMA');
  const { receiptHash, ...payload } = receipt;
  if (receipt.schemaVersion !== 2 || receipt.status !== 'PASS' || receipt.exitCode !== 0 ||
      receipt.command !== CERTIFIED_TEST_COMMAND ||
      typeof receipt.outputSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.outputSha256) ||
      !Number.isInteger(receipt.sourceFileCount) || receipt.sourceFileCount < 1 ||
      typeof receipt.executionInventoryRoot !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.executionInventoryRoot) ||
      typeof receipt.sourceManifestHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.sourceManifestHash) ||
      typeof receipt.startedAt !== 'string' || typeof receipt.completedAt !== 'string' ||
      !receipt.runtime || receipt.runtime.node !== process.version ||
      typeof receipt.runtime.npm !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(receipt.runtime.npm) ||
      typeof receipt.runtime.pnpm !== 'string' || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(receipt.runtime.pnpm) ||
      typeof receipt.packageManager !== 'string' || !/^pnpm@\d+\.\d+\.\d+$/.test(receipt.packageManager) ||
      receipt.runtime.pnpm !== receipt.packageManager.slice('pnpm@'.length) ||
      !['win32', 'linux', 'darwin'].includes(receipt.runtime.platform) ||
      typeof receipt.runtime.architecture !== 'string' ||
      receipt.runtime.platform !== process.platform || receipt.runtime.architecture !== process.arch ||
      typeof receipt.packageJsonHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.packageJsonHash) ||
      typeof receipt.packageLockHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.packageLockHash) ||
      typeof receipt.pnpmLockHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.pnpmLockHash) ||
      typeof receipt.pnpmWorkspaceHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.pnpmWorkspaceHash) ||
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
      identities.packageManager !== receipt.packageManager ||
      identities.packageJsonHash !== receipt.packageJsonHash ||
      identities.packageLockHash !== receipt.packageLockHash ||
      identities.pnpmLockHash !== receipt.pnpmLockHash ||
      identities.pnpmWorkspaceHash !== receipt.pnpmWorkspaceHash ||
      identities.tsconfigHash !== receipt.tsconfigHash ||
      identities.terminalPackageJsonHash !== receipt.terminalPackageJsonHash ||
      identities.terminalPackageLockHash !== receipt.terminalPackageLockHash) return fail('CURRENT_SOURCE_OR_CONFIGURATION_DRIFT');
  return { verified: true, status: 'PASS', receiptHash, command: receipt.command, outputSha256: receipt.outputSha256,
    verificationScope: 'SOURCE_CONFIGURATION_AND_RUNTIME_CLAIM_INTEGRITY',
    issuerAuthenticated: false, dependencyInstallationVerified: false };
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
