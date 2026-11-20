import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { linkSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const [originalRoot, aliasRoot] = process.argv.slice(2);
assert.ok(originalRoot && aliasRoot, 'ROOTS_REQUIRED');
mkdirSync(originalRoot, { recursive: true });
mkdirSync(aliasRoot, { recursive: true });
const original = path.join(originalRoot, 'legacy.sqlite');
const alias = path.join(aliasRoot, 'in-scope-alias.sqlite');
const db = new DatabaseSync(original);
db.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO fixture(value) VALUES (\'before\'); CREATE TABLE effects(request_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL); PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
db.close();
linkSync(original, alias);
const a = statSync(original, { bigint: true });
const b = statSync(alias, { bigint: true });
assert.equal(String(a.dev), String(b.dev));
assert.equal(String(a.ino), String(b.ino));
assert.equal(Number(a.nlink), 2);
process.stdout.write(JSON.stringify({
  schema: 'SYLPH_G1_V64_HARDLINK_CONTROL_1',
  original,
  alias,
  device: String(a.dev),
  fileIndex: String(a.ino),
  linkCount: Number(a.nlink),
  sameObject: true,
}));
