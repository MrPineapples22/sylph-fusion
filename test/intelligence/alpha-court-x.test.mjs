import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AlphaCourtEngine, ProductionCertificationAuthority as GateResearch } from '../../dist/intelligence/science/alpha-court-x.js';
const gateKeys = [
  'transactionCompletenessPassed', 'versionCompatibilityPassed', 'parserAgreementPassed', 'providerQuorumPassed',
  'pointInTimeCorrectnessPassed', 'calibrationSharpnessPassed', 'deterministicIntentsPassed', 'retrySafetyPassed',
  'isolatedSigningPassed', 'reservationCorrectnessPassed', 'restartSafetyPassed', 'realizedNetPnlProofPassed',
];
const assertions = (value = true) => Object.fromEntries(gateKeys.map(key => [key, value]));
const registration = (trialId = 'research-trial') => ({ trialId, hypothesis: 'Feature predicts barrier outcome', featureName: 'feature', targetBarrier: '2X', targetHorizon: '1m' });
const metrics = (trialId = 'research-trial') => ({ trialId, walkForwardIc: .045, entityHoldoutIc: .028, regimeRobustnessScore: .82, netExecutableEvSol: .08, latencySurvivalRatio: .72, ablationDeltaBrierScore: .008 });
function registeredCourt() { const court = new AlphaCourtEngine(); court.preRegisterHypothesis(registration()); return court; }
function blocked(result) {
  assert.equal(result.liveCapitalAuthorization, 'BLOCKED_FAIL_CLOSED');
  assert.equal(result.authority, 'RESEARCH_ONLY');
  assert.equal(result.evidenceStatus, 'CALLER_ASSERTIONS_ONLY');
  assert.equal(result.isProductionCertified, false);
  assert.equal(result.gates.length, 12);
}

test('all twelve caller assertions are summarized without granting live capital', () => {
  const result = GateResearch.evaluateAllGates(assertions()); blocked(result);
  assert.equal(result.allGatesPassed, true);
  assert.equal(result.gates.every(gate => gate.isPassed === true), true);
  assert.match(result.certificationId, /^research_gate_[a-f0-9]{64}$/);
  for (const gate of result.gates) assert.match(gate.evidenceSummary, /Caller assertion only/);
});

test('every combination of caller gate assertions remains blocked', () => {
  for (let mask = 0; mask < 4096; mask++) {
    const input = Object.fromEntries(gateKeys.map((key, i) => [key, !!(mask & (1 << i))]));
    const result = GateResearch.evaluateAllGates(input); blocked(result);
    assert.equal(result.allGatesPassed, mask === 4095);
    assert.deepEqual(result.gates.map(gate => gate.isPassed), gateKeys.map(key => input[key]));
  }
});

test('malformed, missing and extra gate fields are invalid and cannot pass any gate', () => {
  const inputs = [undefined, null, {}, [], true, 'true', Object.create(assertions()), { ...assertions(), fabricatedSignerApproval: true }];
  for (const key of gateKeys) {
    const missing = assertions(); delete missing[key]; inputs.push(missing);
    for (const value of [undefined, null, 'true', 1, {}, [], new Boolean(true)]) inputs.push({ ...assertions(), [key]: value });
  }
  for (const input of inputs) {
    const result = GateResearch.evaluateAllGates(input); blocked(result);
    assert.equal(result.allGatesPassed, false);
    assert.equal(result.gates.every(gate => gate.isPassed === false), true);
    assert.equal(typeof result.validationError, 'string');
  }
});

test('research gate hashes cover authority, timestamp, gate summaries and validation outcome', () => {
  for (const input of [assertions(), assertions(false), {}]) {
    const { certificationId, hash, ...payload } = GateResearch.evaluateAllGates(input);
    const expected = createHash('sha256').update('sylph/research-gate-report/v1\n').update(JSON.stringify(payload)).digest('hex');
    assert.equal(hash, expected);
    assert.equal(certificationId, `research_gate_${hash}`);
    const changed = { ...payload, liveCapitalAuthorization: 'GRANTED' };
    assert.notEqual(createHash('sha256').update('sylph/research-gate-report/v1\n').update(JSON.stringify(changed)).digest('hex'), hash);
  }
});

test('reports and gate lists are immutable snapshots', () => {
  const input = assertions(); const report = GateResearch.evaluateAllGates(input);
  input.transactionCompletenessPassed = false;
  assert.equal(report.gates[0].isPassed, true);
  assert.throws(() => { report.liveCapitalAuthorization = 'GRANTED'; }, TypeError);
  assert.throws(() => { report.isProductionCertified = true; }, TypeError);
  assert.throws(() => { report.gates[0].isPassed = false; }, TypeError);
  assert.throws(() => report.gates.push({}), TypeError);
});

test('passing all six caller metric thresholds gives only a research outcome', () => {
  const court = registeredCourt(); const result = court.adjudicateFeature(metrics());
  assert.equal(result.allCourtsPassed, true);
  assert.equal(result.promotionVerdict, 'SURVIVED_RESEARCH_COURTS');
  assert.equal(result.authority, 'RESEARCH_ONLY');
  assert.equal(result.evidenceStatus, 'CALLER_METRICS_ONLY');
  assert.equal(result.isProductionApproved, false);
  assert.match(result.reason, /not been independently verified/);
  assert.throws(() => { result.promotionVerdict = 'APPROVED_FOR_PRODUCTION'; }, TypeError);
});

