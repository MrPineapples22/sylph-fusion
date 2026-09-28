import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ClearinghouseEngine, FirebreakEngine, OptimalExecutableSizeEngine as Sizing, WholeWalletCensusAndReconciler as Wallet } from '../../dist/platform/risk/capital-risk-x.js';
const request = (intentId = 'intent') => ({ intentId, mint: 'mint', amountSol: .5 });
const sizing = () => ({ availableCapitalSol: 10, poolReserveSol: 30, halfKellyFraction: .10, expectedNetReturnPct: 25, frictionSol: .01 });
const assertDenied = result => { assert.equal(result.isAuthorized, false); assert.equal(result.authority, 'RESEARCH_ONLY'); assert.match(result.reason, /AUTHORITY_UNAVAILABLE/); };

test('supplied balances are research-only and never authoritative or spendable', () => {
  const house = new ClearinghouseEngine(1);
  assert.equal(house.getCanonicalBalance(), null); assert.equal(house.getAvailableCapital(), 0);
  assert.equal(house.getResearchCapitalEstimate().hypotheticalAvailableSol, .95);
  assert.equal(house.getResearchCapitalEstimate().persistence, 'NONE');
  assertDenied(house.setCanonicalBalance(100));
  assert.equal(house.getResearchCapitalEstimate().suppliedBalanceSol, 1);
  assertDenied(house.acquireLease(request())); assert.equal(house.getResearchCapitalEstimate().hypotheticalAvailableSol, .95);
});

test('negative, NaN and malformed balances/reservations cannot create holds', () => {
  for (const value of [-1, NaN, Infinity, -Infinity, '1', null, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => new ClearinghouseEngine(value));
  const house = new ClearinghouseEngine(1);
  for (const key of ['amountSol', 'settlementReserveSol', 'feeReserveSol']) {
    for (const value of [-1, NaN, Infinity, undefined, null, '0.5']) {
      assert.throws(() => house.previewReservation({ ...request(), [key]: value }));
      assert.throws(() => house.acquireLease({ ...request(), [key]: value }));
    }
  }
  for (const value of [0, -1, NaN, Infinity, 1.5, 86_400_001]) assert.throws(() => house.previewReservation({ ...request(), durationMs: value }));
  for (const key of ['intentId', 'mint']) for (const value of ['', ' ', undefined, null, 1]) assert.throws(() => house.previewReservation({ ...request(), [key]: value }));
  assert.throws(() => house.previewReservation({ ...request(), amountSol: 0 }));
  assert.equal(house.getResearchCapitalEstimate().hypotheticalAvailableSol, .95);
});

test('hypothetical holds are immutable and caller mutation cannot release exposure', () => {
  const house = new ClearinghouseEngine(1); const input = request(); const hold = house.previewReservation(input);
  assert.equal(hold.authority, 'RESEARCH_ONLY'); assert.equal(hold.isAuthorized, false);
  assert.equal(hold.state, 'HYPOTHETICAL_HOLD'); assert.equal('leaseId' in hold, false);
  input.amountSol = 0; input.intentId = 'changed';
  assert.throws(() => { hold.amountSol = 0; }, TypeError);
  assert.throws(() => { hold.isReleased = true; }, TypeError);
  assert.equal(hold.amountSol, .5);
  assert.ok(house.getResearchCapitalEstimate().hypotheticalAvailableSol < .44);
  assert.throws(() => house.previewReservation({ ...request('second'), amountSol: .6 }), /EXCEEDS_ESTIMATE/);
});

test('duplicate or conflicting intents cannot collide or reserve twice', () => {
  const house = new ClearinghouseEngine(2); const hold = house.previewReservation(request());
  const before = house.getResearchCapitalEstimate().hypotheticalAvailableSol;
  assert.throws(() => house.previewReservation(request()), /DUPLICATE_RESEARCH_INTENT/);
  assert.throws(() => house.previewReservation({ ...request(), mint: 'different', amountSol: .1 }), /DUPLICATE_RESEARCH_INTENT/);
  assert.equal(house.getResearchCapitalEstimate().hypotheticalAvailableSol, before);
  const second = house.previewReservation(request('other'));
  assert.notEqual(hold.reservationId, second.reservationId);
  const otherInstance = new ClearinghouseEngine(2).previewReservation(request());
  assert.notEqual(hold.reservationId, otherInstance.reservationId);
  assert.equal(otherInstance.isAuthorized, false);
});

test('unauthenticated release and settlement never free or mark research holds', () => {
  const house = new ClearinghouseEngine(1); const hold = house.previewReservation(request());
  const before = house.getResearchCapitalEstimate().hypotheticalAvailableSol;
  for (const id of [hold.reservationId, 'forged', 'intent']) { assertDenied(house.releaseLease(id)); assertDenied(house.markSettled(id)); }
  assert.equal(house.getResearchCapitalEstimate().hypotheticalAvailableSol, before);
  assert.equal(hold.state, 'HYPOTHETICAL_HOLD');
  assert.throws(() => house.previewReservation(request()), /DUPLICATE_RESEARCH_INTENT/);
});

test('expiry and restart never imply settlement, reconciliation or live capital availability', () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    const house = new ClearinghouseEngine(1); const hold = house.previewReservation({ ...request(), durationMs: 1 });
    const before = house.getResearchCapitalEstimate().hypotheticalAvailableSol;
    Date.now = () => 2000;
    assert.equal(hold.expiresAtMs, 1001);
    assert.equal(house.getResearchCapitalEstimate().hypotheticalAvailableSol, before);
    assert.equal(house.getAvailableCapital(), 0);
    assert.throws(() => house.previewReservation(request()), /DUPLICATE_RESEARCH_INTENT/);
    const restarted = new ClearinghouseEngine(1);
    assert.equal(restarted.getAvailableCapital(), 0); assert.equal(restarted.getCanonicalBalance(), null);
    assertDenied(restarted.acquireLease(request()));
  } finally { Date.now = originalNow; }
});

