import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { serveNexusResearchUnavailable } from '../nexus-research-response.mjs';

test('disconnected Nexus interface cannot report fabricated probability or entry authority', async t => {
  const server = createServer((_req, res) => serveNexusResearchUnavailable(res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/nexus_mx`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.reason, 'NEXUS_CERTIFICATE_PRODUCER_NOT_CONNECTED');
  assert.equal(body.runtimeAuthority, 'NONE');
  assert.equal(body.executionAuthorized, false);
  assert.equal(body.totalEvaluated, 0);
  assert.deepEqual(body.candidates, []);
  assert.doesNotMatch(JSON.stringify(body), /ENTER_ELIGIBLE|barrierProbabilities|capturabilityScore/);
});

test('terminal Nexus route delegates to the tested unavailable response', async () => {
  const server = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  const route = server.slice(server.indexOf("reqUrl.pathname === '/api/nexus_mx'"), server.indexOf("reqUrl.pathname === '/api/discovery'"));
  assert.match(route, /serveNexusResearchUnavailable\(res\)/);
  assert.doesNotMatch(route, /hub\.snapshot|ENTER_ELIGIBLE|Math\./);
});
