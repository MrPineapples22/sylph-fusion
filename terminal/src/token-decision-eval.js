// Real candidate curve & drift telemetry evaluation logic.
// Strictly consumes engine / candidate data and fails safe to pending when telemetry is unavailable.

export const MAX_PRICE_DRIFT_BPS = 200;
export const MAX_LIQUIDITY_DROP_BPS = 200;

export function evaluateTokenDecision({
  asset,
  candidate = null,
  driftTelemetry = null,
  solPriceUsd = 150,
  rejectionReason = null,
  isEligible = false,
  eligibilityNotes = '',
}) {
  if (!asset || asset.id === 'loading') {
    return { isEmpty: true };
  }

  // 1. Reserves & Curve State (driven strictly by candidate, verified on-chain curve, or AMM pool state)
  let realSolReserve = null;
  let realReserveSource = 'none';
  if (candidate?.curve?.realQuoteReserves != null) {
    realSolReserve = Number(BigInt(candidate.curve.realQuoteReserves)) / 1e9;
    realReserveSource = 'candidate_curve_snapshot';
  } else if (candidate?.realReserveSol != null) {
    realSolReserve = Number(candidate.realReserveSol);
    realReserveSource = 'candidate_state';
  } else if (candidate?.realQuoteReserves != null) {
    realSolReserve = Number(BigInt(candidate.realQuoteReserves)) / 1e9;
    realReserveSource = 'candidate_curve';
  } else if (asset.curve?.realQuoteReserves != null) {
    realSolReserve = Number(BigInt(asset.curve.realQuoteReserves)) / 1e9;
    realReserveSource = 'onchain_curve';
  } else if (asset.realReserveSol != null) {
    realSolReserve = Number(asset.realReserveSol);
    realReserveSource = 'asset_state';
  } else if (asset.realQuoteReserves != null) {
    realSolReserve = Number(BigInt(asset.realQuoteReserves)) / 1e9;
    realReserveSource = 'onchain_curve';
  } else if (asset.reserves?.sol != null) {
    realSolReserve = Number(asset.reserves.sol) / 1e9;
    realReserveSource = 'amm_pool_reserves';
  } else if (asset.poolReserves?.sol != null) {
    realSolReserve = Number(asset.poolReserves.sol) / 1e9;
    realReserveSource = 'amm_pool_reserves';
  }
  // Note: We deliberately do NOT infer reserves from liquidityUsd / 2 / solPriceUsd.

  const virtualTokenReserve = candidate?.curve?.virtualTokenReserves != null
    ? Number(candidate.curve.virtualTokenReserves)
    : candidate?.virtualTokenReserves != null
    ? Number(candidate.virtualTokenReserves)
    : asset.curve?.virtualTokenReserves != null
    ? Number(asset.curve.virtualTokenReserves)
    : asset.virtualTokenReserves != null
    ? Number(asset.virtualTokenReserves)
    : asset.virtualTokenReserve != null
    ? Number(asset.virtualTokenReserve)
    : asset.reserves?.token != null
    ? Number(asset.reserves.token) / 1e9
    : null;

  // Curve completion directly from candidate or engine snapshot
  const curveCompleteValue = candidate?.curve?.complete !== undefined
    ? candidate.curve.complete
    : asset.curve?.complete !== undefined
    ? asset.curve.complete
    : asset.complete !== undefined
    ? asset.complete
    : asset.migrated !== undefined
    ? asset.migrated
    : (asset.dex && asset.dex !== 'pumpfun')
    ? true
    : null;

  const isCurveKnown = curveCompleteValue !== null;
  const isCurveComplete = curveCompleteValue === true;

  // 2. Dual-Metric Reserve Drift (actual telemetry from execution engine or dual snapshot)
  let driftPct = null;
  let driftBps = null;
  let driftSource = 'none';
  let isDriftSafe = true;
  let isExcessivePriceDrift = false;
  let isExcessiveLiquidityDrop = false;

  if (candidate?.drift != null && Number.isFinite(candidate.drift.driftBps)) {
    driftBps = candidate.drift.driftBps;
    driftPct = driftBps / 100;
    driftSource = candidate.drift.direction === 'none' ? 'dual_snapshot_reconciled' : `dual_snapshot_${candidate.drift.direction}`;
    isExcessivePriceDrift = candidate.drift.reason === 'EXCESSIVE_PRICE_DRIFT' || (candidate.drift.priceDriftBps != null && candidate.drift.priceDriftBps > MAX_PRICE_DRIFT_BPS);
    isExcessiveLiquidityDrop = candidate.drift.reason === 'EXCESSIVE_LIQUIDITY_DROP' || (candidate.drift.liquidityDropBps != null && candidate.drift.liquidityDropBps > MAX_LIQUIDITY_DROP_BPS);
    isDriftSafe = candidate.drift.passed && !isExcessivePriceDrift && !isExcessiveLiquidityDrop;
  } else if (driftTelemetry != null && Number.isFinite(driftTelemetry.driftBps ?? driftTelemetry.priceDriftPct)) {
    driftBps = driftTelemetry.driftBps != null ? Number(driftTelemetry.driftBps) : Math.round(Number(driftTelemetry.priceDriftPct) * 100);
    driftPct = driftTelemetry.priceDriftPct != null ? Number(driftTelemetry.priceDriftPct) : driftBps / 100;
    driftSource = driftTelemetry.direction ? `dual_snapshot_${driftTelemetry.direction}` : `engine_slot_${driftTelemetry.reconciledAtSlot ?? 'reconciled'}`;
    isExcessivePriceDrift = driftTelemetry.reason === 'EXCESSIVE_PRICE_DRIFT' || (driftTelemetry.priceDriftBps != null && driftTelemetry.priceDriftBps > MAX_PRICE_DRIFT_BPS) || driftBps > MAX_PRICE_DRIFT_BPS;
    isExcessiveLiquidityDrop = driftTelemetry.reason === 'EXCESSIVE_LIQUIDITY_DROP' || (driftTelemetry.liquidityDropBps != null && driftTelemetry.liquidityDropBps > MAX_LIQUIDITY_DROP_BPS) || driftBps < -MAX_LIQUIDITY_DROP_BPS || Boolean(driftTelemetry.adverseSelectionDetected);
    isDriftSafe = (driftTelemetry.passed !== false) && !isExcessivePriceDrift && !isExcessiveLiquidityDrop;
  } else if (asset.drift != null && Number.isFinite(asset.drift.driftBps ?? asset.drift.priceDriftPct)) {
    driftBps = asset.drift.driftBps != null ? Number(asset.drift.driftBps) : Math.round(Number(asset.drift.priceDriftPct) * 100);
    driftPct = asset.drift.priceDriftPct != null ? Number(asset.drift.priceDriftPct) : driftBps / 100;
    driftSource = asset.drift.direction ? `dual_snapshot_${asset.drift.direction}` : `engine_slot_${asset.drift.reconciledAtSlot ?? 'reconciled'}`;
    isExcessivePriceDrift = asset.drift.reason === 'EXCESSIVE_PRICE_DRIFT' || (asset.drift.priceDriftBps != null && asset.drift.priceDriftBps > MAX_PRICE_DRIFT_BPS) || driftBps > MAX_PRICE_DRIFT_BPS;
    isExcessiveLiquidityDrop = asset.drift.reason === 'EXCESSIVE_LIQUIDITY_DROP' || (asset.drift.liquidityDropBps != null && asset.drift.liquidityDropBps > MAX_LIQUIDITY_DROP_BPS) || driftBps < -MAX_LIQUIDITY_DROP_BPS || Boolean(asset.drift.adverseSelectionDetected);
    isDriftSafe = (asset.drift.passed !== false) && !isExcessivePriceDrift && !isExcessiveLiquidityDrop;
  }
  // Note: We deliberately do NOT infer drift from tick_history.

  // 3. Buyer Forensics & Creator Dump (driven by candidate tracker in Engine)
  const actualBuyers = candidate?.buyers != null
    ? candidate.buyers
    : asset.buyers != null
    ? asset.buyers
    : null;

  const isDevSold = candidate?.devSold === true || asset.devSold === true;

  // 4. Token Age (from candidate creation or first verified tick)
  let ageSeconds = null;
  if (candidate?.age != null) {
    ageSeconds = Math.max(0, Math.floor(candidate.age / 1000));
  } else if (candidate?.born != null) {
    ageSeconds = Math.max(0, Math.floor((Date.now() - candidate.born) / 1000));
  } else if (asset.born != null) {
    ageSeconds = Math.max(0, Math.floor((Date.now() - asset.born) / 1000));
  } else if (asset.history?.[0]?.time) {
    ageSeconds = Math.max(0, Math.floor((Date.now() - asset.history[0].time * 1000) / 1000));
  }

  const ageDisplay = ageSeconds != null
    ? (ageSeconds < 60 ? `${ageSeconds}s old` : `${Math.floor(ageSeconds / 60)}m ${ageSeconds % 60}s old`)
    : 'Awaiting timestamp';

  // 5. Pre-Trade Security Checks
  const isMintRevoked = asset.mintAuthority === false || asset.mintAuthority == null;
  const isFreezeRevoked = asset.freezeAuthority === false || asset.freezeAuthority == null;
  const isReserveSufficient = realSolReserve != null ? realSolReserve >= 1.0 : null;
  const isCurveActive = isCurveKnown ? !isCurveComplete : null;

  // 6. AMM Migration Bridge & Bimodal Route Planning
  const migrationState = candidate?.migrationState || asset?.migrationState || (isCurveComplete ? 'MIGRATION_PENDING' : 'BONDING_CURVE');
  const executionRoute = candidate?.executionRoute || asset?.executionRoute || 'JITO_MEV_OPTIMAL';
  const isRaydiumActive = migrationState === 'RAYDIUM_ACTIVE';
  const isSniperCooldown = migrationState === 'SNIPER_COOLDOWN';

  // 7. Final Decision Verdict
  const hasRecordedRejection = !!rejectionReason;
  const isReserveViolated = isReserveSufficient === false;
  const isDriftViolated = driftPct != null && !isDriftSafe;
  const isCurveViolated = isCurveComplete === true && !isRaydiumActive;
  const isDevSoldViolated = isDevSold === true;

  const blocked = hasRecordedRejection || isReserveViolated || isDriftViolated || isCurveViolated || isDevSoldViolated;
  const isTelemetryPending = !blocked && (realSolReserve == null || driftPct == null || !isCurveKnown);

  let decisionBadge = 'DECISION: ELIGIBLE';
  let decisionTone = 'decision-eligible';
  let blockedExplanation = '';

  if (rejectionReason) {
    blockedExplanation = `Rejection: ${rejectionReason}`;
  } else if (isDevSoldViolated) {
    blockedExplanation = 'Rejection: creator_sell_detected (Dev / insider sold on active curve).';
  } else if (isCurveViolated) {
    if (isSniperCooldown) {
      blockedExplanation = 'Rejection: CURVE_COMPLETED (SNIPER_COOLDOWN_ACTIVE: 30s AMM sniper dump defense active).';
    } else {
      blockedExplanation = 'Rejection: CURVE_COMPLETED (Bonding curve is complete; pool migrated).';
    }
  } else if (isReserveViolated) {
    blockedExplanation = `Rejection: Real reserves (${realSolReserve} SOL) below 1.0 SOL safety floor.`;
  } else if (isExcessivePriceDrift) {
    blockedExplanation = `Rejection: EXCESSIVE_PRICE_DRIFT (+${driftPct.toFixed(2)}% > +2.00% limit / +200 BPS). Front-run defense.`;
  } else if (isExcessiveLiquidityDrop) {
    blockedExplanation = `Rejection: EXCESSIVE_LIQUIDITY_DROP (${driftPct.toFixed(2)}% < -2.00% limit / -200 BPS). Dump defense.`;
  } else if (isTelemetryPending) {
    blockedExplanation = 'Awaiting real candidate curve and dual-snapshot drift telemetry before qualifying execution.';
  } else {
    blockedExplanation = eligibilityNotes || (isRaydiumActive ? 'Qualified for execution via Post-Graduation Raydium AMM Bridge.' : 'All configured dual-metric drift bounds and safety filters qualified for execution.');
  }

  if (blocked) {
    decisionBadge = 'DECISION: BLOCKED';
    decisionTone = 'decision-blocked';
  } else if (isTelemetryPending) {
    decisionBadge = 'DECISION: PENDING TELEMETRY';
    decisionTone = 'decision-pending';
  }

  return {
    isEmpty: false,
    realSolReserve,
    realReserveSource,
    virtualTokenReserve,
    curveCompleteValue,
    isCurveKnown,
    isCurveComplete,
    driftPct,
    driftBps,
    driftSource,
    isDriftSafe,
    isExcessivePriceDrift,
    isExcessiveLiquidityDrop,
    actualBuyers,
    isDevSold,
    ageSeconds,
    ageDisplay,
    isMintRevoked,
    isFreezeRevoked,
    isReserveSufficient,
    isCurveActive,
    blocked,
    isTelemetryPending,
    decisionBadge,
    decisionTone,
    blockedExplanation,
    migrationState,
    executionRoute,
    isRaydiumActive,
    isSniperCooldown,
    netEdge: asset.netEdgePct || asset.edge || '+0.0%',
    opportunityStage: asset.decision || 'WATCH',
    spieNetEv: asset.netEdgePct || asset.edge || '+0.0%',
  };
}
