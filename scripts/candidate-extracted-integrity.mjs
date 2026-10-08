import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {verifyCandidateProvenance} from './candidate-provenance.mjs';

const MAX_ARCHIVE = 64 * 1024 * 1024, MAX_CONTENT = 256 * 1024 * 1024;
const MAX_FILE = 64 * 1024 * 1024, MAX_ENTRIES = 10_000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(`CANDIDATE_EXTRACTION_${code}`); };
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',');
const version = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');

function portableName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 255 || !/^[\x20-\x7e]+$/.test(name) ||
      name.includes('\\') || name.startsWith('/') || name.split('/').length > 64) fail('PATH_INVALID');
  for (const part of name.split('/')) {
    if (!part || part === '.' || part === '..' || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(part)) fail('PATH_INVALID');
  }
  return name;
}
function registerName(registry, name, kind) {
  portableName(name);
  const parts = name.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const current = parts.slice(0, i).join('/'), desired = i === parts.length ? kind : 'directory';
    const prior = registry.get(current.toLowerCase());
    if (prior && (prior.name !== current || prior.kind !== desired)) fail('PATH_COLLISION');
    registry.set(current.toLowerCase(), {name: current, kind: desired});
    if (registry.size > MAX_ENTRIES) fail('ENTRY_LIMIT');
  }
}

function readStable(file, limit) {
  const before = fs.lstatSync(file, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) fail('NOT_PLAIN_FILE');
  if (before.size < 0n || before.size > BigInt(limit)) fail('SIZE_LIMIT');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (version(fs.fstatSync(fd, {bigint: true})) !== version(before)) fail('FILE_CHANGED');
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, Math.min(1024 * 1024, bytes.length - offset), offset);
      if (!count) fail('TRUNCATED_FILE');
      offset += count;
    }
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0 ||
        version(fs.fstatSync(fd, {bigint: true})) !== version(before) ||
        version(fs.lstatSync(file, {bigint: true})) !== version(before)) fail('FILE_CHANGED');
    return {bytes, version: version(before)};
  } finally { fs.closeSync(fd); }
}

function field(header, offset, length) {
  const bytes = header.subarray(offset, offset + length), zero = bytes.indexOf(0);
  if (zero >= 0 && bytes.subarray(zero).some(byte => byte !== 0)) fail('TAR_FIELD_INVALID');
  const text = bytes.subarray(0, zero < 0 ? bytes.length : zero);
  if (text.some(byte => byte < 32 || byte > 126)) fail('TAR_FIELD_INVALID');
  return text.toString('ascii');
}
function octal(header, offset, length) {
  if (header.subarray(offset, offset + length).some(byte => byte > 127)) fail('TAR_NUMBER_INVALID');
  const text = header.subarray(offset, offset + length).toString('ascii');
  if (!/^[0-7]+(?:\0| )*$/.test(text)) fail('TAR_NUMBER_INVALID');
  const result = parseInt(text, 8);
  if (!Number.isSafeInteger(result)) fail('TAR_NUMBER_INVALID');
  return result;
}

/** Narrow POSIX ustar subset, deliberately not a general-purpose extractor.
 * No input files are created, no extension records or archive links are honored. */
