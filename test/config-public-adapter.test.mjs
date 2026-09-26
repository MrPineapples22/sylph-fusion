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

test('configured RugCheck endpoints must be HTTPS', () => {
  assert.throws(() => config({
    RPC_URLS: 'https://one.invalid,https://two.invalid',
    WS_URLS: 'wss://one.invalid',
    RUGCHECK_URL: 'http://risk.invalid',
  }));
});
