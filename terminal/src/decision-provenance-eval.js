import { sha256Hex } from './artifact-manifest-eval.js';
/**
 * Decision Provenance Evaluator
 *
 * Extracts and organizes full point-in-time audit trails for any candidate:
 * - Deterministic snapshot ID and cryptographic seal verification
 * - Slot and dual monotonic timestamps (observedAtMs vs decisionAtMs)
 * - Step-by-step gate evaluation trace from discovery to model inference
 * - Versioned policy, sizing, and exit ladder configuration
 * - Salt-hashed wallet identities and complete telemetry vectors
 */

export const GATE_DEFINITIONS = [
  { id: 'discovery_age', label: '1. Discovery & Age Window', threshold: '>= MIN_AGE_MS' },
  { id: 'buyers_microstructure', label: '2. Buyer Accumulation & Volume', threshold: '>= MIN_BUYERS & buy > 2x sell' },
  { id: 'authority_metadata', label: '3. Token Authority & Safety', threshold: 'Mint & Freeze Revoked' },
  { id: 'curve_state', label: '4. Bonding Curve Active', threshold: 'Not Complete, Not Mayhem' },
  { id: 'reserve_drift', label: '5. Reserve Drift Protection', threshold: '<= 200 bps spot / drop' },
  { id: 'reserve_floor', label: '6. Real Reserve Floor', threshold: '>= MIN_REAL_RESERVE' },
  { id: 'capital_budget', label: '7. Capital & Exposure Budget', threshold: 'Cash >= Buy + Reserve' },
  { id: 'model_gate', label: '8. Model Gate Evaluation', threshold: '<= 10ms inference, score >= threshold' },
];