function archiveInventory(compressed) {
  let tar;
  try { tar = gunzipSync(compressed, {maxOutputLength: MAX_CONTENT}); }
  catch { fail('GZIP_INVALID_OR_LIMIT'); }
  if (tar.length < 1024 || tar.length % 512 !== 0) fail('TAR_TRUNCATED');
  const files = new Map(), registry = new Map(), explicit = new Set();
  let offset = 0, ended = false, entries = 0;
  while (offset < tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (tar.length - offset < 1024 || tar.subarray(offset).some(byte => byte !== 0)) fail('TAR_END_INVALID');
      ended = true; break;
    }
    if (++entries > MAX_ENTRIES) fail('ENTRY_LIMIT');
    if (header.subarray(257, 265).toString('hex') !== '7573746172003030' || header.subarray(500).some(byte => byte !== 0)) fail('TAR_FORMAT_UNSUPPORTED');
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== octal(header, 148, 8)) fail('TAR_CHECKSUM_INVALID');
    const type = header[156];
    if (![0, 48, 53].includes(type) || field(header, 157, 100)) fail('TAR_TYPE_UNSUPPORTED');
    const size = octal(header, 124, 12);
    if (size > MAX_FILE || (type === 53 && size !== 0)) fail('SIZE_LIMIT');
    const prefix = field(header, 345, 155);
    let name = `${prefix ? prefix + '/' : ''}${field(header, 0, 100)}`;
    if (name.startsWith('./')) name = name.slice(2);
    if (type === 53 && name.endsWith('/')) name = name.slice(0, -1);
    if (!(type === 53 && name === '')) registerName(registry, name, type === 53 ? 'directory' : 'file');
    if (explicit.has(name.toLowerCase())) fail('DUPLICATE_MEMBER');
    explicit.add(name.toLowerCase());
    const start = offset + 512, end = start + size, next = start + Math.ceil(size / 512) * 512;
    if (next > tar.length || tar.subarray(end, next).some(byte => byte !== 0)) fail('TAR_TRUNCATED_OR_PADDING');
    if (type !== 53) files.set(name, {path: name, sizeBytes: size, sha256: digest(tar.subarray(start, end)), bytes: tar.subarray(start, end)});
    offset = next;
  }
  if (!ended) fail('TAR_END_INVALID');
  const member = files.get('RELEASE_MANIFEST.json');
  if (!member || member.sizeBytes > 4 * 1024 * 1024) fail('MANIFEST_MISSING_OR_LIMIT');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(member.bytes)); }
  catch { fail('MANIFEST_INVALID'); }
  if (!keys(manifest, ['application', 'version', 'releaseStatus', 'packagedAtUtc', 'dependenciesIncluded', 'totalFiles', 'files']) ||
      manifest.application !== 'sylph-fusion' || manifest.releaseStatus !== 'UNVERIFIED_CANDIDATE' || manifest.dependenciesIncluded !== false ||
      typeof manifest.version !== 'string' || typeof manifest.packagedAtUtc !== 'string' ||
      !Array.isArray(manifest.files) || manifest.totalFiles !== manifest.files.length || manifest.files.length !== files.size - 1) fail('MANIFEST_INVALID');
  const listed = new Set();
  for (const entry of manifest.files) {
    if (!keys(entry, ['path', 'sizeBytes', 'sha256'])) fail('MANIFEST_INVALID');
    portableName(entry.path);
    const actual = files.get(entry.path);
    if (entry.path === 'RELEASE_MANIFEST.json' || listed.has(entry.path.toLowerCase()) || !actual ||
        !Number.isSafeInteger(entry.sizeBytes) || actual.sizeBytes !== entry.sizeBytes || actual.sha256 !== entry.sha256) fail('MANIFEST_MEMBER_MISMATCH');
    listed.add(entry.path.toLowerCase());
  }
  return {files, registry};
}

function windowsSnapshot(root) {
  if (process.platform !== 'win32') return null;
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !/^[A-Za-z]:\\/.test(systemRoot)) fail('WINDOWS_INSPECTION_UNAVAILABLE');
  const script = fileURLToPath(new URL('./windows-candidate-tree-inspection.ps1', import.meta.url));
  const output = execFileSync(path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Root', root],
    {encoding: 'utf8', windowsHide: true, timeout: 60_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  const result = JSON.parse(output.replace(/^\uFEFF/, ''));
  if (!keys(result, ['schemaVersion', 'entries']) || result.schemaVersion !== 'sylph.plain-candidate-tree.v1' ||
      !Array.isArray(result.entries) || result.entries.length > MAX_ENTRIES) fail('WINDOWS_INSPECTION_INVALID');
  return result.entries;
}
function snapshot(root) {
  const windows = windowsSnapshot(root), entries = [], registry = new Map();
  let current = path.parse(root).root;
  for (const part of path.relative(current, root).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('ROOT_NOT_PLAIN_DIRECTORY');
  }
  function visit(full, relative) {
    const stat = fs.lstatSync(full, {bigint: true});
    if (stat.isSymbolicLink() || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n))) fail('NOT_PLAIN_FILE');
    const kind = stat.isDirectory() ? 'directory' : 'file';
    if (relative) registerName(registry, relative, kind);
    entries.push({path: relative, kind, version: version(stat)});
    if (entries.length > MAX_ENTRIES) fail('ENTRY_LIMIT');
    if (stat.isDirectory()) {
      const directory = fs.opendirSync(full), names = [];
      try {
        for (let child; (child = directory.readSync()) !== null;) {
          if (names.length + entries.length >= MAX_ENTRIES) fail('ENTRY_LIMIT');
          names.push(child.name);
        }
      } finally { directory.closeSync(); }
      for (const name of names.sort()) visit(path.join(full, name), relative ? relative + '/' + name : name);
    }
  }
  visit(root, '');
  const sorted = entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (windows && JSON.stringify(windows) !== JSON.stringify(sorted.map(({path: p, kind}) => ({path: p, kind})))) fail('TREE_CHANGED');
  return sorted;
}

