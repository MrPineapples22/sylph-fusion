import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarketCapabilities } from '../market-capabilities.mjs';

test('each configured market connector starts independently while features keep their own prerequisites', () => {
  const dex = resolveMarketCapabilities({ DEXSCREENER_URL: 'https://dex.example' });
  assert.equal(dex.hub, true);
  assert.equal(dex.discovery, true);
  assert.equal(dex.search, true);
  assert.equal(dex.risk, false);

  const pump = resolveMarketCapabilities({ PUMPPORTAL_WS_URL: 'wss://pump.example' });
  assert.equal(pump.hub, true);
  assert.equal(pump.discovery, true);
  assert.equal(pump.search, false);
  assert.equal(pump.risk, false);

  const risk = resolveMarketCapabilities({ MARKET_RPC_URL: 'https://rpc.example', RUGCHECK_URL: 'https://risk.example' });
  assert.equal(risk.hub, true);
  assert.equal(risk.discovery, false);
  assert.equal(risk.risk, true);

  const kol = resolveMarketCapabilities({ KOLSCAN_URL: 'https://kol.example' });
  assert.equal(kol.hub, true);
  assert.equal(kol.discovery, false);
  assert.equal(kol.risk, false);
});

test('risk capability requires both RPC and RugCheck; blank settings are unavailable', () => {
  assert.equal(resolveMarketCapabilities({ MARKET_RPC_URL: 'https://rpc.example' }).risk, false);
  assert.equal(resolveMarketCapabilities({ RUGCHECK_URL: 'https://risk.example' }).risk, false);
  const none = resolveMarketCapabilities({ DEXSCREENER_URL: ' ', PUMPPORTAL_WS_URL: '' });
  assert.equal(none.hub, false);
  assert.equal(none.discovery, false);
  assert.equal(none.search, false);
  assert.equal(none.risk, false);
});