export function evaluateDecisionProvenance({
  candidate = null,
  snapshot = null,
  asset = null,
  limits = {},
  policyContext = null,
  rejectionReason = null,
} = {}) {
  const now = Date.now();
  const mint = candidate?.mint || asset?.id || 'UnknownMint11111111111111111111111111111111';
  const slot = snapshot?.slot || candidate?.slot || 0;
  const observedAtMs = snapshot?.observedAtMs || candidate?.born || now - 1000;
  const decisionAtMs = snapshot?.decisionAtMs || Math.max(now, observedAtMs);
  const decisionLatencyMs = Math.max(0, decisionAtMs - observedAtMs);

  const candidateId = snapshot?.candidateId || (candidate ? `cand-${mint.slice(0, 8)}-${slot}` : 'unregistered');
  const schemaVersion = snapshot?.schemaVersion || '1.0.0';
  const featureSealHash = snapshot?.featureSealHash || null;

  // Verify seal hash if snapshot features are available
  let sealVerification = {
    hasSeal: !!featureSealHash,
    verified: false,
    sealHash: featureSealHash || 'Unsealed / In-Flight',
    reason: featureSealHash ? 'Seal present' : 'Snapshot not yet sealed',
  };
  if (snapshot && featureSealHash) {
    sealVerification.verified = !!(snapshot.microstructure && snapshot.curveState && snapshot.transport) && featureSealHash === sha256Hex(JSON.stringify({ microstructure:snapshot.microstructure, curveState:snapshot.curveState, transport:snapshot.transport }));
    sealVerification.reason = sealVerification.verified ? 'Feature checksum matches supplied data' : 'Feature checksum mismatch or incomplete data';
  }

  // Sizing and Policy
  const policy = {
    policyVersion: policyContext?.policyVersion || snapshot?.policyContext?.policyVersion || 'fusion-v1.4',
    maxSlippageBps: policyContext?.maxSlippageBps || snapshot?.policyContext?.maxSlippageBps || limits?.slippage || 1200,
    targetSizeLamports: policyContext?.targetSizeLamports || snapshot?.policyContext?.targetSizeLamports || limits?.buy || '100000000',
    targetSizeSol: (Number(policyContext?.targetSizeLamports || snapshot?.policyContext?.targetSizeLamports || limits?.buy || 100000000) / 1e9).toFixed(3),
    priorityFeeMultiplier: policyContext?.priorityFeeMultiplier || snapshot?.policyContext?.priorityFeeMultiplier || 1.0,
    exitLadderConfigHash: policyContext?.exitLadderConfigHash || snapshot?.policyContext?.exitLadderConfigHash || 'ladder-v1-tp20-50-100-stop8',
  };

  // Rejection/Disposition
  const rawDisposition = snapshot?.evaluationDisposition || (rejectionReason ? 'rejected' : 'notEvaluated');
  const effectiveReason = snapshot?.dispositionReason || rejectionReason || (rawDisposition === 'cleared' ? 'Cleared all hard safety checks' : null);

  // Microstructure telemetry
  const micro = {
    buyerCount5m: snapshot?.microstructure?.buyerCount5m ?? (Number.isSafeInteger(candidate?.buyers?.size) ? candidate.buyers.size : null),
    buyTransactionCount: snapshot?.microstructure?.buyTransactionCount ?? null,
    sellTransactionCount: snapshot?.microstructure?.sellTransactionCount ?? null,
    buySellRatio: snapshot?.microstructure?.buySellRatio ?? null,
    buyerArrivalVelocityPerSec: snapshot?.microstructure?.buyerArrivalVelocityPerSec ?? null,
    creatorWalletHashed: snapshot?.microstructure?.creatorWalletHashed || 'hash_unavailable',
    topHoldersHashed: snapshot?.microstructure?.topHoldersHashed || [],
    creatorInitialSupplyPct: snapshot?.microstructure?.creatorInitialSupplyPct ?? 0,
    creatorCurrentBalancePct: snapshot?.microstructure?.creatorCurrentBalancePct ?? 0,
    creatorNetDeltaPct: snapshot?.microstructure?.creatorNetDeltaPct ?? 0,
    streamflowVestingCount: snapshot?.microstructure?.streamflowVestingCount ?? candidate?.streamflowVestingCount ?? 0,
    organicBuyerRatio: snapshot?.microstructure?.organicBuyerRatio ?? candidate?.organicBuyerRatio ?? 1.0,
  };

  // Curve telemetry
  const curve = {
    tokenAgeSeconds: snapshot?.curveState?.tokenAgeSeconds ?? Math.max(0, Math.floor((decisionAtMs - observedAtMs) / 1000)),
    realSolReservesLamports: snapshot?.curveState?.realSolReservesLamports || candidate?.curve?.realQuoteReserves || '0',
    realSolReserves: (Number(snapshot?.curveState?.realSolReservesLamports || candidate?.curve?.realQuoteReserves || 0) / 1e9).toFixed(3),
    virtualSolReservesLamports: snapshot?.curveState?.virtualSolReservesLamports || candidate?.curve?.virtualQuoteReserves || '0',
    virtualTokenReserves: snapshot?.curveState?.virtualTokenReserves || candidate?.curve?.virtualTokenReserves || '0',
    curveCompletionPct: 'Unavailable',
    reserveDriftPct: Number(snapshot?.curveState?.reserveDriftPct ?? (candidate?.drift ? candidate.drift.priceDriftBps / 100 : 0)).toFixed(2),
    spotPriceUsd: Number(snapshot?.curveState?.spotPriceUsd ?? (asset?.price || 0)),
  };

  // Transport telemetry
  const transport = {
    quoteAgeMs: snapshot?.transport?.quoteAgeMs ?? 0,
    leadingRpcLatencyMs: snapshot?.transport?.leadingRpcLatencyMs ?? 0,
    trailingRpcDropRatePct: snapshot?.transport?.trailingRpcDropRatePct ?? 0,
    inFlightOrderCount: snapshot?.transport?.inFlightOrderCount ?? 0,
    oldestPendingAgeMs: snapshot?.transport?.oldestPendingAgeMs ?? 0,
    reservedCashRatio: Number((snapshot?.transport?.reservedCashRatio ?? 0).toFixed(2)),
  };

  // Distribution provenance (Streamflow vs Organic)
  const streamflowVestingCount = snapshot?.distributionProvenance?.streamflowVestingCount ?? candidate?.streamflowVestingCount ?? micro.streamflowVestingCount;
  const organicBuyerRatio = snapshot?.distributionProvenance?.organicBuyerRatio ?? candidate?.organicBuyerRatio ?? micro.organicBuyerRatio;
  const distribution = {
    streamflowVestingCount,
    organicBuyerRatio,
    airdropRecipientCount: snapshot?.distributionProvenance?.airdropRecipientCount ?? 0,
    batchDistributionCount: snapshot?.distributionProvenance?.batchDistributionCount ?? 0,
    isSybilRiskElevated: streamflowVestingCount > 3 || organicBuyerRatio < 0.5,
  };

  // Macro yield hurdle intelligence (Exponent, Lulo)
  const yieldBenchmark = {
    luloProtectedApyPct: snapshot?.yieldBenchmark?.luloProtectedApyPct ?? 8.2,
    exponentPtYieldApyPct: snapshot?.yieldBenchmark?.exponentPtYieldApyPct ?? 9.5,
    solanaRiskFreeAprPct: snapshot?.yieldBenchmark?.solanaRiskFreeAprPct ?? 8.85,
    hurdleRateAnnualizedPct: snapshot?.yieldBenchmark?.hurdleRateAnnualizedPct ?? 35.4, // 4x safe hurdle
    opportunityCostScore: snapshot?.yieldBenchmark?.opportunityCostScore ?? 0.55,
    regimeState: snapshot?.yieldBenchmark?.regimeState ?? 'BALANCED_HURDLE',
    isMemeRiskWorthwhile: (snapshot?.yieldBenchmark?.isMemeRiskWorthwhile ?? true) && (curve.spotPriceUsd > 0),
  };

  // Gate Trace Reconstruction
  const gates = reconstructGateTrace({
    candidate,
    snapshot,
    micro,
    curve,
    effectiveReason,
    rawDisposition,
  });

  // Model Evaluation Trace
  const isModelUnavailable = rawDisposition === 'modelUnavailable' || (effectiveReason && effectiveReason.includes('ml_inference'));
  const modelEvaluation = {
    enabled: false, mode: 'observational',
    disposition: rawDisposition,
    status: isModelUnavailable ? 'UNAVAILABLE' : 'NOT_RECORDED',
    score: null, confidence: null, inferenceLatencyMs: null,
    timeoutCapMs: 10, abortTriggered: snapshot?.modelAbortTriggered ?? false,
    reason: isModelUnavailable ? effectiveReason : 'No recorded model result attached to this decision.',
  };

  return {
    candidateId,
    schemaVersion,
    mint,
    slot,
    observedAtMs,
    decisionAtMs,
    decisionLatencyMs,
    timestamps: {
      observedUtc: new Date(observedAtMs).toISOString(),
      decisionUtc: new Date(decisionAtMs).toISOString(),
      ageFormatted: `${Math.max(0, Math.floor((now - observedAtMs) / 1000))}s ago`,
    },
    seal: sealVerification,
    disposition: rawDisposition,
    dispositionReason: effectiveReason,
    policy,
    gates,
    microstructure: micro,
    curveState: curve,
    transport,
    distribution,
    yieldBenchmark,
    modelEvaluation,
    provenanceSeal: {
      verifiedMonotonic: decisionAtMs >= observedAtMs,
      verifiedSlot: slot > 0,
      privacyPreserved: micro.creatorWalletHashed.length === 64,
    },
  };
}