export function verifyExtractedCandidate({archive, identityFile, bundle, expected, extractedDirectory}) {
  // The entry point accepts artifacts and independent policy inputs only. Never
  // consume a saved verification receipt or trust the directory's manifest.
  const authenticated = verifyCandidateProvenance({archive, identityFile, bundle, expected});
  if (typeof extractedDirectory !== 'string' || !extractedDirectory) fail('ROOT_INVALID');
  const root = path.resolve(extractedDirectory);
  if (process.platform === 'win32' && !/^[A-Za-z]:\\/.test(root)) fail('ROOT_INVALID');
  const archived = readStable(archive, MAX_ARCHIVE);
  if (digest(archived.bytes) !== authenticated.identity.artifactSha256) fail('ARCHIVE_CHANGED');
  const inventory = archiveInventory(archived.bytes), before = snapshot(root);
  const expectedNames = [...inventory.registry.values()].map(({name, kind}) => ({path: name, kind})).sort((a, b) => a.path < b.path ? -1 : 1);
  if (JSON.stringify(before.filter(e => e.path).map(({path: p, kind}) => ({path: p, kind}))) !== JSON.stringify(expectedNames)) fail('INVENTORY_MISMATCH');
  const beforeByPath = new Map(before.map(entry => [entry.path, entry]));
  for (const member of inventory.files.values()) {
    const file = readStable(path.join(root, ...member.path.split('/')), MAX_FILE);
    if (file.bytes.length !== member.sizeBytes || digest(file.bytes) !== member.sha256 ||
        file.version !== beforeByPath.get(member.path).version) fail('FILE_MISMATCH');
  }
  if (JSON.stringify(before) !== JSON.stringify(snapshot(root)) ||
      digest(readStable(archive, MAX_ARCHIVE).bytes) !== authenticated.identity.artifactSha256) fail('TREE_OR_ARCHIVE_CHANGED');
  const files = [...inventory.files.values()].map(({path: p, sizeBytes, sha256}) => ({path: p, sizeBytes, sha256})).sort((a, b) => a.path < b.path ? -1 : 1);
  return Object.freeze({status: 'VERIFIED_EXTRACTED_CANDIDATE', candidateSubjectSha256: authenticated.identity.artifactSha256,
    inventoryRootSha256: digest(Buffer.from(JSON.stringify(files))), sourceCommitSha: authenticated.identity.sourceCommitSha,
    sourceTreeSha: authenticated.identity.sourceTreeSha, dependenciesVerified: false, loadedCodeVerified: false,
    runtimeAuthority: false, certificationGranted: false});
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [archive, identityFile, bundle, extractedDirectory, sourceCommitSha, sourceTreeSha, ...extra] = process.argv.slice(2);
    if (extra.length || !sourceTreeSha) throw new Error('Usage: node scripts/candidate-extracted-integrity.mjs ARCHIVE IDENTITY BUNDLE EXTRACTED_DIRECTORY EXPECTED_COMMIT EXPECTED_TREE');
    console.log(JSON.stringify(verifyExtractedCandidate({archive, identityFile, bundle, extractedDirectory, expected: {sourceCommitSha, sourceTreeSha}}), null, 2));
  } catch (error) { console.error(`Extracted candidate verification failed: ${error.code ?? error.message}`); process.exitCode = 1; }
}
