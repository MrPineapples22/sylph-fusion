import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyMissedProfit } from '../../dist/intelligence/profit/missed-profit-forensics.js';

const base = (overrides = {}) => ({
  caseId: 'case-1', mint: 'mint-1', firstSeenAtMs: 100, firstUsableAtMs: 110, decisionAtMs: 120,
  eligibleAtDecision: true, hardSafetyVetoed: false, softVetoed: false, rankEligible: true,
  capitalAvailable: true, executionAttempted: true, executionSucceeded: true,
  executableEntryEvidence: true, executableExitEvidence: true, realizedExecutableNetPnlLamports: 99n,
  ...overrides,
});

test('missed-profit forensics uses the earliest blocker and never calls hard safety a false veto', () => {
  assert.equal(classifyMissedProfit(base({ hardSafetyVetoed: true, softVetoed: true })).classification, 'CORRECT_SKIP');
  assert.equal(classifyMissedProfit(base({ softVetoed: true })).classification, 'FALSE_VETO');
  assert.equal(classifyMissedProfit(base({ capitalAvailable: false })).classification, 'NO_CAPITAL');
});

test('missed-profit forensics refuses phantom profits without both executable legs', () => {
  const unresolved = classifyMissedProfit(base({ executableExitEvidence: false }));
  assert.equal(unresolved.classification, 'UNEXITABLE');
  assert.equal(unresolved.executableNetPnlLamports, undefined);
  assert.equal(unresolved.isProfitableExecutableMiss, false);
  assert.throws(() => classifyMissedProfit(base({ executableEntryEvidence: false, expectedNetPnlLamports: 1n })), /REQUIRE_ENTRY_EVIDENCE/);
});
