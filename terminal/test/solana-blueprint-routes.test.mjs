import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Solana research endpoints retain their route contracts without claiming absent evidence', async () => {
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

  // These are architecture placeholders, not connected data products. Guard
  // against accidentally restoring fabricated protocol or market evidence.
  assert.doesNotMatch(source, /defaultSolanaLeases|hash_[\w]+_certified|protocolName: 'PUMP_SWAP'/);
  assert.doesNotMatch(source, /solanaArbitrageGraph\.addEdge|cumulativeGainSol:\s*10|grossEdgeBps:\s*180/);
  assert.match(source, /AUTHENTICATED_PROTOCOL_LEASE_SOURCE_NOT_CONNECTED/);
  assert.match(source, /IDENTIFIED_POOL_QUOTES/);
  assert.match(source, /EXECUTABLE_QUOTE_LIQUIDITY_FALLBACK_AND_TIP_EVIDENCE/);
  assert.match(source, /evidenceStatus:\s*'UNAVAILABLE'/);
  assert.match(source, /executionEligible:\s*false/);
  assert.match(source, /entryDecision:\s*'NOT_EVALUATED'/);
  assert.match(source, /economicValueState:\s*'UNKNOWN'/);
  assert.match(source, /speciesListStatus:\s*'DECLARED_TYPES_ONLY_NOT_WIRED'/);

  // Verify Section 45 Alpha Factory invariant in server handler
  assert.match(source, /All strategies compete\. None directly owns execution authority\./);
  assert.match(source, /unimplementedDesignQuestion:/);
  assert.match(source, /registeredClaimsCount:\s*solanaAlphaFactory\.getClaimCount\(\)/);
});
