import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Solana-Only Blueprint: server.mjs registers and handles all 11 architectural endpoints', async () => {
  const source = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');

  // Verify all 11 Solana routes are present in livePaths
  const requiredRoutes = [
    '/api/solana/protocol-leases',
    '/api/solana/sensor-tournament',
    '/api/solana/transport-tournament',
    '/api/solana/arbitrage-cycles',
    '/api/solana/capacity-curve',
    '/api/solana/strategy-ecology',
    '/api/solana/market-making',
    '/api/solana/planner-voi',
    '/api/solana/market-twin-residuals',
    '/api/solana/engineering-ledger',
    '/api/solana/alpha-factory',
  ];

  for (const route of requiredRoutes) {
    assert.ok(source.includes(`'${route}'`), `livePaths must include ${route}`);
    assert.ok(source.includes(`reqUrl.pathname === '${route}'`), `Route handler must exist for ${route}`);
  }

  // Verify all 10 protocols are registered by default
  const requiredProtocols = [
    'PUMP_FUN',
    'PUMP_SWAP',
    'RAYDIUM_AMM',
    'RAYDIUM_CPMM',
    'RAYDIUM_CLMM',
    'METEORA_DLMM',
    'METEORA_DAMM',
    'ORCA_WHIRLPOOL',
    'JUPITER_ROUTING',
    'PHOENIX_CLOB',
  ];

  for (const proto of requiredProtocols) {
    assert.ok(source.includes(`protocolName: '${proto}'`), `Default leases must seed ${proto}`);
  }

  // Verify Section 45 Alpha Factory invariant in server handler
  assert.match(source, /All strategies compete\. None directly owns execution authority\./);
  assert.match(source, /Which Solana opportunity currently has the highest independently verified/);
});