test('each individual research court can fail and no result grants promotion', () => {
  const court = registeredCourt();
  const cases = [ ['walkForwardIc', .029, 'temporalCourt'], ['entityHoldoutIc', .019, 'entityCourt'],
    ['regimeRobustnessScore', .699, 'regimeCourt'], ['netExecutableEvSol', 0, 'economicCourt'],
    ['latencySurvivalRatio', .599, 'executionCourt'], ['ablationDeltaBrierScore', .0049, 'ablationCourt'] ];
  for (const [metric, value, verdict] of cases) {
    const result = court.adjudicateFeature({ ...metrics(), [metric]: value });
    assert.equal(result[verdict], 'FAIL'); assert.equal(result.allCourtsPassed, false);
    assert.equal(result.promotionVerdict, 'REJECTED_RESEARCH_COURTS');
    assert.equal(result.isProductionApproved, false);
  }
});

test('metric bounds reject nonfinite values, strings, missing values and impossible ratios', () => {
  const court = registeredCourt();
  for (const key of Object.keys(metrics()).filter(key => key !== 'trialId')) {
    for (const value of [NaN, Infinity, -Infinity, undefined, null, '1', true]) assert.throws(() => court.adjudicateFeature({ ...metrics(), [key]: value }));
    const missing = metrics(); delete missing[key]; assert.throws(() => court.adjudicateFeature(missing));
  }
  for (const key of ['walkForwardIc', 'entityHoldoutIc', 'regimeRobustnessScore', 'latencySurvivalRatio', 'ablationDeltaBrierScore']) {
    assert.throws(() => court.adjudicateFeature({ ...metrics(), [key]: 1.01 }), /INVALID_COURT_METRICS/);
    assert.throws(() => court.adjudicateFeature({ ...metrics(), [key]: -1.01 }), /INVALID_COURT_METRICS/);
  }
  for (const key of ['regimeRobustnessScore', 'latencySurvivalRatio']) assert.throws(() => court.adjudicateFeature({ ...metrics(), [key]: -.01 }));
  assert.throws(() => court.adjudicateFeature({ ...metrics(), trialId: ' ' }));
  assert.throws(() => court.adjudicateFeature({ ...metrics(), extra: true }));
});

test('threshold boundaries stay research-only, with zero EV failing', () => {
  const court = registeredCourt();
  const result = court.adjudicateFeature({ ...metrics(), walkForwardIc: .03, entityHoldoutIc: .02, regimeRobustnessScore: .70, latencySurvivalRatio: .60, ablationDeltaBrierScore: .005 });
  assert.equal(result.allCourtsPassed, true); assert.equal(result.isProductionApproved, false);
  assert.equal(court.adjudicateFeature({ ...metrics(), netExecutableEvSol: -1 }).economicCourt, 'FAIL');
});

test('local registration is required, immutable and cannot be replaced', () => {
  const court = new AlphaCourtEngine(); assert.throws(() => court.adjudicateFeature(metrics()), /ALPHA_COURT_UNREGISTERED/);
  const input = registration(); const trial = court.preRegisterHypothesis(input); input.trialId = 'changed';
  assert.equal(trial.trialId, 'research-trial'); assert.ok(Object.isFrozen(trial));
  assert.throws(() => { trial.isRegistered = false; }, TypeError);
  assert.throws(() => court.preRegisterHypothesis(registration()), /TRIAL_ALREADY_REGISTERED/);
  assert.throws(() => court.adjudicateFeature(metrics('changed')), /ALPHA_COURT_UNREGISTERED/);
  for (const key of Object.keys(registration())) {
    for (const value of [undefined, null, '', ' ', 1]) assert.throws(() => new AlphaCourtEngine().preRegisterHypothesis({ ...registration(), [key]: value }));
  }
});

test('accessors and proxies cannot run code during any research evaluation', () => {
  let calls = 0;
  const getter = { enumerable: true, get() { calls++; return true; } };
  const gates = assertions(); Object.defineProperty(gates, 'isolatedSigningPassed', getter);
  blocked(GateResearch.evaluateAllGates(gates));
  const registrationInput = registration(); Object.defineProperty(registrationInput, 'trialId', getter);
  assert.throws(() => new AlphaCourtEngine().preRegisterHypothesis(registrationInput), /ACCESSORS/);
  const metricInput = metrics(); Object.defineProperty(metricInput, 'walkForwardIc', getter);
  assert.throws(() => registeredCourt().adjudicateFeature(metricInput), /ACCESSORS/);
  const traps = { get() { calls++; throw Error('get'); }, ownKeys() { calls++; throw Error('keys'); }, getPrototypeOf() { calls++; throw Error('prototype'); } };
  blocked(GateResearch.evaluateAllGates(new Proxy(assertions(), traps)));
  assert.throws(() => new AlphaCourtEngine().preRegisterHypothesis(new Proxy(registration(), traps)));
  assert.throws(() => registeredCourt().adjudicateFeature(new Proxy(metrics(), traps)));
  const revoked = Proxy.revocable({}, {}); revoked.revoke(); blocked(GateResearch.evaluateAllGates(revoked.proxy));
  assert.equal(calls, 0);
});

test('inherited, hidden and symbolic assertions cannot impersonate evidence', () => {
  const hidden = assertions(); Object.defineProperty(hidden, 'isolatedSigningPassed', { value: true, enumerable: false });
  const symbolic = assertions(); symbolic[Symbol('approval')] = true;
  for (const input of [hidden, symbolic, Object.create(assertions())]) {
    const result = GateResearch.evaluateAllGates(input); blocked(result); assert.equal(result.allGatesPassed, false);
  }
  const nullPrototype = Object.assign(Object.create(null), assertions());
  const valid = GateResearch.evaluateAllGates(nullPrototype); blocked(valid); assert.equal(valid.allGatesPassed, true);
});
