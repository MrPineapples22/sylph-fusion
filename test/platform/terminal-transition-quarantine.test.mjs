import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DurableGenerationFenceAuthority } from '../../dist/platform/execution/durable-generation-fence.js';
import { NoLandVerificationAuthority } from '../../dist/platform/execution/no-land-certificate.js';

const fields = {
  intentId: 'terminal-held', generation: 1, signature: 'expected-signature',
  slot: 10, feeLamports: 5000n, status: 'SUCCESS', tokenDelta: 0n, solDelta: -5000n,
};
function fabricated(overrides = {}) {
  const values = { ...fields, ...overrides };
  return { ...values, certificateType: 'FINALIZED_SETTLEMENT_CERTIFICATE', finalizedAt: 0,
    proofDigest: NoLandVerificationAuthority.computeSettlementDigest(values) };
}

test('settlement issuer rejects complete, malformed and unrelated caller assertions', () => {
  for (const supplied of [fields, { ...fields, signature: 'unrelated' }, { ...fields, slot: -1 },
    { ...fields, slot: NaN }, { ...fields, feeLamports: -1n }, {}, null, undefined]) {
    assert.throws(() => NoLandVerificationAuthority.certifySettlement(supplied), /SETTLEMENT_CERTIFICATION_UNAVAILABLE/);
  }
});

