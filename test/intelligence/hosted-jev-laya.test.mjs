import test from 'node:test';
import assert from 'node:assert/strict';
import {AstraFeatureAdapter, FEATURE_DEFINITIONS} from '../../dist/intelligence/astra/features.js';
import {HOSTED_JEV_QUESTION_SCHEMA, TypeSafeHostedJevAdapter} from '../../dist/intelligence/astra/typesafe-jev-adapter.js';
import {HostedJevLayaComparison, HostedLayaAdapter} from '../../dist/intelligence/astra/laya-hosted-adapter.js';

const now = 1_800_000_000_000;
const values = {price_velocity:.01, price_acceleration:.001, buy_sell_ratio:4, liquidity:250000, market_cap:1000000, liquidity_velocity:.001,
  wallet_concentration:.1, unique_buyers:80, first_buyer_quality:.9, bundle_rate:.02, wash_ratio:.02, rug_score:.05,
  dev_concentration:.05, volatility:.01, provider_error_rate:.01, provider_slot_lag:1};
const observations = Object.keys(values).map(name => ({name, value:values[name], source:'certified-adapter', evidenceId:`e:${name}`,
  correlationGroup:'independent', observedAt:now-100, availableAt:now-50, unit:FEATURE_DEFINITIONS[name].unit,
  windowMs:FEATURE_DEFINITIONS[name].windowMs, confidence:.9, conflict:false}));
const context = selected => new AstraFeatureAdapter().capture('token', selected ?? observations, now, 100);
const answers = value => Object.fromEntries(Object.keys(HOSTED_JEV_QUESTION_SCHEMA).map(name => [name,{type:'noul',noul:value}]));
const response = body => ({ok:true,status:200,headers:new Headers({'content-length':String(JSON.stringify(body).length)}),
  json:async()=>body,text:async()=>JSON.stringify(body)});

test('JEV 1.13 and hosted Laya receive the same pinned schema and exact feature snapshot', async () => {
  const requests = [];
  const fetchTypeSafe = async (url, init) => { requests.push([url,JSON.parse(init.body),init]); return response({model:'typesafe/jev-1.13',answers:answers(.2)}); };
  const fetchLaya = async (url, init) => { requests.push([url,JSON.parse(init.body),init]); return response({model:'clef-flash',answers:answers(.3),usage:{input_tokens:42,output_tokens:0}}); };
  const comparison = await new HostedJevLayaComparison(new TypeSafeHostedJevAdapter({apiKey:'test-key',apiUrl:'https://gateway.example/v1/systemone',requestedModel:'typesafe/jev-1.13'},fetchTypeSafe),
    new HostedLayaAdapter({apiKey:'test-key',requestedModel:'clef-flash'},fetchLaya)).assess('token',context(),now);
  assert.equal(comparison.status,'AVAILABLE');
  assert.equal(comparison.authority,'ADVISORY_ONLY');
  assert.equal(comparison.executionAuthorized,false);
  assert.equal(comparison.localJev.classification,'HIGH_INTEREST');
  assert.equal(comparison.typesafeJev.resolvedModel,'typesafe/jev-1.13');
  assert.equal(comparison.laya.resolvedModel,'clef-flash');
  assert.equal(comparison.laya.inputTokens,42);
  assert.ok(Math.abs(comparison.maximumHostedProbabilityDelta - .1) < 1e-12);
  assert.equal(requests.length,2);
  assert.equal(requests[0][1].state,requests[1][1].state);
  assert.deepEqual(requests[0][1].questions,requests[1][1].questions);
  assert.equal(requests[0][1].model,'typesafe/jev-1.13');
  assert.equal(requests[1][1].model,'clef-flash');
  assert.equal(requests[0][2].redirect,'error');
  assert.equal(requests[1][2].redirect,'error');
  assert.equal(JSON.stringify(comparison).includes('test-key'),false);
});

test('insufficient feature evidence is returned locally without either hosted call', async () => {
  let calls = 0;
  const noCall = async () => { calls += 1; throw new Error('must not call'); };
  const comparison = await new HostedJevLayaComparison(new TypeSafeHostedJevAdapter({apiKey:'test-key',apiUrl:'https://gateway.example/v1/systemone'},noCall),
    new HostedLayaAdapter({apiKey:'test-key'},noCall)).assess('token',context([observations[0]]),now);
  assert.equal(comparison.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(comparison.typesafeJev.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(comparison.laya.status,'INSUFFICIENT_EVIDENCE');
  assert.equal(comparison.hostedProbabilityDeltas,null);
  assert.equal(calls,0);
});

test('Laya adapter rejects a model mismatch and malformed typed answers', async () => {
  const source = context();
  const mismatch = await new HostedLayaAdapter({apiKey:'test-key'},async()=>response({model:'english',answers:answers(.3)})).assess(source);
  assert.equal(mismatch.status,'INVALID_RESPONSE');
  const malformedAnswers = answers(.3); malformedAnswers.distribution = {type:'score',score:1};
  const malformed = await new HostedLayaAdapter({apiKey:'test-key'},async()=>response({model:'clef-flash',answers:malformedAnswers})).assess(source);
  assert.equal(malformed.status,'INVALID_RESPONSE');
  assert.equal(malformed.answers,null);
});

test('Laya stays disabled without an environment credential and does not call the endpoint', async () => {
  let calls = 0;
  const adapter = new HostedLayaAdapter({apiKey:null},async()=>{calls += 1; throw new Error('must not call');});
  const result = await adapter.assess(context());
  assert.equal(result.status,'DISABLED');
  assert.equal(result.errorCode,'LAYA_API_KEY_UNCONFIGURED');
  assert.equal(calls,0);
});
