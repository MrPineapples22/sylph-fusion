import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../dist/config.js';

test('core configuration never supplies a public RugCheck fallback', () => {
  const cfg = config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://one.invalid',
  });
  assert.equal(cfg.RUGCHECK_URL, '');
});

test('core configuration never supplies a public Jupiter routing fallback', () => {
  const cfg = config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://one.invalid',
  });
  assert.equal(cfg.JUPITER_URL, '');
});

test('unclassified database filesystem attestation is paper-only and explicit', () => {
  const base = { RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' };
  assert.equal(config(base).DATABASE_FILESYSTEM_OPERATOR_ATTESTATION, '');
  assert.equal(config({ ...base, DATABASE_FILESYSTEM_OPERATOR_ATTESTATION: 'LOCAL_SINGLE_HOST_WAL_COMPATIBLE' }).DATABASE_FILESYSTEM_OPERATOR_ATTESTATION, 'LOCAL_SINGLE_HOST_WAL_COMPATIBLE');
  assert.throws(() => config({
    ...base,
    MODE: 'live',
    KEYPAIR_PATH: 'unused-by-test',
    DATABASE_FILESYSTEM_OPERATOR_ATTESTATION: 'LOCAL_SINGLE_HOST_WAL_COMPATIBLE',
  }), /attestation is paper-only/);
  assert.throws(() => config({ ...base, DATABASE_FILESYSTEM_OPERATOR_ATTESTATION: 'true' }));
});

test('configured RugCheck endpoints must be HTTPS', () => {
  assert.throws(() => config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://one.invalid',
    RUGCHECK_URL: 'http://risk.invalid',
  }));
});

test('database config rejects Windows UNC shares but permits local drive paths', t => {
  if (process.platform !== 'win32') {
    t.skip('Windows UNC classification is platform-specific');
    return;
  }
  const base = { RPC_URLS: 'https://one.invalid,https://two.invalid', WS_URLS: 'wss://one.invalid' };
  for (const DB_PATH of [
    '\\\\server\\share\\fusion.sqlite',
    '//server/share/fusion.sqlite',
    '\\\\?\\UNC\\server\\share\\fusion.sqlite',
    '\\\\.\\UNC\\server\\share\\fusion.sqlite',
    '\\\\?\\GLOBALROOT\\Device\\Mup\\server\\share\\fusion.sqlite',
    '\\??\\UNC\\server\\share\\fusion.sqlite',
  ]) {
    assert.throws(() => config({ ...base, DB_PATH }), /local filesystem|UNC paths/i);
  }
  for (const DB_PATH of ['fusion.sqlite', 'C:\\data\\fusion.sqlite', '\\\\?\\C:\\data\\fusion.sqlite', '\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\data\\fusion.sqlite']) {
    assert.equal(config({ ...base, DB_PATH }).DB_PATH, DB_PATH);
  }
});