test('checksum-valid settlement and raw confirmation cannot advance, release or reset an existing generation', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-terminal-'));
  try {
    const storage = join(folder, 'fences.json');
    const fence = new DurableGenerationFenceAuthority(storage);
    const first = await fence.acquireInitialGeneration(fields.intentId, fields.signature, 100);
    const before = await readFile(storage, 'utf8');
    for (const overrides of [{}, { signature: 'unrelated-signature' }, { intentId: 'other' }, { generation: 99 }]) {
      const record = fabricated(overrides);
      assert.equal(NoLandVerificationAuthority.validateCertificateDigest(record), true);
      await assert.rejects(fence.advanceGeneration(fields.intentId, 'next', 200, record), /TERMINAL_TRANSITION_UNAVAILABLE/);
    }
    await assert.rejects(fence.advanceGeneration(fields.intentId, 'next', 200, { ...fabricated(), proofDigest: 'fabricated' }), /TERMINAL_TRANSITION_UNAVAILABLE/);
    await assert.rejects(fence.confirmGeneration(fields.intentId, 1), /TERMINAL_TRANSITION_UNAVAILABLE/);
    await assert.rejects(fence.acquireInitialGeneration(fields.intentId, 'replacement', 200), /GENERATION_ALREADY_ACTIVE/);

    // Independent object instances concurrently attempt the formerly unsafe paths.
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => {
      const other = new DurableGenerationFenceAuthority(storage);
      if (i % 3 === 0) return other.confirmGeneration(fields.intentId, 1);
      if (i % 3 === 1) return other.advanceGeneration(fields.intentId, 'next', 200, fabricated());
      return other.acquireInitialGeneration(fields.intentId, 'replacement', 200);
    }));
    assert.ok(results.every(result => result.status === 'rejected'));
    assert.deepEqual(await fence.getActiveGeneration(fields.intentId), first);
    assert.equal(await readFile(storage, 'utf8'), before);

    // A genuinely fresh process cannot clear the tombstone through confirmation.
    const moduleUrl = new URL('../../dist/platform/execution/durable-generation-fence.js', import.meta.url).href;
    const script = `
      const { DurableGenerationFenceAuthority } = await import(process.argv[2]);
      const fence = new DurableGenerationFenceAuthority(process.argv[1]);
      const errors = [];
      for (const operation of [
        () => fence.confirmGeneration('terminal-held', 1),
        () => fence.acquireInitialGeneration('terminal-held', 'replacement', 200),
      ]) {
        try { await operation(); errors.push('UNEXPECTED_ACCEPTANCE'); }
        catch (error) { errors.push(error.message); }
      }
      process.stdout.write(JSON.stringify(errors));
    `;
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--input-type=module', '-e', script, storage, moduleUrl], { timeout: 10000 });
    const errors = JSON.parse(stdout);
    assert.match(errors[0], /TERMINAL_TRANSITION_UNAVAILABLE/);
    assert.match(errors[1], /GENERATION_ALREADY_ACTIVE/);
    assert.equal(await readFile(storage, 'utf8'), before);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('persisted historical states are tombstones and cannot be reinitialized', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-terminal-history-'));
  try {
    const storage = join(folder, 'fences.json');
    for (const state of ['CONFIRMED', 'SUPERSEDED', 'EXPIRED', 'UNKNOWN_LEGACY']) {
      const historical = { intentId: fields.intentId, generation: 7, signature: 'historic',
        lastValidBlockHeight: 100, state, createdAt: 1, updatedAt: 2 };
      const before = JSON.stringify({ entries: { [fields.intentId]: historical } });
      await writeFile(storage, before);
      const fence = new DurableGenerationFenceAuthority(storage);
      await assert.rejects(fence.confirmGeneration(fields.intentId, 7), /TERMINAL_TRANSITION_UNAVAILABLE/);
      await assert.rejects(fence.acquireInitialGeneration(fields.intentId, 'replacement', 200), /INTENT_ALREADY_REGISTERED/);
      await assert.rejects(fence.advanceGeneration(fields.intentId, 'next', 200, fabricated({ generation: 7 })), /TERMINAL_TRANSITION_UNAVAILABLE/);
      assert.equal(await readFile(storage, 'utf8'), before);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('reserved and malformed intent IDs never create disappearing generation records', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'sylph-intent-identity-'));
  try {
    const storage = join(folder, 'fences.json');
    const fence = new DurableGenerationFenceAuthority(storage);
    const rejectedIds = ['__proto__', 'constructor', 'prototype', 'Constructor', 'PROTOTYPE',
      '', ' ', ' leading', 'trailing ', 'trailing\n', 'line\nbreak', 'nul\0byte', 'a/b', 'a\\b',
      'économic', 'x'.repeat(257), null, undefined, 1, {}, ['intent']];
    for (const intentId of rejectedIds) {
      await assert.rejects(fence.acquireInitialGeneration(intentId, 'sig', 100), /INVALID_INTENT_ID/);
      await assert.rejects(new DurableGenerationFenceAuthority(storage).acquireInitialGeneration(intentId, 'sig', 100), /INVALID_INTENT_ID/);
    }
    await assert.rejects(readFile(storage), error => error.code === 'ENOENT');

    // Valid boundary identities survive JSON encoding and remain tombstoned.
    for (const intentId of ['a', 'intent.valid-1:part_2', 'x'.repeat(256)]) {
      await fence.acquireInitialGeneration(intentId, 'sig', 100);
      const persisted = JSON.parse(await readFile(storage, 'utf8'));
      assert.ok(Object.hasOwn(persisted.entries, intentId));
      assert.equal(persisted.entries[intentId].intentId, intentId);
      await assert.rejects(new DurableGenerationFenceAuthority(storage).acquireInitialGeneration(intentId, 'again', 200), /GENERATION_ALREADY_ACTIVE/);
    }
    const before = await readFile(storage, 'utf8');
    const moduleUrl = new URL('../../dist/platform/execution/durable-generation-fence.js', import.meta.url).href;
    const script = `
      const { DurableGenerationFenceAuthority } = await import(process.argv[2]);
      const fence = new DurableGenerationFenceAuthority(process.argv[1]);
      const errors = [];
      for (const id of ['__proto__', 'constructor', 'prototype', 'a']) {
        try { await fence.acquireInitialGeneration(id, 'again', 200); errors.push('UNEXPECTED_ACCEPTANCE'); }
        catch (error) { errors.push(error.message); }
      }
      process.stdout.write(JSON.stringify(errors));
    `;
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--input-type=module', '-e', script, storage, moduleUrl], { timeout: 10000 });
    const errors = JSON.parse(stdout);
    for (const error of errors.slice(0, 3)) assert.match(error, /INVALID_INTENT_ID/);
    assert.match(errors[3], /GENERATION_ALREADY_ACTIVE/);
    assert.equal(await readFile(storage, 'utf8'), before);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
