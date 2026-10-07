import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireResearchSpoolLock, assertPaperRuntime, closeEngineResources, derivePaperExecutionWallet, engineLockPort, researchSpoolLockPort } from '../dist/fusion.js';

test('engine startup rejects every non-paper runtime before transport or signer setup', () => {
  assert.doesNotThrow(() => assertPaperRuntime({ MODE: 'paper' }));
  assert.throws(
    () => assertPaperRuntime({ MODE: 'live' }),
    /PAPER_ONLY_RUNTIME: live execution is unavailable in this build/,
  );
});

test('explicit paper seed creates a distinct wallet and engine lock identity without enabling live runtime', () => {
  const defaultWallet = derivePaperExecutionWallet({ MODE: 'paper' });
  const isolatedWallet = derivePaperExecutionWallet({ MODE: 'paper' }, new Uint8Array(32).fill(11));

  assert.notEqual(isolatedWallet.publicKey.toBase58(), defaultWallet.publicKey.toBase58());
  assert.notEqual(engineLockPort(isolatedWallet.publicKey), engineLockPort(defaultWallet.publicKey));
  assert.equal(defaultWallet.publicKey.toBase58(), 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB');
  assert.throws(
    () => derivePaperExecutionWallet({ MODE: 'paper' }, new Uint8Array(31)),
    /PAPER_WALLET_SEED_INVALID/,
  );
  assert.throws(
    () => derivePaperExecutionWallet({ MODE: 'live' }, new Uint8Array(32).fill(11)),
    /PAPER_ONLY_RUNTIME/,
  );
});

test('research spool process lease keys and exclusively holds the resolved path independently of wallet identity', async t => {
  const spoolPath = './runtime/fusion.sqlite.research-spool.jsonl';
  const port = researchSpoolLockPort(spoolPath);
  assert.equal(port, researchSpoolLockPort(spoolPath));
  assert.ok(port >= 50_000 && port < 60_000);
  assert.notEqual(port, engineLockPort(derivePaperExecutionWallet({ MODE: 'paper' }).publicKey));
  assert.throws(() => researchSpoolLockPort(''), /RESEARCH_SPOOL_LOCK_PATH_INVALID/);
  assert.throws(() => researchSpoolLockPort('x'.repeat(4097)), /RESEARCH_SPOOL_LOCK_PATH_INVALID/);

  const first = await acquireResearchSpoolLock(spoolPath);
  t.after(async () => { if (first.listening) await new Promise(resolve => first.close(resolve)); });
  await assert.rejects(acquireResearchSpoolLock(spoolPath), { code: 'EADDRINUSE' });

  const dir = mkdtempSync(join(tmpdir(), 'sylph-spool-lock-process-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const childScript = join(dir, 'attempt-lock.mjs');
  const fusionUrl = pathToFileURL(join(process.cwd(), 'dist/fusion.js')).href;
  writeFileSync(childScript, `
    import { acquireResearchSpoolLock } from ${JSON.stringify(fusionUrl)};
    try {
      const lock = await acquireResearchSpoolLock(process.argv[2]);
      await new Promise(resolve => lock.close(resolve));
      process.exitCode = 0;
    } catch (error) {
      process.exitCode = error?.code === 'EADDRINUSE' ? 23 : 24;
    }
  `);
  const deniedChild = spawnSync(process.execPath, [childScript, spoolPath], { encoding: 'utf8' });
  assert.equal(deniedChild.status, 23, deniedChild.stderr || deniedChild.error?.message);

  await new Promise(resolve => first.close(resolve));
  const admittedChild = spawnSync(process.execPath, [childScript, spoolPath], { encoding: 'utf8' });
  assert.equal(admittedChild.status, 0, admittedChild.stderr || admittedChild.error?.message);
  const afterRelease = await acquireResearchSpoolLock(spoolPath);
  t.after(async () => new Promise(resolve => afterRelease.close(resolve)));
});

test('engine cleanup releases spool and wallet leases even when other close operations reject', async t => {
  const spoolLock = await acquireResearchSpoolLock('./runtime/cleanup-failure.sqlite.research-spool.jsonl');
  t.after(async () => { if (spoolLock.listening) await new Promise(resolve => spoolLock.close(resolve)); });
  const walletLock = createServer();
  await new Promise((resolve, reject) => {
    walletLock.once('error', reject);
    walletLock.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  t.after(async () => { if (walletLock.listening) await new Promise(resolve => walletLock.close(resolve)); });
  const walletPort = walletLock.address().port;
  const calls = [];
  const stopSignalHandler = () => {};
  process.once('SIGINT', stopSignalHandler);
  process.once('SIGTERM', stopSignalHandler);
  t.after(() => {
    process.removeListener('SIGINT', stopSignalHandler);
    process.removeListener('SIGTERM', stopSignalHandler);
  });

  await assert.rejects(closeEngineResources({
    dashboard: { close: async () => { calls.push('dashboard'); throw new Error('dashboard close failed'); } },
    store: { close: async () => { calls.push('store'); } },
    sessionLogger: { close: async () => { calls.push('sessionLogger'); throw new Error('logger close failed'); } },
    researchSpoolLock: spoolLock,
    walletLock,
    stopSignalHandler,
  }), error => error instanceof AggregateError && error.message === 'ENGINE_RESOURCE_CLEANUP_FAILED' && error.errors.length === 2);

  assert.deepEqual(calls, ['dashboard', 'store', 'sessionLogger']);
  assert.equal(spoolLock.listening, false);
  assert.equal(walletLock.listening, false);
  assert.equal(process.listeners('SIGINT').includes(stopSignalHandler), false);
  assert.equal(process.listeners('SIGTERM').includes(stopSignalHandler), false);
  const replacementSpoolLock = await acquireResearchSpoolLock('./runtime/cleanup-failure.sqlite.research-spool.jsonl');
  await new Promise(resolve => replacementSpoolLock.close(resolve));
  const replacementWalletLock = createServer();
  await new Promise((resolve, reject) => {
    replacementWalletLock.once('error', reject);
    replacementWalletLock.listen({ host: '127.0.0.1', port: walletPort, exclusive: true }, resolve);
  });
  await new Promise(resolve => replacementWalletLock.close(resolve));
});
