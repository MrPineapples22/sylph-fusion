import fs from 'node:fs';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const target = process.argv[2];
const whoami = execFileSync('whoami.exe', ['/user'], { encoding: 'utf8' });
const userSid = whoami.match(/S-1-\d+(?:-\d+)+/)?.[0] ?? null;
if (!userSid) {
  process.stderr.write('unable to identify test-user SID\n');
  process.exit(2);
}
if (!target) {
  process.stderr.write('target path required\n');
  process.exit(2);
}

try {
  fs.mkdirSync(target);
  process.stdout.write(JSON.stringify({ schema: 'SYLPH_G1_ROOT_WRITE_PROBE_1', result: 'CREATED', target, pid: process.pid, userSid }));
  process.exitCode = 1;
} catch (error) {
  const code = error && typeof error === 'object' ? error.code : undefined;
  if (code === 'EACCES' || code === 'EPERM') {
    process.stdout.write(JSON.stringify({ schema: 'SYLPH_G1_ROOT_WRITE_PROBE_1', result: 'ACCESS_DENIED', target, code, pid: process.pid, userSid }));
  } else {
    process.stderr.write(JSON.stringify({ schema: 'SYLPH_G1_ROOT_WRITE_PROBE_1', result: 'UNEXPECTED_ERROR', target, code, message: String(error), pid: process.pid, userSid }));
    process.exitCode = 2;
  }
}
