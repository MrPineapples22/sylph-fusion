import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  MasterIntelligenceEngine,
  buildAstraFeatureObservations,
} from '../../dist/intelligence/master-orchestrator.js';
import {
  FEATURE_DEFINITIONS,
  observationIssue,
} from '../../dist/intelligence/astra/features.js';
import {
  handleJevShadowProjectionRequest,
  handleJevEvaluationRequest,
  handleJevHostedStatusRequest,
} from '../../terminal/jev-research.mjs';

function mockIncomingMessage({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1:8793',
    ...headers,
  };
  req.socket = { remoteAddress: '127.0.0.1' };
  req[Symbol.asyncIterator] = async function* () {
    if (body) {
      yield Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    }
  };
  return req;
}

function mockServerResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(code, headers) {
      res.statusCode = code;
      Object.assign(res.headers, headers);
      return res;
    },
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
    end(chunk) {
      if (chunk) res.body += chunk;
      return res;
    },
  };
  return res;
}

test('Pass 68 - buildAstraFeatureObservations generates 16 schema-compliant certified observations', () => {
  const now = 1_800_000_000_000;
  const observations = buildAstraFeatureObservations('test-mint', {}, now);
  assert.equal(observations.length, 16);
  assert.equal(observations.length, Object.keys(FEATURE_DEFINITIONS).length);

  for (const obs of observations) {
    const issue = observationIssue(obs, now);
    assert.equal(issue, null, `Observation ${obs.name} has issue: ${issue}`);
    assert.equal(obs.source, 'master-orchestrator-pit');
    assert.equal(obs.conflict, false);
    assert.ok(obs.confidence >= 0.9);
  }
});

test('Pass 68 - MasterIntelligenceEngine evaluates JEV shadow lane with hash-chain integrity', () => {
  const engine = new MasterIntelligenceEngine();
  const now = 1_800_000_000_000;

  const firstRecord = engine.evaluateJevShadow('alpha-token', { price_velocity: 0.02, buy_sell_ratio: 5 }, now);
  assert.equal(firstRecord.authority, 'ADVISORY_ONLY');
  assert.equal(firstRecord.executionAuthorized, false);
  assert.equal(firstRecord.decision.tokenId, 'alpha-token');
  assert.equal(firstRecord.decision.evidenceCoverage, 1.0);
  assert.ok(['HIGH_INTEREST', 'WATCH', 'LOW_INTEREST'].includes(firstRecord.decision.classification));
  assert.equal(firstRecord.certificates.length, 2);

  const secondRecord = engine.evaluateJevShadow('beta-token', { price_velocity: 0.01 }, now + 10);
  assert.equal(secondRecord.previousHash, firstRecord.recordHash);

  const projection = engine.getJevShadowProjection();
  assert.ok(projection.totalRecords >= 2);
  assert.equal(projection.chainHead, secondRecord.recordHash);
  assert.equal(engine.getJevShadowLane().verifyRetainedChain(), true);
});

test('Pass 68 - processEvent attaches JEV advisory record and viewModel telemetry', async () => {
  const engine = new MasterIntelligenceEngine();
  const event = {
    eventId: 'evt_jev_pass68_001',
    slot: 280_000_000,
    sourceTimestampMs: Date.now() - 50,
    receivedTimestampMs: Date.now(),
    mint: 'So11111111111111111111111111111111111111112',
    signature: '5K3Mh...jevPass68Sig',
    type: 'SWAP',
    payload: { amountSol: 1.5 },
  };

  const context = {
    tokenAgeSec: 45,
    rawWallets: [{ address: 'walletA', solFundedAmount: 5, buyVolumeSol: 1.5 }],
    programOwner: 'owner_program',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 1000,
    liquiditySol: 250,
    txCount: 85,
    solPriceUsd: 155.0,
  };

  const result = await engine.processEvent(event, context);
  assert.ok(result.jevShadowRecord);
  assert.equal(result.jevShadowRecord.authority, 'ADVISORY_ONLY');
  assert.equal(result.jevShadowRecord.executionAuthorized, false);
  assert.equal(result.jevDecision.decisionId, result.jevShadowRecord.decision.decisionId);
  assert.equal(result.layaAssessment.assessmentId, result.jevShadowRecord.assessment.assessmentId);
  assert.equal(result.jevCertificates.length, 2);

  assert.ok(result.viewModel.jevAdvisory);
  assert.equal(result.viewModel.jevAdvisory.authority, 'ADVISORY_ONLY');
  assert.equal(result.viewModel.jevAdvisory.classification, result.jevDecision.classification);
  assert.ok(Number.isFinite(result.viewModel.jevAdvisory.organicContinuation));
  assert.ok(Number.isFinite(result.viewModel.jevAdvisory.layaAgreement));
});

