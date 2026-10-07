import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertDatabaseFilesystemPolicy, probeWindowsDriveType } from '../../dist/platform/storage/filesystem-policy.js';

test('Linux database startup rejects recognized network and clustered filesystems', () => {
  const cases = [
    [0x6969, 'NFS'], [0xff534d42, 'CIFS'], [0xfe534d42, 'SMB2'], [0x517b, 'SMB'],
    [0x00c36400, 'CEPH'], [0x5346414f, 'AFS'], [0x73757245, 'CODA'], [0x564c, 'NCP'],
    [0x01021997, '9P'], [0x7461636f, 'OCFS2'], [0x65735546, 'FUSE_UNVERIFIED'], [0x00c0ffee, 'HOSTFS'],
    [0x794c7630, 'OVERLAYFS_UNVERIFIED'],
  ];
  for (const [type, name] of cases) {
    assert.throws(
      () => assertDatabaseFilesystemPolicy('/database-parent', 'linux', () => ({ type })),
      new RegExp(`DATABASE_FILESYSTEM_UNSUPPORTED_SHARED:${name}`),
    );
  }
});

test('known Linux local filesystems are classified; unknown filesystems require explicit attestation', () => {
  for (const [type, filesystem] of [
    [0xef53, 'EXT2_3_4'], [0x9123683e, 'BTRFS'], [0xf2f52010, 'F2FS'],
    [0x58465342, 'XFS'], [0x3434, 'NILFS2'],
  ]) {
    assert.deepEqual(
      assertDatabaseFilesystemPolicy('/database-parent', 'linux', () => ({ type })),
      { status: 'LOCAL_FILESYSTEM_CLASSIFIED', filesystemType: type, filesystem },
    );
  }
  assert.throws(
    () => assertDatabaseFilesystemPolicy('/database-parent', 'linux', () => ({ type: 0x12345678 })),
    /DATABASE_FILESYSTEM_UNCLASSIFIED:LINUX:12345678/,
  );
  assert.deepEqual(
    assertDatabaseFilesystemPolicy('/database-parent', 'linux', () => ({ type: 0x12345678 }), undefined, undefined, { allowUnclassified: true }),
    { status: 'UNCLASSIFIED_FILESYSTEM', filesystemType: 0x12345678 },
  );
  assert.throws(() => assertDatabaseFilesystemPolicy('/database-parent', 'linux', () => { throw new Error('probe failed'); }), /DATABASE_FILESYSTEM_PROBE_FAILED/);
  assert.throws(() => assertDatabaseFilesystemPolicy('/database-parent', 'darwin', () => { throw new Error('must not probe'); }), /DATABASE_FILESYSTEM_PLATFORM_UNCLASSIFIED:darwin/);
  assert.deepEqual(
    assertDatabaseFilesystemPolicy('/database-parent', 'darwin', () => { throw new Error('must not probe'); }, undefined, undefined, { allowUnclassified: true }),
    { status: 'PLATFORM_UNCLASSIFIED' },
  );
});

test('Windows database paths reject network namespaces and fail closed on unknown drive types', () => {
  for (const path of [
    '\\\\server\\share\\database',
    '\\\\?\\UNC\\server\\share\\database',
    '\\\\.\\UNC\\server\\share\\database',
    '\\\\?\\GLOBALROOT\\Device\\Mup\\server\\share\\database',
    '\\??\\UNC\\server\\share\\database',
  ]) {
    assert.throws(
      () => assertDatabaseFilesystemPolicy('/unused', 'win32', undefined, () => 3, () => path),
      /DATABASE_FILESYSTEM_UNSUPPORTED_SHARED:WINDOWS_UNC/,
    );
  }

  for (const path of ['\\\\?\\C:\\database', '\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\database']) {
    assert.deepEqual(
      assertDatabaseFilesystemPolicy('/unused', 'win32', undefined, () => 3, () => path),
      { status: 'LOCAL_VOLUME_CLASSIFIED', driveType: 3 },
    );
  }

  assert.throws(() => assertDatabaseFilesystemPolicy('/unused', 'win32', undefined, () => 4, () => 'C:\\database'), /WINDOWS_REMOTE/);
  assert.throws(() => assertDatabaseFilesystemPolicy('/unused', 'win32', undefined, () => 0, () => 'C:\\database'), /DRIVE_TYPE_UNSUPPORTED:0/);
  assert.throws(() => assertDatabaseFilesystemPolicy('/unused', 'win32', undefined, () => 2, () => 'C:\\database'), /DRIVE_TYPE_UNSUPPORTED:2/);
});

test('Windows native volume probe recognizes this database directory as local', { skip: process.platform !== 'win32' }, () => {
  assert.equal(probeWindowsDriveType(process.cwd()), 3);
  assert.deepEqual(assertDatabaseFilesystemPolicy(process.cwd(), 'win32'), { status: 'LOCAL_VOLUME_CLASSIFIED', driveType: 3 });
});

test('Engine probes the created database directory before opening the SQLite Store', async () => {
  const source = await readFile(new URL('../../src/fusion.ts', import.meta.url), 'utf8');
  const probeAt = source.indexOf('const databaseFilesystem = assertDatabaseFilesystemPolicy(');
  const probePathAt = source.indexOf('dirname(resolve(cfg.DB_PATH))', probeAt);
  const storeAt = source.indexOf('store = new Store(resolve(cfg.DB_PATH))');
  assert.notEqual(probeAt, -1);
  assert.ok(probePathAt < storeAt, 'the filesystem probe runs before SQLite opens');
  assert.match(source, /allowUnclassified: cfg\.DATABASE_FILESYSTEM_OPERATOR_ATTESTATION === 'LOCAL_SINGLE_HOST_WAL_COMPATIBLE'/);
  assert.match(source, /log\('database_filesystem_operator_attestation'/);
});

test('Docker Compose places the engine database under its persistent data mount', async () => {
  const compose = await readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
  assert.match(compose, /^\s+- DB_PATH=\/app\/data\/fusion\.sqlite\s*$/m);
  assert.match(compose, /^\s+- \.\/data:\/app\/data\s*$/m);
});