test('research firebreak observations never permit entry and cannot be reset without authority', () => {
  const firebreak = new FirebreakEngine(3, 15);
  assert.equal(firebreak.canEnterNewTrades(), false);
  firebreak.recordTradeOutcome(-.05, .95); firebreak.recordTradeOutcome(-.05, .90);
  assert.equal(firebreak.recordTradeOutcome(-.05, .85), 'TRIPPED_CONSECUTIVE_LOSSES');
  assertDenied(firebreak.reset(100));
  assert.equal(firebreak.getState(), 'TRIPPED_CONSECUTIVE_LOSSES');
  assert.equal(firebreak.recordTradeOutcome(10, 100), 'TRIPPED_CONSECUTIVE_LOSSES');
  assert.equal(firebreak.canEnterNewTrades(), false);
  const drawdown = new FirebreakEngine(); drawdown.recordTradeOutcome(0, 1);
  assert.equal(drawdown.recordTradeOutcome(-.2, .8), 'TRIPPED_DRAWDOWN');
});

test('invalid firebreak policy and observations fail closed', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => new FirebreakEngine(value));
  for (const value of [0, -1, NaN, Infinity, 101]) assert.throws(() => new FirebreakEngine(3, value));
  for (const [pnl, equity] of [[NaN, 1], [Infinity, 1], [0, NaN], [0, -1], [0, '1']]) {
    const firebreak = new FirebreakEngine(); assert.equal(firebreak.recordTradeOutcome(pnl, equity), 'TRIPPED_INVALID_INPUT');
    assert.equal(firebreak.canEnterNewTrades(), false); assertDenied(firebreak.reset(1));
    assert.equal(firebreak.getState(), 'TRIPPED_INVALID_INPUT');
  }
  const anomaly = new FirebreakEngine(); anomaly.tripAnomaly('unverified protocol behavior');
  assert.equal(anomaly.recordTradeOutcome(1, 10), 'TRIPPED_ANOMALY');
});