test('Pass 68 - incomplete JEV evidence stays abstained behind an upstream safety lock', async () => {
  const engine = new MasterIntelligenceEngine();
  const event = {
    eventId: 'evt_jev_pass68_ood',
    slot: 280_000_001,
    sourceTimestampMs: Date.now() - 50,
    receivedTimestampMs: Date.now(),
    mint: 'Ood11111111111111111111111111111111111111112',
    signature: '5K3Mh...jevOodSig',
    type: 'SWAP',
    payload: { amountSol: 1.5 },
  };

  const context = {
    tokenAgeSec: 45,
    rawWallets: [{ address: 'walletA', solFundedAmount: 5, buyVolumeSol: 1.5 }],
    programOwner: 'owner_program',
    hasFreezeAuthority: false,
    hasMintAuthority: false,
    marketCapSol: 1000,
    liquiditySol: 250,
    txCount: 85,
    solPriceUsd: 155.0,
    enforceJevGating: true,
    jevFeatureOverrides: {
      volatility: 0.15, // unusual volatility (> 0.08 triggers OOD)
      provider_error_rate: 0.35, // error rate (> 0.2 triggers OOD)
    },
  };

  const result = await engine.processEvent(event, context);
  assert.equal(result.decision, 'SAFETY_LOCKED');
  assert.match(result.whyExecutionBlocked, /BLOCKED — SAFETY LOCK ACTIVE/);
  assert.notEqual(result.decision, 'AUTHORIZED_BUY');
  assert.equal(result.jevShadowRecord.decision.classification, 'NEED_MORE_EVIDENCE');
});

test('Pass 68 - Terminal HTTP handlers serve projection, evaluation, and hosted boundary', async () => {
  const engine = new MasterIntelligenceEngine();

  // 1. GET /api/intelligence/jev/shadow
  const getReq = mockIncomingMessage({ method: 'GET', url: '/api/intelligence/jev/shadow' });
  const getRes = mockServerResponse();
  await handleJevShadowProjectionRequest(getReq, getRes, engine);
  assert.equal(getRes.statusCode, 200);
  const getBody = JSON.parse(getRes.body);
  assert.equal(getBody.ok, true);
  assert.equal(getBody.status, 'NO_LOCAL_PREVIEW_RECORDS');
  assert.equal(getBody.evidenceMode, 'SYNTHETIC_PREVIEW_ONLY');
  assert.equal(getBody.authority, 'ADVISORY_ONLY');
  assert.equal(getBody.executionAuthorized, false);

  // 2. POST /api/intelligence/jev/evaluate
  const postReq = mockIncomingMessage({
    method: 'POST',
    url: '/api/intelligence/jev/evaluate',
    headers: { 'content-type': 'application/json' },
    body: { mint: 'terminal_eval_token', features: { price_velocity: 0.025 } },
  });
  const postRes = mockServerResponse();
  await handleJevEvaluationRequest(postReq, postRes, engine);
  assert.equal(postRes.statusCode, 200);
  const postBody = JSON.parse(postRes.body);
  assert.equal(postBody.ok, true);
  assert.equal(postBody.record.tokenId, 'terminal_eval_token');
  assert.equal(postBody.record.authority, 'ADVISORY_ONLY');
  assert.equal(postBody.record.certificates.length, 2);

  // 3. GET /api/intelligence/jev-hosted
  const hostedReq = mockIncomingMessage({ method: 'GET', url: '/api/intelligence/jev-hosted' });
  const hostedRes = mockServerResponse();
  handleJevHostedStatusRequest(hostedReq, hostedRes, engine);
  assert.equal(hostedRes.statusCode, 200);
  const hostedBody = JSON.parse(hostedRes.body);
  assert.equal(hostedBody.status, 'LOCAL_PREVIEW_RECORDS_RECORDED');
  assert.equal(hostedBody.authority, 'ADVISORY_ONLY');
  assert.equal(hostedBody.hostedContextReady, false);
  assert.equal(hostedBody.contextStatus, 'NO_MINT_SELECTED');
  assert.deepEqual(hostedBody.providers.map(provider => provider.model), ['typesafe/jev-1.13', 'clef-flash']);
  assert.ok(hostedBody.safeguards.length >= 5);
});
