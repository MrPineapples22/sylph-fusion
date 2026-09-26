import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertExecutionTimeline,
  certaintyEquivalentNetPnlLamports,
  createEconomicDecisionCertificate,
  totalEconomicCost,
  verifyEconomicDecisionCertificate,
} from '../../dist/intelligence/profit/economic-ledger.js';

const costs = {
  networkFeeLamports: 5_000n,
  priorityFeeLamports: 10_000n,
  jitoTipLamports: 20_000n,
  routeFeeLamports: 8_000n,
  failedTransactionCostLamports: 0n,
  estimatedMevLamports: 7_000n,
  estimatedSlippageLamports: 50_000n,
};

test('economic certificate has complete cost waterfall, monotonic ladder, and tamper seal', () => {
  const certificate = createEconomicDecisionCertificate({
    decisionId: 'decision-1', mint: 'mint-1', evidenceClass: 'PAPER_SIMULATED',
    prices: { decisionPriceUsd: 1, quotePriceUsd: 1.01, signedPriceUsd: 1.01, submissionPriceUsd: 1.015, landedPriceUsd: 1.02, confirmedPriceUsd: 1.02, finalizedPriceUsd: 1.03 },
    timestamps: { decidedAtMs: 1_000, quotedAtMs: 1_001, signedAtMs: 1_002, submittedAtMs: 1_003, landedAtMs: 1_004, confirmedAtMs: 1_005, finalizedAtMs: 1_006 },
    quantityAtomic: 100n, grossPnlLamports: 200_000n, costs, expectedHoldSeconds: 10, uncertaintyLamports: 10_000n,
  });
  assert.equal(totalEconomicCost(costs), 100_000n);
  assert.equal(certificate.netPnlLamports, '100000');
  assert.equal(certificate.decisionToFinalizedSlippageBps, 300);
  assert.equal(certificate.decisionToFinalizedLatencyMs, 6);
  assert.equal(certificate.netPnlPerSecondLamports, '10000');
  assert.equal(verifyEconomicDecisionCertificate(certificate), true);
  assert.equal(verifyEconomicDecisionCertificate({ ...certificate, netPnlLamports: '100001' }), false);
});

test('economic ledger rejects non-monotonic time and hidden negative costs', () => {
  assert.throws(() => assertExecutionTimeline({ decidedAtMs: 2, quotedAtMs: 1 }), /NON_MONOTONIC/);
  assert.throws(() => totalEconomicCost({ ...costs, jitoTipLamports: -1n }), /MUST_BE_NON_NEGATIVE/);
});

test('certainty equivalent penalizes uncertainty and tail loss before ranking capital', () => {
  const highButFragile = certaintyEquivalentNetPnlLamports({ expectedNetPnlLamports: 200n, uncertaintyLamports: 80n, expectedShortfallLamports: 80n });
  const lowerButReliable = certaintyEquivalentNetPnlLamports({ expectedNetPnlLamports: 150n, uncertaintyLamports: 10n, expectedShortfallLamports: 10n });
  assert.equal(highButFragile, 40n);
  assert.equal(lowerButReliable, 130n);
  assert.ok(lowerButReliable > highButFragile);
});
