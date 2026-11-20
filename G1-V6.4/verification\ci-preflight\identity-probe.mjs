import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const output = process.argv[2];
if (!output) throw new Error('IDENTITY_OUTPUT_REQUIRED');
const read = args => execFileSync('whoami.exe', args, { encoding: 'utf8', windowsHide: true });
const record = {
  schema: 'SYLPH_G1_V64_PROCESS_IDENTITY_1',
  processId: process.pid,
  executable: process.execPath,
  username: process.env.USERNAME ?? null,
  userDomain: process.env.USERDOMAIN ?? null,
  user: read(['/user', '/fo', 'csv', '/nh']).trim(),
  groups: read(['/groups', '/fo', 'csv', '/nh']).trim(),
  privileges: read(['/priv', '/fo', 'csv', '/nh']).trim(),
};
writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(JSON.stringify({ schema: record.schema, processId: record.processId, user: record.user }));
