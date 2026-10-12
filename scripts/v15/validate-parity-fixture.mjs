import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function validateFixture(fixture) {
  const failures = [];
  const required = ['fixtureId', 'slot', 'signature', 'programId', 'programBinarySha256', 'accountSnapshotSha256', 'runtimeVersion', 'instruction', 'observed'];
  for (const key of required) if (fixture?.[key] === undefined || fixture?.[key] === null) failures.push('missing:' + key);
  if (!Number.isSafeInteger(fixture?.slot) || fixture.slot < 0) failures.push('invalid:slot');
  for (const key of ['programBinarySha256', 'accountSnapshotSha256']) {
    if (!/^[a-f0-9]{64}$/i.test(fixture?.[key] ?? '')) failures.push('invalid:' + key);
  }
  if (!Array.isArray(fixture?.instruction?.accountKeys)) failures.push('missing:instruction.accountKeys');
  if (typeof fixture?.instruction?.dataBase64 !== 'string') failures.push('missing:instruction.dataBase64');
  if (!Array.isArray(fixture?.observed?.accountDeltas)) failures.push('missing:observed.accountDeltas');
  for (const d of fixture?.observed?.accountDeltas ?? []) {
    if (!d.address || !/^-?\d+$/.test(d.lamportsDelta ?? '')) failures.push('invalid:accountDelta');
  }
  return failures;
}

export function compareDeltas(expected, actual) {
  const normalize = rows => new Map(rows.map(x => [x.address, BigInt(x.lamportsDelta)]));
  const e = normalize(expected), a = normalize(actual);
  const addresses = [...new Set([...e.keys(), ...a.keys()])].sort();
  return addresses.filter(address => (e.get(address) ?? 0n) !== (a.get(address) ?? 0n))
    .map(address => ({ address, expected: String(e.get(address) ?? 0n), actual: String(a.get(address) ?? 0n) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/v15/validate-parity-fixture.mjs fixture.json'); process.exit(2); }
  const bytes = readFileSync(file);
  const fixture = JSON.parse(bytes.toString('utf8'));
  const failures = validateFixture(fixture);
  console.log(JSON.stringify({ fixture: file, sha256: createHash('sha256').update(bytes).digest('hex'), status: failures.length ? 'BLOCKED' : 'SCHEMA_VALID_ONLY', failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}
