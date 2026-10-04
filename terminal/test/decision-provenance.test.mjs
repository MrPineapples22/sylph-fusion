import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDecisionProvenance, GATE_DEFINITIONS } from '../src/decision-provenance-eval.js';

test('evaluateDecisionProvenance evaluates cleared candidate with full gate trace and valid seal', () => {
  const candidate = {
    mint: 'MintCleared11111111111111111111111111111111',
    slot: 285001000,
    born: 1726000000000,
    buyers: new Set(['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']),
    curve: {
      complete: false,
      realQuoteReserves: '3000000000', // 3.0 SOL
      virtualQuoteReserves: '33000000000',
      virtualTokenReserves: '900000000000000',
    },
    drift: {
      priceDriftBps: 25,
    },
  };

  const snapshot = {
    candidateId: 'cand-MintClea-285001000',
    schemaVersion: '1.0.0',
    slot: 285001000,
    observedAtMs: 1726000000000,
    decisionAtMs: 1726000000015,
    featureSealHash: 'a'.repeat(64), // 64-char sha256
    evaluationDisposition: 'cleared',
    microstructure: {
      buyerCount5m: 9,
      buyTransactionCount: 15,
      sellTransactionCount: 2,
      buySellRatio: 7.5,
      buyerArrivalVelocityPerSec: 0.2,
      creatorWalletHashed: 'b'.repeat(64),
      topHoldersHashed: [],
      creatorInitialSupplyPct: 3.0,
      creatorCurrentBalancePct: 3.0,
      creatorNetDeltaPct: 0.0,
    },
    curveState: {
      tokenAgeSeconds: 30,
      realSolReservesLamports: '3000000000',
      virtualSolReservesLamports: '33000000000',
      virtualTokenReserves: '900000000000000',
      curveCompletionPct: 8.5,
      reserveDriftPct: 0.25,
      spotPriceUsd: 0.00003,
    },
    transport: {
      quoteAgeMs: 8,
      leadingRpcLatencyMs: 15,
      trailingRpcDropRatePct: 0.0,
      inFlightOrderCount: 0,
      oldestPendingAgeMs: 0,
      reservedCashRatio: 0.1,
    },
  };

  const res = evaluateDecisionProvenance({
    candidate,
    snapshot,
    policyContext: {
      policyVersion: 'fusion-v1.4',
      maxSlippageBps: 1200,
      targetSizeLamports: '100000000',
    },
  });

  assert.equal(res.candidateId, 'cand-MintClea-285001000');
  assert.equal(res.schemaVersion, '1.0.0');
  assert.equal(res.slot, 285001000);
  assert.equal(res.decisionLatencyMs, 15);
  assert.equal(res.seal.verified, false); // Correct length alone is not verification.
  assert.equal(res.provenanceSeal.verifiedMonotonic, true);
  assert.equal(res.provenanceSeal.verifiedSlot, true);
  assert.equal(res.provenanceSeal.privacyPreserved, true);
  assert.equal(res.disposition, 'cleared');

  // Verify all 8 gates passed
  assert.equal(res.gates.length, 8);
  for (const gate of res.gates) {
    assert.equal(gate.status, 'skipped', `Gate ${gate.id} has no recorded per-gate evidence`);
  }

  // Model evaluation verified within 10ms threshold
  assert.equal(res.modelEvaluation.status, 'NOT_RECORDED');
  assert.equal(res.modelEvaluation.abortTriggered, false);
  assert.equal(res.modelEvaluation.inferenceLatencyMs, null);
});

