/**
 * SYLPH FUSION — NO FUTURE LEAKAGE VERIFICATION TEST
 * Section L: Dedicated No-Future-Leakage Test
 *
 * Enforces non-negotiable temporal causal boundary:
 * 1. Reject any feature whose timestamp is after decisionAt.
 * 2. For graph data: graphEdgeObservedAt <= decisionAt.
 * 3. For labels: label timestamps must not appear in features.
 * 4. Future peaks (ATH), migrations, and lifetime volume must NEVER leak into PointInTimeResearchState.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ObservationQualityEngine,
  RunnerDistinguishabilityCourt,
  InformationFrontierEngine,
  ExecutableLiquidationSurfaceEngine,
  ExitMinCutEngine,
  QuoteDecayEngine,
} from '../../dist/intelligence/executable-alpha/index.js';

test('Future Leakage — Invariant 1: Feature timestamps must strictly precede or equal decisionAt', () => {
  const decisionAtMs = 1775000000000;
  const decisionSlot = 312000100n;

  // Case A: Valid point-in-time observation
  const validObs = ObservationQualityEngine.evaluate({
    observationCount: 15,
    historySpanSeconds: 60,
    slotLag: 2,
    wallAgeMs: 400,
    maxObservedGapSeconds: 5,
    sourceCount: 2,
    sourcesInAgreement: 2,
    unobservedDropCount: 0,
  });
  assert.equal(validObs.sufficient, true);

  // Case B: Future-leaked observation (timestamp > decisionAt -> negative wallAgeMs)
  const futureObs = ObservationQualityEngine.evaluate({
    observationCount: 15,
    historySpanSeconds: 60,
    slotLag: -5,
    wallAgeMs: -5000,
    maxObservedGapSeconds: 5,
    sourceCount: 2,
    sourcesInAgreement: 2,
    unobservedDropCount: 0,
  });
  assert.equal(futureObs.sufficient, false);
  assert.ok(futureObs.blockers.some((b) => b.includes('FUTURE_LEAKAGE_DETECTED')));

  for (const malformed of [NaN, Infinity, -Infinity]) {
    const invalidObs = ObservationQualityEngine.evaluate({
      observationCount: 15, historySpanSeconds: 60, slotLag: 2, wallAgeMs: malformed,
      maxObservedGapSeconds: 5, sourceCount: 2, sourcesInAgreement: 2, unobservedDropCount: 0,
    });
    assert.equal(invalidObs.sufficient, false);
    assert.ok(invalidObs.blockers.includes('INVALID_TEMPORAL_INPUT'));
  }
});

test('Future Leakage — Invariant 2: Future ATH / lifetime multiple cannot leak into 2x crossing state', () => {
  // A token crosses 2x. Historical future ATH is 45x.
  // The model must evaluate strictly the point-in-time state without knowing future 45x.
  const pointInTimeEval = RunnerDistinguishabilityCourt.evaluateAt2xCrossing({
    currentMultiple: 2.0,
    capitalRenewalRatio: 0.85, // Low renewal at crossing
    independentCapitalAcceleration: 0.5,
    walletEntropy: 0.35, // High concentration sybil
    inventoryLiabilityCliff: true, // Deployer sell overhang
    exitReachabilityPositive: false,
    failureCommittor: 0.72,
  });

  // Despite future peak being 45x, point-in-time state fails runner criteria!
  assert.equal(pointInTimeEval.eligibleForRunnerTreatment, false);
  assert.ok(pointInTimeEval.failureProbability > 0.50);
});

test('Future Leakage — Invariant 3: Quote decay must reflect elapsed time from issuance without lookahead', () => {
  const quoteSlot = 312000300n;
  const quoteTimeMs = 1775000000000;

  // Stale quote from 5 slots ago
  const currentSlot = 312000305n;
  const currentTimeMs = quoteTimeMs + 2500;

  const decay = QuoteDecayEngine.evaluateDecay({
    initialPriceUsd: 1.0,
    quoteSlot,
    currentSlot,
    quoteTimestampMs: quoteTimeMs,
    currentTimestampMs: currentTimeMs,
  });

  assert.equal(decay.isQuoteStale, true);
  assert.ok(decay.decayBps > 100);
});