test('valid sizing produces only capped research suggestions and zero approved size', () => {
  const result = Sizing.calculateSize(sizing());
  assert.equal(result.authority, 'RESEARCH_ONLY'); assert.equal(result.isApproved, false);
  assert.equal(result.optimalSizeSol, 0); assert.equal(result.suggestedResearchSizeSol, 1);
  assert.equal(result.poolReserveCapSol, 1.5);
  assert.throws(() => { result.isApproved = true; }, TypeError);
  const small = Sizing.calculateSize({ ...sizing(), poolReserveSol: 2, frictionSol: .005 });
  assert.equal(small.suggestedResearchSizeSol, .1); assert.equal(small.isApproved, false);
  const zeroKelly = Sizing.calculateSize({ ...sizing(), halfKellyFraction: 0 });
  assert.equal(zeroKelly.suggestedResearchSizeSol, 0);
});

test('NaN, overflow, negative quantities and malformed sizing can never approve', () => {
  for (const key of Object.keys(sizing())) for (const value of [NaN, Infinity, -Infinity, '1', undefined, null]) {
    const result = Sizing.calculateSize({ ...sizing(), [key]: value }); assert.equal(result.isApproved, false); assert.equal(result.suggestedResearchSizeSol, 0);
  }
  for (const key of ['availableCapitalSol', 'poolReserveSol', 'halfKellyFraction', 'frictionSol']) {
    const result = Sizing.calculateSize({ ...sizing(), [key]: -1 }); assert.equal(result.isApproved, false); assert.equal(result.suggestedResearchSizeSol, 0);
  }
  for (const input of [null, undefined, {}, { ...sizing(), halfKellyFraction: 2 }, { ...sizing(), expectedNetReturnPct: Number.MAX_VALUE, poolReserveSol: Number.MAX_SAFE_INTEGER, availableCapitalSol: Number.MAX_SAFE_INTEGER }]) {
    const result = Sizing.calculateSize(input); assert.equal(result.isApproved, false); assert.equal(result.suggestedResearchSizeSol, 0);
  }
  const friction = Sizing.calculateSize({ ...sizing(), expectedNetReturnPct: 2, frictionSol: .05 });
  assert.equal(friction.suggestedResearchSizeSol, 0); assert.equal(friction.researchVetoReason, 'INSUFFICIENT_PROFIT_OVER_FRICTION');
});

test('research suggestion rounds down within reserve and portfolio caps', () => {
  for (const reserve of [1.234567, .00001, 5.555555]) {
    const result = Sizing.calculateSize({ ...sizing(), poolReserveSol: reserve, frictionSol: 0 });
    assert.equal(result.isApproved, false);
    assert.ok(result.suggestedResearchSizeSol <= result.poolReserveCapSol);
    assert.ok(result.suggestedResearchSizeSol <= result.portfolioCapSol);
  }
});

test('matching mint sets and empty wallets always remain unknown without amount/provenance evidence', () => {
  for (const [mints, accounts] of [[[], []], [['mint'], [{ mint: 'mint', tokenAmount: 1n }]], [['mint'], [{ mint: 'mint', tokenAmount: 1_000_000n }]]]) {
    const report = Wallet.reconcile(mints, accounts);
    assert.equal(report.isClean, false); assert.equal(report.status, 'UNKNOWN_UNVERIFIED');
    assert.equal(report.authority, 'RESEARCH_ONLY'); assert.match(report.reason, /Internal amounts/);
  }
});

