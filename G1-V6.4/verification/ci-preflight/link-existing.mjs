import assert from 'node:assert/strict';
import { linkSync, statSync } from 'node:fs';

const [existingFile, aliasPath, resultPath] = process.argv.slice(2);
assert.ok(existingFile && aliasPath && resultPath, 'LINK_ARGS_REQUIRED');
linkSync(existingFile, aliasPath);
const original = statSync(existingFile, { bigint: true });
const alias = statSync(aliasPath, { bigint: true });
assert.equal(String(original.dev), String(alias.dev));
assert.equal(String(original.ino), String(alias.ino));
assert.equal(Number(original.nlink), 2);
const result = {
  schema: 'SYLPH_G1_V64_PREEXISTING_LINK_1',
  originalFile: existingFile,
  aliasFile: aliasPath,
  volumeSerialHint: String(original.dev),
  fileIndexHint: String(original.ino),
  hardlinkCount: Number(original.nlink),
  sameObject: true,
};
(await import('node:fs')).writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
