import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('terminal validates the persistent data directory before opening its WAL database', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const createDirectoryAt = source.indexOf('mkdirSync(projectDataDir');
  const policyCheckAt = source.indexOf('const databaseFilesystem=assertDatabaseFilesystemPolicy(');
  const policyPathAt = source.indexOf('projectDataDir, process.platform', policyCheckAt);
  const openDatabaseAt = source.indexOf('new SQLiteExecutionAttemptStore(resolve(projectDataDir,\'economic-flight-recorder.sqlite\'))');

  assert.notEqual(createDirectoryAt, -1);
  assert.notEqual(policyCheckAt, -1);
  assert.notEqual(policyPathAt, -1);
  assert.notEqual(openDatabaseAt, -1);
  assert.ok(createDirectoryAt < policyCheckAt, 'the directory exists before the platform probe');
  assert.ok(policyPathAt < openDatabaseAt, 'filesystem policy runs before SQLite opens');
  assert.match(source, /allowUnclassified: databaseFilesystemAttestation === 'LOCAL_SINGLE_HOST_WAL_COMPATIBLE'/);
  assert.match(source, /const databaseRuntimeMode=process\.env\.SYLPH_RUNTIME_MODE\?\?process\.env\.MODE\?\?'paper'/);
  assert.match(source, /databaseFilesystemAttestation==='LOCAL_SINGLE_HOST_WAL_COMPATIBLE'&&databaseRuntimeMode!=='paper'/);
  assert.match(source, /DATABASE_FILESYSTEM_OPERATOR_ATTESTATION_PAPER_ONLY/);
  assert.match(source, /event:'database_filesystem_operator_attestation'.*mode:databaseRuntimeMode/);
});