test('wallet discrepancies include wrapped native token and immutable mint snapshots', () => {
  const mints = ['managed', 'missing'];
  const wrapped = 'So11111111111111111111111111111111111111112';
  const accounts = [{ mint: 'managed', tokenAmount: 10n }, { mint: 'external', tokenAmount: 1n }, { mint: wrapped, tokenAmount: 1n }];
  const report = Wallet.reconcile(mints, accounts); mints.push('external'); accounts[0].mint = 'mutated';
  assert.deepEqual(report.unmanagedExternalMints, ['external', wrapped]);
  assert.deepEqual(report.missingMints, ['missing']); assert.deepEqual(report.internalMints, ['managed', 'missing']);
  assert.throws(() => report.internalMints.push('forged'), TypeError); assert.throws(() => { report.isClean = true; }, TypeError);
});

test('missing, negative or duplicated wallet amounts are invalid and never clean', () => {
  for (const accounts of [[{ mint: 'mint' }], [{ mint: 'mint', tokenAmount: -1n }], [{ mint: 'mint', tokenAmount: NaN }], [{ mint: 'mint', tokenAmount: 1 }], [{ mint: 'mint', tokenAmount: 18_446_744_073_709_551_616n }], [{ mint: 'mint', tokenAmount: 1n }, { mint: 'mint', tokenAmount: 2n }]]) {
    const report = Wallet.reconcile(['mint'], accounts); assert.equal(report.isClean, false); assert.equal(typeof report.validationError, 'string');
  }
  assert.equal(typeof Wallet.reconcile(['mint', 'mint'], []).validationError, 'string');
});

test('accessors/proxies cannot change research values during checks or execute caller code', () => {
  let calls = 0;
  const getter = { enumerable: true, get() { calls++; return .5; } };
  const house = new ClearinghouseEngine(1); const malicious = request(); Object.defineProperty(malicious, 'amountSol', getter);
  assert.throws(() => house.previewReservation(malicious), /ACCESSORS/);
  assert.throws(() => house.acquireLease(malicious), /ACCESSORS/);
  const size = sizing(); Object.defineProperty(size, 'availableCapitalSol', getter); assert.equal(Sizing.calculateSize(size).isApproved, false);
  const account = { mint: 'mint', tokenAmount: 1n }; Object.defineProperty(account, 'tokenAmount', getter); assert.equal(Wallet.reconcile(['mint'], [account]).isClean, false);
  const traps = { get() { calls++; throw Error('get'); }, ownKeys() { calls++; throw Error('keys'); }, getPrototypeOf() { calls++; throw Error('prototype'); } };
  assert.throws(() => house.previewReservation(new Proxy(request(), traps)));
  assert.equal(Sizing.calculateSize(new Proxy(sizing(), traps)).isApproved, false);
  assert.equal(Wallet.reconcile(new Proxy(['mint'], traps), []).isClean, false);
  assert.equal(calls, 0);
});

test('sizing reports supplied friction separately from the applied 2.5x profit hurdle', () => {
  const input = sizing();
  const report = Sizing.calculateSize(input);
  assert.equal(report.suppliedFrictionSol, input.frictionSol);
  assert.equal(report.frictionHurdleMultiplier, 2.5);
  assert.equal(report.frictionPenaltySol, input.frictionSol * 2.5);
  assert.equal(report.isApproved, false);
  const boundary = Sizing.calculateSize({ ...input, frictionSol: .1 });
  assert.equal(boundary.frictionPenaltySol, .25);
  assert.equal(boundary.suggestedResearchSizeSol, 1);
  const failsHurdle = Sizing.calculateSize({ ...input, frictionSol: .10001 });
  assert.equal(failsHurdle.suppliedFrictionSol, .10001);
  assert.equal(failsHurdle.frictionPenaltySol, .10001 * 2.5);
  assert.equal(failsHurdle.suggestedResearchSizeSol, 0);
  assert.equal(failsHurdle.researchVetoReason, 'INSUFFICIENT_PROFIT_OVER_FRICTION');
  assert.equal(failsHurdle.isApproved, false);
});
