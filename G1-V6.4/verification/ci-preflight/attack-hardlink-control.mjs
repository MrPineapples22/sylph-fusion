import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { closeSync, openSync, readFileSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [original, alias, reportPath] = process.argv.slice(2);
assert.ok(original && alias && reportPath, 'PATHS_REQUIRED');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');

let directDenied = false;
let directError = null;
try {
  const fd = openSync(original, 'r');
  closeSync(fd);
} catch (error) {
  directDenied = error?.code === 'ERR_ACCESS_DENIED';
  directError = error?.code ?? String(error?.message ?? error);
}
assert.equal(directDenied, true, `DIRECT_OUTSIDE_PATH_NOT_DENIED:${directError}`);

const beforeHash = hash(alias);
const fd = openSync(alias, 'r+');
const byte = Buffer.alloc(1);
readSync(fd, byte, 0, 1, 0);
const old = byte[0];
byte[0] ^= 1;
writeSync(fd, byte, 0, 1, 0);
const changedHash = hash(alias);
byte[0] = old;
writeSync(fd, byte, 0, 1, 0);
const restoredHash = hash(alias);
closeSync(fd);
assert.notEqual(changedHash, beforeHash, 'ALIAS_WRITE_DID_NOT_CHANGE_CONTENT');
assert.equal(restoredHash, beforeHash, 'ALIAS_RESTORE_FAILED');

const db = new DatabaseSync(alias, { readOnly: true });
const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
db.close();
assert.equal(integrity, 'ok');
const record = {
  schema: 'SYLPH_G1_V64_HARDLINK_ATTACK_1',
  processId: process.pid,
  user: execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim(),
  groups: execFileSync('whoami.exe', ['/groups', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim(),
  privileges: execFileSync('whoami.exe', ['/priv', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true }).trim(),
  requestedAccess: 'Node fs.openSync(alias, r+)',
  directPathDeniedByNodePolicy: directDenied,
  directPathError: directError,
  aliasWriteSucceeded: true,
  beforeSha256: beforeHash,
  changedSha256: changedHash,
  restoredSha256: restoredHash,
  integrityCheck: integrity,
  note: 'This proves the Node path-allowlist positive control, not a Windows ACL denial test.'
};
writeFileSync(reportPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(JSON.stringify({ schema: record.schema, processId: record.processId, aliasWriteSucceeded: true }));
