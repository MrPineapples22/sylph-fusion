import test from 'node:test';
import assert from 'node:assert/strict';
import { assessEconomicCompleteness, assertEconomicCohortEligible, classifyEconomicOutcome } from '../../dist/intelligence/profit/research-quality-gates.js';

test('outcome taxonomy keeps no-fill, partial, failure, collapse, and rug distinct', () => {
  const base = { grossPnlLamports: 1n, netPnlLamports: 1n, fillFractionBps: 10_000, failedTransaction: false, rugObserved: false, liquidityCollapseObserved: false };
  assert.equal(classifyEconomicOutcome({ ...base, fillFractionBps: 0 }), 'NO_FILL');
  assert.equal(classifyEconomicOutcome({ ...base, fillFractionBps: 5_000 }), 'PARTIAL_FILL');
  assert.equal(classifyEconomicOutcome({ ...base, failedTransaction: true }), 'FAILED_TRANSACTION');
  assert.equal(classifyEconomicOutcome({ ...base, rugObserved: true }), 'RUG');
  assert.equal(classifyEconomicOutcome({ ...base, liquidityCollapseObserved: true }), 'LIQUIDITY_COLLAPSE');
  assert.equal(classifyEconomicOutcome({ ...base, netPnlLamports: -1n }), 'ORDINARY_LOSS');
});

test('economic completeness identifies field-specific gaps and prevents cohort promotion', () => {
  const report = assessEconomicCompleteness([
    { recordId: 'a', requiredFields: ['decision', 'quote', 'fee'], values: { decision: 1, quote: 2, fee: 3 } },
    { recordId: 'b', requiredFields: ['decision', 'quote', 'fee'], values: { decision: 1, quote: null } },
  ]);
  assert.equal(report.completenessBps, 6_666);
  assert.deepEqual(report.missingByField, { quote: 1, fee: 1 });
  assert.throws(() => assertEconomicCohortEligible(report), /INCOMPLETE/);
  assert.throws(() => assessEconomicCompleteness([{ recordId: 'a', requiredFields: [], values: {} }, { recordId: 'a', requiredFields: [], values: {} }]), /UNIQUE/);
});
