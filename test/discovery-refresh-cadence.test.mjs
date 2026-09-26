import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('DexScreener refresh cadence stays inside the discovery freshness fence', async () => {
  const source = await readFile(new URL('../src/market-hub.ts', import.meta.url), 'utf8');
  assert.match(source, /this\.loop\(\(\) => this\.dex\(\), 4000\)/);
});
