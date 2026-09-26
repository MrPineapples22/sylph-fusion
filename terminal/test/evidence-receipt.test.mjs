import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteVerifiedEvidence, MAX_EVIDENCE_RECEIPT_WINDOW_MS } from '../src/evidence-receipt.js';

test('only an explicit verified, complete and current receipt unlocks rich intelligence', () => {
  for (const receipt of [null, {}, { evidenceStatus: 'CURRENT', evidenceCompleteness: 'COMPLETE' }, { evidenceStatus: 'VERIFIED' }, { evidenceStatus: 'VERIFIED', evidenceCompleteness: 'PARTIAL' }]) {
    assert.equal(hasCompleteVerifiedEvidence(receipt, 100), false);
  }
  const complete = { evidenceStatus: 'VERIFIED', evidenceCompleteness: 'COMPLETE', generatedAt: 50, validUntil: 150 };
  assert.equal(hasCompleteVerifiedEvidence(complete, 100), true);
  assert.equal(hasCompleteVerifiedEvidence(complete, 151), false);
  assert.equal(hasCompleteVerifiedEvidence({ ...complete, generatedAt: 101 }, 100), false);
  assert.equal(hasCompleteVerifiedEvidence({ ...complete, validUntil: Number.NaN }, 100), false);
  assert.equal(hasCompleteVerifiedEvidence({ ...complete, validUntil: complete.generatedAt - 1 }, 100), false);
  assert.equal(hasCompleteVerifiedEvidence({ ...complete, validUntil: complete.generatedAt + MAX_EVIDENCE_RECEIPT_WINDOW_MS + 1 }, 100), false);
});
