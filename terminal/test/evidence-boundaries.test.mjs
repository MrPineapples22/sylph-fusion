import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {capitalEvidence, marketContextEvidence, tokenEvidence} from '../evidence-view.mjs';
import {isLocalRequest, readCommand} from '../local-request.mjs';

test('terminal cannot attest wallet balances or signing without evidence', () => {
  const cap = capitalEvidence();
  assert.equal(cap.capitalStatus, 'UNVERIFIED');
  assert.equal(cap.vaultArmed, false);
  assert.equal(cap.signingGate.gateReady, false);
  assert.equal(cap.assuranceDeep.confirmedCapitalSol, null);
  assert.deepEqual(cap.positionSurvival.partialExitTested, []);
});

test('market context propagates observed health without inventing SOL price', () => {
  const context = marketContextEvidence({data: 'STALE', execution: 'OPEN_LOCKED'});
  assert.equal(context.sol_price_usd, null);
  assert.equal(context.data_health, 'STALE');
  assert.equal(context.execution_health, 'OPEN_LOCKED');
});

test('inspecting absent tokens cannot manufacture chain or holder evidence', () => {
  const data = tokenEvidence('mint', undefined, null);
  assert.equal(data.token, null);
  assert.equal(data.riskReport, null);
  assert.equal(data.distributionProvenance.buyerQuality, null);
  assert.deepEqual(data.capitalRegime.yieldQuotes, []);
});

test('local requests reject hostile or null origins even with loopback Host', () => {
  const req = {headers: {host: '127.0.0.1:8793'}};
  assert.equal(isLocalRequest(req, 8793), true);
  for (const origin of ['https://attacker.example', 'null', 'http://127.0.0.1:8794']) {
    assert.equal(isLocalRequest({headers: {...req.headers, origin}}, 8793), false);
  }
  assert.equal(isLocalRequest({headers: {...req.headers, origin: 'http://127.0.0.1:8793'}}, 8793), true);
});

function request(body, contentType = 'application/json') {
  const stream = Readable.from([Buffer.from(body)]);
  stream.headers = {'content-type': contentType};
  return stream;
}
const command = {commandId: 'operator-1', type: 'SET_AUTOMATION', timestamp: 123, initiator: 'test', payload: {enabled: false}};

test('command parser accepts a valid bounded envelope and rejects malformed input', async () => {
  assert.deepEqual(await readCommand(request(JSON.stringify(command))), command);
  for (const body of ['null', '[]', '{}', '{', JSON.stringify({...command, type: 'QUERY_STATE'})]) {
    await assert.rejects(readCommand(request(body)), {status: 400});
  }
  await assert.rejects(readCommand(request('{}', 'text/plain')), {status: 415});
  await assert.rejects(readCommand(request('x'.repeat(16_385))), {status: 413});
});
