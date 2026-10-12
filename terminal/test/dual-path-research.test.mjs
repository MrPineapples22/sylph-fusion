import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {handleDualPathResearchRequest} from '../dual-path-research.mjs';

const route = '/api/research/dual-path/reconcile';

async function withResearchServer(t) {
  const server = createServer((req, res) => {
    if (req.url !== route) {
      res.writeHead(404);
      res.end();
      return;
    }
    void handleDualPathResearchRequest(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  return `http://127.0.0.1:${server.address().port}${route}`;
}

function evidencePair({logAmountOut = '50'} = {}) {
  return {
    instruction: {
      protocol: 'PUMP_FUN', programId: 'program', instructionIndex: 0,
      tokenMint: 'mint', userPubkey: 'user', discriminator: 'buy',
      rawAmountIn: '100', rawAmountOut: '50', slot: 10, signature: 'sig', isSuccess: true,
    },
    log: {
      protocol: 'PUMP_FUN', programId: 'program', logIndex: 0,
      tokenMint: 'mint', userPubkey: 'user', logDiscriminator: 'buy',
      rawAmountIn: '100', rawAmountOut: logAmountOut, logMessage: 'source log',
      slot: 10, signature: 'sig', isSuccess: true,
    },
  };
}

test('research endpoint returns an explicitly unauthenticated dual-path match', async t => {
  const url = await withResearchServer(t);
  const response = await fetch(url, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(evidencePair()),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.evidenceStatus, 'CALLER_SUPPLIED_UNAUTHENTICATED');
  assert.equal(body.authority, 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY');
  assert.equal(body.report.status, 'UNIFIED_MATCH');
  assert.equal(body.report.reconciledAmountIn, '100');
  assert.equal(body.certificate.evidenceSource, 'CALLER_SUPPLIED_UNAUTHENTICATED');
});

test('research endpoint preserves both records and withholds amounts on conflict', async t => {
  const url = await withResearchServer(t);
  const response = await fetch(url, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(evidencePair({logAmountOut: '51'})),
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.report.status, 'DISCREPANCY_CONFLICT');
  assert.equal(body.report.isConflicted, true);
  assert.equal(body.report.reconciledAmountOut, null);
  assert.equal(body.report.instructionEvidence.rawAmountOut, '50');
  assert.equal(body.report.logEvidence.rawAmountOut, '51');
});

test('research endpoint rejects unsafe amount forms and oversized bodies', async t => {
  const url = await withResearchServer(t);
  const invalidAmount = evidencePair();
  invalidAmount.instruction.rawAmountIn = 100;
  const invalidResponse = await fetch(url, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(invalidAmount),
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json()).error, /unsigned decimal string/);

  const oversizedResponse = await fetch(url, {
    method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({log: {logMessage: 'x'.repeat(17_000)}}),
  });
  assert.equal(oversizedResponse.status, 413);
});

test('research endpoint requires JSON and POST', async t => {
  const url = await withResearchServer(t);
  const contentTypeResponse = await fetch(url, {method: 'POST', body: '{}'});
  assert.equal(contentTypeResponse.status, 415);
  const methodResponse = await fetch(url, {method: 'GET'});
  assert.equal(methodResponse.status, 405);
});
