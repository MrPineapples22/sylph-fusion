import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('operator terminal is bound to loopback and does not advertise LAN access', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /const host = '127\.0\.0\.1';/);
  assert.doesNotMatch(source, /TERMINAL_HOST \|\| '0\.0\.0\.0'/);
  assert.doesNotMatch(source, /Phone \/ Local LAN/);
});

test('terminal does not start market adapters or risk calls from implicit public endpoints', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(source, /const marketRpcUrl = process\.env\.MARKET_RPC_URL\?\.trim\(\) \|\| null/);
  assert.match(source, /const marketRugcheckUrl = process\.env\.RUGCHECK_URL\?\.trim\(\) \|\| null/);
  assert.match(source, /const marketDexUrl = process\.env\.DEXSCREENER_URL\?\.trim\(\) \|\| null/);
  assert.match(source, /const marketKolUrl = process\.env\.KOLSCAN_URL\?\.trim\(\) \|\| null/);
  assert.match(source, /const marketPumpUrl = process\.env\.PUMPPORTAL_WS_URL\?\.trim\(\) \|\| null/);
  assert.match(source, /if \(marketConfigured\) await hub\.start\(\)/);
  assert.match(source, /MARKET_ADAPTER_CONFIGURATION_UNAVAILABLE/);
  assert.doesNotMatch(source, /MARKET_RPC_URL\|\|'https:\/\/api\.mainnet-beta\.solana\.com'/);
  assert.doesNotMatch(source, /RUGCHECK_URL\|\|'https:\/\/api\.rugcheck\.xyz/);
});
