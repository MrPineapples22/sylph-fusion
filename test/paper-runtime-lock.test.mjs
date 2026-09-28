import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPaperRuntime, derivePaperExecutionWallet, engineLockPort } from '../dist/fusion.js';

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
