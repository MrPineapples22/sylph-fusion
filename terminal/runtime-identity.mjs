import {createHash} from 'node:crypto';
import {lstat, open, opendir} from 'node:fs/promises';
import {join, relative, resolve, sep} from 'node:path';

const INCLUDED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css']);
const MAX_RUNTIME_ARTIFACT_COUNT = 10_000;
const MAX_RUNTIME_SCAN_ENTRIES = 100_000;
const MAX_RUNTIME_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_RUNTIME_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const MAX_CONCURRENT_ARTIFACT_READS = 4;
const FILE_READ_CHUNK_BYTES = 64 * 1024;

function addPath(root, path, size, files, budget) {
  const rel = relative(root, path).split(sep).join('/');
  if (files.has(rel)) return;
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_RUNTIME_ARTIFACT_BYTES ||
      files.size >= MAX_RUNTIME_ARTIFACT_COUNT || budget.bytes + size > MAX_RUNTIME_SNAPSHOT_BYTES) {
    throw new Error('RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED');
  }
  files.set(rel, size);
  budget.bytes += size;
}

async function collectPaths(root, current, files, budget) {
  const directory = await opendir(current);
  for await (const entry of directory) {
    budget.entries += 1;
    if (budget.entries > MAX_RUNTIME_SCAN_ENTRIES) throw new Error('RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED');
    const path = join(current, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('RUNTIME_IDENTITY_SYMLINK_BLOCKED');
    if (info.isDirectory()) {
      await collectPaths(root, path, files, budget);
    } else if (info.isFile() && INCLUDED_EXTENSIONS.has(extensionOf(entry.name))) {
      addPath(root, path, info.size, files, budget);
    }
  }
}

function extensionOf(path) {
  const index = path.lastIndexOf('.');
  return index < 0 ? '' : path.slice(index);
}

async function captureArtifacts(projectRoot) {
  const root = resolve(projectRoot);
  const paths = new Map();
  const budget = {bytes: 0, entries: 0};
  for (const relativePath of ['package.json', 'terminal/package.json', 'terminal/server.mjs']) {
    const path = join(root, relativePath);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('RUNTIME_IDENTITY_REQUIRED_ARTIFACT_INVALID');
    addPath(root, path, info.size, paths, budget);
  }
  for (const relativeDirectory of ['dist', 'terminal']) {
    const directory = join(root, relativeDirectory);
    if (relativeDirectory === 'terminal') {
      const terminalDirectory = await opendir(directory);
      for await (const entry of terminalDirectory) {
        budget.entries += 1;
        if (budget.entries > MAX_RUNTIME_SCAN_ENTRIES) throw new Error('RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED');
        if (!entry.isFile() || !entry.name.endsWith('.mjs') || entry.name === 'server.mjs') continue;
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('RUNTIME_IDENTITY_ARTIFACT_INVALID');
        addPath(root, path, info.size, paths, budget);
      }
      await collectPaths(root, join(directory, 'dist'), paths, budget);
    } else {
      await collectPaths(root, directory, paths, budget);
    }
  }
  const entries = [...paths.keys()];
  const files = new Map();
  let actualBytes = 0;
  for (let start = 0; start < entries.length; start += MAX_CONCURRENT_ARTIFACT_READS) {
    const batch = entries.slice(start, start + MAX_CONCURRENT_ARTIFACT_READS);
    const read = await Promise.all(batch.map(async path => [path, await readArtifactBounded(join(root, path))]));
    for (const [path, bytes] of read) {
      actualBytes += bytes.length;
      if (actualBytes > MAX_RUNTIME_SNAPSHOT_BYTES) throw new Error('RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED');
      files.set(path, bytes);
    }
  }
  return files;
}

async function readArtifactBounded(path) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > MAX_RUNTIME_ARTIFACT_BYTES) throw new Error('RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED');
    const chunks = [];
    let total = 0;
    while (total <= MAX_RUNTIME_ARTIFACT_BYTES) {
      const size = Math.min(FILE_READ_CHUNK_BYTES, MAX_RUNTIME_ARTIFACT_BYTES - total + 1);
      const chunk = Buffer.allocUnsafe(size);
      const {bytesRead} = await handle.read(chunk, 0, size, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_RUNTIME_ARTIFACT_BYTES) throw new Error('RUNTIME_IDENTITY_SCAN_LIMIT_EXCEEDED');
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

function fingerprint(files) {
  const hash = createHash('sha256');
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path).update('\0').update(String(bytes.length)).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

export async function createRuntimeIdentity(projectRoot, capturedAtMs = Date.now()) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0
    || !Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0) {
    throw new Error('INVALID_RUNTIME_IDENTITY_INPUT');
  }
  const startupFiles = await captureArtifacts(projectRoot);
  const startupFingerprint = fingerprint(startupFiles);

  return Object.freeze({
    async getReport() {
      try {
        const currentFiles = await captureArtifacts(projectRoot);
        const currentFingerprint = fingerprint(currentFiles);
        const changedArtifacts = [...new Set([...startupFiles.keys(), ...currentFiles.keys()])]
          .filter(path => !startupFiles.has(path) || !currentFiles.has(path)
            || !startupFiles.get(path).equals(currentFiles.get(path)))
          .sort();
        return Object.freeze({
          schemaVersion: 1,
          status: changedArtifacts.length === 0 ? 'UNCHANGED_SINCE_STARTUP' : 'CHANGED_SINCE_STARTUP',
          capturedAtMs,
          startupFingerprint,
          currentFingerprint,
          changedArtifactCount: changedArtifacts.length,
          changedArtifacts: Object.freeze(changedArtifacts.slice(0, 50)),
          changedArtifactsTruncated: changedArtifacts.length > 50,
        });
      } catch {
        return Object.freeze({
          schemaVersion: 1,
          status: 'UNKNOWN',
          reason: 'RUNTIME_ARTIFACT_SCAN_FAILED',
          capturedAtMs,
          startupFingerprint,
          currentFingerprint: null,
          changedArtifactCount: null,
          changedArtifacts: Object.freeze([]),
          changedArtifactsTruncated: false,
        });
      }
    },
  });
}
