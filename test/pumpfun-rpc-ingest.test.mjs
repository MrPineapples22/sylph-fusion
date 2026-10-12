import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingest, rpc } from '../scripts/pumpfun-rpc-ingest.mjs';
import { verifyEvidence } from '../scripts/verify-pumpfun-evidence.mjs';

const programId = 'PumpProgramFixture';
const configFor = (outputDir, overrides = {}) => ({
  rpcUrl: 'https://rpc.example',
  programIds: [programId],
  outputDir,
  start: '2025-10-01T00:00:00Z',
  endExclusive: '2026-10-13T00:00:00Z',
  pageSize: 2,
  maxPagesPerProgram: 4,
  maxTransactions: 10,
  requestDelayMs: 0,
  ...overrides,
});

test('rejects insecure endpoints and invalid request bounds', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'sylph-pump-'));
  await assert.rejects(ingest(configFor(outputDir, { rpcUrl: 'http://rpc.example' })), /INVALID_CONFIG/);
  await assert.rejects(ingest(configFor(outputDir, { pageSize: 1001 })), /INVALID_CONFIG/);
});

test('captures hashed raw evidence and resumes without duplicate records', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'sylph-pump-'));
  const signatures = [{ signature: 'sig-a', slot: 42, blockTime: 1760000000 }];
  const calls = [];
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body);
    calls.push(request.method);
    const result = request.method === 'getSignaturesForAddress'
      ? signatures
      : { slot: 42, meta: { err: null }, transaction: { signatures: ['sig-a'] } };
    return { ok: true, json: async () => ({ result }) };
  };

  const first = await ingest(configFor(outputDir), { fetcher });
  assert.equal(first.fetchedThisRun, 1);
  assert.equal(first.decoderStatus, 'NOT_DECODED');
  assert.equal(first.liveAuthority, 'BLOCKED');
  assert.deepEqual(calls, ['getSignaturesForAddress', 'getTransaction']);
  const evidence = readFileSync(first.programs[programId].evidenceFile, 'utf8').trim().split('\n');
  assert.equal(evidence.length, 1);
  assert.match(JSON.parse(evidence[0]).sha256, /^[a-f0-9]{64}$/);

  const second = await ingest(configFor(outputDir), { fetcher });
  assert.equal(second.fetchedThisRun, 0);
  assert.equal(readFileSync(first.programs[programId].evidenceFile, 'utf8').trim().split('\n').length, 1);
});

test('retries transient RPC failures and rejects malformed checkpoints', async () => {
  let attempts = 0;
  const result = await rpc('https://rpc.example', 'getHealth', [], async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('temporary');
    return { ok: true, json: async () => ({ result: 'ok' }) };
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);

  const outputDir = mkdtempSync(join(tmpdir(), 'sylph-pump-'));
  const checkpoint = join(outputDir, `${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(programId).digest('hex').slice(0, 16))}.checkpoint.json`);
  writeFileSync(checkpoint, '{broken');
  await assert.rejects(ingest(configFor(outputDir), { fetcher: async () => { throw new Error('must not fetch'); } }));
});

test('does not advance past an unprocessed signature when a run cap is reached', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'sylph-pump-'));
  let transactionFetches = 0;
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'getSignaturesForAddress') {
      return { ok: true, json: async () => ({ result: [
        { signature: 'sig-a', slot: 42, blockTime: 1760000000 },
        { signature: 'sig-b', slot: 41, blockTime: 1760000001 },
      ] }) };
    }
    transactionFetches += 1;
    return { ok: true, json: async () => ({ result: { slot: 42, meta: { err: null } } }) };
  };
  const bounded = configFor(outputDir, { maxTransactions: 1, pageSize: 2 });
  await ingest(bounded, { fetcher });
  const followup = await ingest(configFor(outputDir), { fetcher });
  assert.equal(transactionFetches, 2);
  assert.equal(followup.programs[programId].storedTransactions, 2);
});

test('independent verifier detects evidence tampering and preserves blocked authority', async () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'sylph-pump-'));
  const fetcher = async (_url, options) => {
    const request = JSON.parse(options.body);
    const result = request.method === 'getSignaturesForAddress'
      ? [{ signature: 'sig-proof', slot: 42, blockTime: 1760000000 }]
      : { slot: 42, meta: { err: null } };
    return { ok: true, json: async () => ({ result }) };
  };
  const manifest = await ingest(configFor(outputDir), { fetcher });
  const valid = await verifyEvidence(outputDir);
  assert.equal(valid.integrity, 'PASS');
  assert.equal(valid.authority, 'BLOCKED');
  assert.equal(valid.transactionCount, 1);
  assert.equal(manifest.liveAuthority, 'BLOCKED');

  const evidencePath = manifest.programs[programId].evidenceFile;
  const record = JSON.parse(readFileSync(evidencePath, 'utf8'));
  record.transaction.meta.err = { InstructionError: [0, 'tampered'] };
  writeFileSync(evidencePath, `${JSON.stringify(record)}\n`);
  const tampered = await verifyEvidence(outputDir);
  assert.equal(tampered.integrity, 'FAIL');
  assert.ok(tampered.errors.some((error) => error.includes('HASH_MISMATCH')));
});