function reconstructGateTrace({
  candidate,
  snapshot,
  micro,
  curve,
  effectiveReason,
  rawDisposition,
}) {
  const trace = [];
  const reasonLower = (effectiveReason || '').toLowerCase();

  // Gate 1: Discovery & Age
  const ageFailed = reasonLower.includes('age') || reasonLower.includes('too_young');
  trace.push({
    id: 'discovery_age',
    label: '1. Discovery & Age Window',
    status: ageFailed ? 'failed' : 'passed',
    summary: ageFailed ? 'Rejected: Age below minimum floor' : 'Passed: Token reached minimum age',
    details: `Age: ${curve.tokenAgeSeconds}s (threshold: >= 15s)`,
  });

  // Gate 2: Buyer Accumulation
  const buyersFailed = reasonLower.includes('buyer') || reasonLower.includes('insufficient_buyers') || reasonLower.includes('imbalance');
  trace.push({
    id: 'buyers_microstructure',
    label: '2. Buyer Accumulation & Volume',
    status: buyersFailed ? 'failed' : ageFailed ? 'skipped' : 'passed',
    summary: buyersFailed ? 'Rejected: Insufficient distinct buyers or buy/sell imbalance' : 'Passed: Buyer velocity verified',
    details: `${micro.buyerCount5m} distinct buyers, ratio: ${micro.buySellRatio}x (threshold: >= 8 buyers, buy > 2x sell)`,
  });

  // Gate 3: Authority Checks
  const authFailed = reasonLower.includes('authority') || reasonLower.includes('freeze') || reasonLower.includes('mint_authority');
  trace.push({
    id: 'authority_metadata',
    label: '3. Token Authority & Safety',
    status: authFailed ? 'failed' : (ageFailed || buyersFailed) ? 'skipped' : 'passed',
    summary: authFailed ? 'Rejected: Active mint or freeze authority detected' : 'Passed: Mint & freeze authorities permanently revoked',
    details: 'Authority: Revoked / TLV: Safe Metadata only',
  });

  // Gate 4: Curve Mode
  const curveFailed = reasonLower.includes('complete') || reasonLower.includes('mayhem') || reasonLower.includes('unsupported curve');
  trace.push({
    id: 'curve_state',
    label: '4. Bonding Curve Active',
    status: curveFailed ? 'failed' : (ageFailed || buyersFailed || authFailed) ? 'skipped' : 'passed',
    summary: curveFailed ? 'Rejected: Curve already completed or in Mayhem mode' : 'Passed: Native SOL bonding curve active',
    details: `Completion: ${curve.curveCompletionPct}%`,
  });

  // Gate 5: Reserve Drift
  const driftFailed = reasonLower.includes('drift') || reasonLower.includes('price_drift') || reasonLower.includes('liquidity_drop');
  trace.push({
    id: 'reserve_drift',
    label: '5. Reserve Drift Protection',
    status: driftFailed ? 'failed' : (ageFailed || buyersFailed || authFailed || curveFailed) ? 'skipped' : 'passed',
    summary: driftFailed ? `Rejected: ${effectiveReason}` : 'Passed: Reserves stable within 200 bps threshold',
    details: `Drift: ${curve.reserveDriftPct}% vs 2.0% cap`,
  });

  // Gate 6: Real Reserve Floor
  const reserveFailed = reasonLower.includes('insufficient real reserves') || reasonLower.includes('reserve_floor');
  trace.push({
    id: 'reserve_floor',
    label: '6. Real Reserve Floor',
    status: reserveFailed ? 'failed' : (ageFailed || buyersFailed || authFailed || curveFailed || driftFailed) ? 'skipped' : 'passed',
    summary: reserveFailed ? 'Rejected: Real quote reserve below 1.0 SOL floor' : 'Passed: Real liquidity meets safety floor',
    details: `Real Reserves: ${curve.realSolReserves} SOL (floor: >= 1.0 SOL)`,
  });

  // Gate 7: Capital Budget
  const budgetFailed = reasonLower.includes('insufficient_cash') || reasonLower.includes('exposure') || reasonLower.includes('max_positions');
  trace.push({
    id: 'capital_budget',
    label: '7. Capital & Exposure Budget',
    status: budgetFailed ? 'failed' : (ageFailed || buyersFailed || authFailed || curveFailed || driftFailed || reserveFailed) ? 'skipped' : 'passed',
    summary: budgetFailed ? `Rejected: ${effectiveReason}` : 'Passed: Risk budget and cash headroom open',
    details: budgetFailed ? effectiveReason : 'Cash > Buy + Reserve floor',
  });

  // Gate 8: Model Gate
  const modelFailed = rawDisposition === 'modelUnavailable' || reasonLower.includes('model') || reasonLower.includes('ml_inference');
  trace.push({
    id: 'model_gate',
    label: '8. Model Gate Evaluation',
    status: modelFailed ? 'failed' : rawDisposition === 'cleared' ? 'passed' : 'skipped',
    summary: modelFailed ? `Failed Closed: ${effectiveReason}` : rawDisposition === 'cleared' ? 'Passed: Model inference approved within 10ms' : 'Skipped: Hard safety filter tripped earlier',
    details: modelFailed ? effectiveReason : rawDisposition === 'cleared' ? 'Inference: 2.1ms (cap: 10.0ms), Score: 0.85' : 'Evaluation bypassed',
  });

  return trace.map(g => g.status === 'passed' ? {...g, status:'skipped', summary:'Individual gate result not recorded', details:'An overall disposition does not prove this gate was evaluated.'} : g);
}
