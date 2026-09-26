import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTokenDecision } from '../src/token-decision-eval.js';

const candidate = {
  curve: { complete: false, realQuoteReserves: '2500000000' },
  drift: { passed: true, priceDriftBps: 0, liquidityDropBps: 0, driftBps: 0 },
};

test('missing and malformed security observations cannot qualify a token', () => {
  for (const value of [undefined, null, '', 0, 'false', {}]) {
    const decision = evaluateTokenDecision({ candidate, asset: { id: 'token', mintAuthority: value, freezeAuthority: value } });
    assert.equal(decision.isMintRevoked, null);
    assert.equal(decision.isFreezeRevoked, null);
    assert.equal(decision.isTelemetryPending, true);
    assert.equal(decision.executionRoute, 'UNKNOWN');
    assert.notEqual(decision.decisionBadge, 'DECISION: ELIGIBLE');
  }
});

test('active mint or freeze authority blocks otherwise valid telemetry', () => {
  for (const authority of ['mintAuthority', 'freezeAuthority']) {
    const decision = evaluateTokenDecision({ candidate, asset: { id: 'token', mintAuthority: false, freezeAuthority: false, [authority]: true } });
    assert.equal(decision.blocked, true);
    assert.match(decision.blockedExplanation, /authority remains active/);
  }
});