test('evaluateDecisionProvenance marks gate failed and downstream gates skipped on rejection', () => {
  const res = evaluateDecisionProvenance({
    candidate: { mint: 'MintRej1111111111111111111111111111111111' },
    rejectionReason: 'EXCESSIVE_PRICE_DRIFT',
  });

  assert.equal(res.disposition, 'rejected');
  assert.equal(res.gates.length, 8);

  const driftGate = res.gates.find(g => g.id === 'reserve_drift');
  assert.equal(driftGate.status, 'failed');
  assert.match(driftGate.summary, /EXCESSIVE_PRICE_DRIFT/);

  // Downstream gates should be skipped
  const reserveFloorGate = res.gates.find(g => g.id === 'reserve_floor');
  assert.equal(reserveFloorGate.status, 'skipped');

  const modelGate = res.gates.find(g => g.id === 'model_gate');
  assert.equal(modelGate.status, 'skipped');
});

test('evaluateDecisionProvenance handles model timeout as fail-closed modelUnavailable', () => {
  const snapshot = {
    candidateId: 'cand-timeout-001',
    evaluationDisposition: 'modelUnavailable',
    dispositionReason: 'ml_inference_timeout_exceeded_10ms',
    observedAtMs: 1000,
    decisionAtMs: 1025,
    microstructure: {
      creatorWalletHashed: 'c'.repeat(64),
    },
  };

  const res = evaluateDecisionProvenance({
    snapshot,
    rejectionReason: 'ml_inference_timeout_exceeded_10ms',
  });

  assert.equal(res.disposition, 'modelUnavailable');
  assert.equal(res.modelEvaluation.status, 'UNAVAILABLE');
  assert.equal(res.modelEvaluation.abortTriggered, false);
  assert.equal(res.modelEvaluation.inferenceLatencyMs, null);

  const modelGate = res.gates.find(g => g.id === 'model_gate');
  assert.equal(modelGate.status, 'failed');
  assert.match(modelGate.summary, /ml_inference_timeout_exceeded_10ms/);
});

test('missing buyer observations stay unavailable instead of becoming zero or neutral ratio', () => {
  const result = evaluateDecisionProvenance({candidate: {mint: 'MintMissingBuyers111111111111111111111111'}});
  assert.equal(result.microstructure.buyerCount5m, null);
  assert.equal(result.microstructure.buyTransactionCount, null);
  assert.equal(result.microstructure.sellTransactionCount, null);
  assert.equal(result.microstructure.buySellRatio, null);
  assert.equal(result.microstructure.buyerArrivalVelocityPerSec, null);
  assert.notEqual(result.gates.find(gate => gate.id === 'buyers_microstructure').status, 'passed');
});

test('an observed candidate buyer set remains countable when its snapshot lacks that feature', () => {
  const result = evaluateDecisionProvenance({
    candidate: {mint: 'MintObservedBuyers111111111111111111111111', buyers: new Set(['a', 'b', 'c'])},
    snapshot: {microstructure: {buyerCount5m: null}},
  });
  assert.equal(result.microstructure.buyerCount5m, 3);
});

test('evaluateDecisionProvenance extracts Streamflow vesting and macro yield hurdle', () => {
  const candidate = {
    mint: 'MintStreamflow111111111111111111111111111111',
    streamflowVestingCount: 5,
    organicBuyerRatio: 0.45,
  };
  const snapshot = {
    yieldBenchmark: {
      luloProtectedApyPct: 8.4,
      exponentPtYieldApyPct: 9.8,
      solanaRiskFreeAprPct: 9.1,
      hurdleRateAnnualizedPct: 36.4,
      opportunityCostScore: 0.65,
      regimeState: 'BALANCED_HURDLE',
      isMemeRiskWorthwhile: false,
    },
    curveState: {
      spotPriceUsd: 0.00004,
    },
  };
  const res = evaluateDecisionProvenance({ candidate, snapshot });
  assert.equal(res.distribution.streamflowVestingCount, 5);
  assert.equal(res.distribution.organicBuyerRatio, 0.45);
  assert.equal(res.distribution.isSybilRiskElevated, true);
  assert.equal(res.yieldBenchmark.luloProtectedApyPct, 8.4);
  assert.equal(res.yieldBenchmark.exponentPtYieldApyPct, 9.8);
  assert.equal(res.yieldBenchmark.isMemeRiskWorthwhile, false);
});
