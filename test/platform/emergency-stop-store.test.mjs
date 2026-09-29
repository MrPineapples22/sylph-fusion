import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, rmdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EmergencyStopStore} from '../../dist/platform/recovery/emergency-stop-store.js';

test('emergency stop record survives store recreation and keeps unknown legacy causes explicit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-stop-store-'));
  const file = join(directory, 'paper-emergency-stop.json');
  const record = Object.freeze({
    commandId: 'legacy-stop-migration',
    initiator: 'unknown',
    triggeredAt: 1790568252090,
    triggerType: 'LEGACY_UNKNOWN',
    reason: 'Cause not recorded by the prior runtime.',
  });
  try {
    await new EmergencyStopStore(file).save(record);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), record);
    assert.deepEqual(await new EmergencyStopStore(file).load(), record);
  } finally {
    await rm(file, {force: true});
    await rmdir(directory);
  }
});

test('malformed durable stop data fails startup closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-stop-store-invalid-'));
  const file = join(directory, 'paper-emergency-stop.json');
  try {
    await writeFile(file, '{invalid', 'utf8');
    await assert.rejects(new EmergencyStopStore(file).load(), /EMERGENCY_STOP_STORE_INVALID_JSON/);
  } finally {
    await rm(file, {force: true});
    await rmdir(directory);
  }
});
