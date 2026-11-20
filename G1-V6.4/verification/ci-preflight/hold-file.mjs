import assert from 'node:assert/strict';
import { openSync, closeSync, writeFileSync, existsSync, readSync, writeSync, fsyncSync } from 'node:fs';

const [target, readyPath, releasePath, completionPath] = process.argv.slice(2);
assert.ok(target && readyPath && releasePath && completionPath, 'HOLD_ARGS_REQUIRED');
const handle = openSync(target, 'r+');
writeFileSync(readyPath, JSON.stringify({ schema: 'SYLPH_G1_V64_RETAINED_HANDLE_1', pid: process.pid, target }), { flag: 'wx' });
const until = Date.now() + 120_000;
while (!existsSync(releasePath)) {
  if (Date.now() > until) throw new Error('HANDLE_HOLD_TIMEOUT');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
const byte = Buffer.alloc(1);
readSync(handle, byte, 0, 1, 0);
const originalByte = byte[0];
const writtenByte = originalByte ^ 1;
writeSync(handle, Buffer.from([writtenByte]), 0, 1, 0);
fsyncSync(handle);
closeSync(handle);
writeFileSync(completionPath, JSON.stringify({
  schema: 'SYLPH_G1_V64_RETAINED_HANDLE_RESULT_1',
  processId: process.pid,
  target,
  originalByte,
  writtenByte,
  changed: originalByte !== writtenByte,
  closed: true,
}));
process.stdout.write(JSON.stringify({ changed: true, closed: true }));
