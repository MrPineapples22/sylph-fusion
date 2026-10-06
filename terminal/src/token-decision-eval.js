// Real candidate curve & drift telemetry evaluation logic.
// Strictly consumes engine / candidate data and fails safe to pending when telemetry is unavailable.

export const MAX_PRICE_DRIFT_BPS = 200;
export const MAX_LIQUIDITY_DROP_BPS = 200;

// Empirical alpha thresholds established from 523,351 Solana Pump.fun launches:
// Median observation arrival gap < 1.0s marks genuine competing block-0/1 multi-buyer flow (2x win rate doubles from 14.0% to 28.9%).
export const MAX_DISCOVERY_GAP_SECONDS = 1.0;
// Entry quote must be <= 1.15x initial curve price (preventing frontrun / chasing already-pumped tokens).
export const MAX_OPENING_PRICE_RATIO = 1.15;

// Pre-committed exit contract (STAGED_DERISK_2X_TRAIL yielded Profit Factor 1.121 and +$119k out-of-sample).
export const DEFAULT_EMPIRICAL_EXIT_POLICY = {
  id: 'STAGED_DERISK_2X_TRAIL',
  name: 'Staged Derisk (50% @ 2.0x, Trail -30%, 3m Max Hold)',
  targetMultiple: 2.0,
  deriskFractionBps: 5000, // 50% sell at 2.0x
  stopLossBps: 2500,       // -25% stop
  trailStopBps: 3000,      // -30% trailing stop on remaining runner
  maxHoldSeconds: 180,     // 180s (3m) maximum hold before terminal decay
};

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

  // 3b. Order Flow Velocity & Contemporaneous Microstructure (Empirical Alpha Filter)
  const medianObsGapSec = candidate?.medianObsGapSec ?? candidate?.medianObservationGapSeconds ?? asset?.medianObsGapSec ?? asset?.medianObservationGapSeconds ?? null;
  const initialPriceRatio = candidate?.initialPriceRatio ?? candidate?.openingPriceRatio ?? asset?.initialPriceRatio ?? asset?.openingPriceRatio ?? null;
  const isConcentrationSuspect = candidate?.holderConcentrationSuspect === true || asset?.holderConcentrationSuspect === true;
  const isMayhem = candidate?.isMayhemMode === true || asset?.isMayhemMode === true;
  const isFrontrunSuspect = candidate?.firstPricePrecedesDetection === true || asset?.firstPricePrecedesDetection === true;

  const isExcessiveObservationGap = medianObsGapSec != null && medianObsGapSec > MAX_DISCOVERY_GAP_SECONDS;
  const isExcessiveOpeningPrice = initialPriceRatio != null && initialPriceRatio > MAX_OPENING_PRICE_RATIO;

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
  const isMintRevoked = typeof asset.mintAuthority === 'boolean' ? !asset.mintAuthority : null;
  const isFreezeRevoked = typeof asset.freezeAuthority === 'boolean' ? !asset.freezeAuthority : null;
  const isReserveSufficient = realSolReserve != null ? realSolReserve >= 1.0 : null;
  const isCurveActive = isCurveKnown ? !isCurveComplete : null;

  // 6. AMM Migration Bridge & Bimodal Route Planning
  const migrationState = candidate?.migrationState || asset?.migrationState || (isCurveComplete ? 'MIGRATION_PENDING' : 'BONDING_CURVE');
  const executionRoute = candidate?.executionRoute || asset?.executionRoute || 'UNKNOWN';
  // A completed Pump curve is not itself a rejection.  It becomes a distinct
  // AMM venue once the feed has identified a Raydium pool with observed
  // reserves.  Do not fabricate this from a token's name or a price alone.
  const hasObservedAmmReserves = asset?.reserves?.sol != null || asset?.poolReserves?.sol != null;
  // Pool identity is venue data, not a Raydium-only lifecycle assertion.
  // PumpSwap/PumpAMM and other observed AMMs are valid post-curve venues.
  const observedDex = String(candidate?.dex || asset?.dex || '').toLowerCase();
  const hasObservedAmmPool = Boolean(observedDex && observedDex !== 'pumpfun' && observedDex !== 'pump')
    && hasObservedAmmReserves;
  const isRaydiumActive = migrationState === 'RAYDIUM_ACTIVE'
    || migrationState === 'AMM_STABILIZED'
    || hasObservedAmmPool;
  const isSniperCooldown = migrationState === 'SNIPER_COOLDOWN';

  // 7. Final Decision Verdict
  // Audit logs are historical evidence only.  A previous portfolio, provider,
  // model, or strategy rejection must never become current token authority.
  const isReserveViolated = isReserveSufficient === false;
  const isDriftViolated = driftPct != null && !isDriftSafe;
  // A completed curve without an active Raydium pool is a transitional
  // state (MIGRATION_PENDING), not an economic or security rejection.
  const isMigrationPending = isCurveComplete === true && !isRaydiumActive;
  const isDevSoldViolated = isDevSold === true;
  const isVelocityViolated = isExcessiveObservationGap;
  const isChasingViolated = isExcessiveOpeningPrice;
  const isConcentrationViolated = isConcentrationSuspect;
  const isMayhemViolated = isMayhem;
  const isFrontrunViolated = isFrontrunSuspect;

  const authorityViolated = isMintRevoked === false || isFreezeRevoked === false;
  const blocked = isReserveViolated || isDriftViolated || isDevSoldViolated || authorityViolated
    || isVelocityViolated || isChasingViolated || isConcentrationViolated || isMayhemViolated || isFrontrunViolated;
  const isTelemetryPending = !blocked && (isMigrationPending || realSolReserve == null || driftPct == null || !isCurveKnown || isMintRevoked === null || isFreezeRevoked === null);

  let decisionBadge = 'DECISION: ELIGIBLE';
  let decisionTone = 'decision-eligible';
  let blockedExplanation = '';

  if (authorityViolated) {
    blockedExplanation = 'Rejection: Mint or freeze authority remains active.';
  } else if (isDevSoldViolated) {
    blockedExplanation = 'Rejection: creator_sell_detected (Dev / insider sold on active curve).';
  } else if (isReserveViolated) {
    blockedExplanation = `Rejection: Real reserves (${realSolReserve} SOL) below 1.0 SOL safety floor.`;
  } else if (isExcessivePriceDrift) {
    blockedExplanation = `Rejection: EXCESSIVE_PRICE_DRIFT (+${driftPct.toFixed(2)}% > +2.00% limit / +200 BPS). Front-run defense.`;
  } else if (isExcessiveLiquidityDrop) {
    blockedExplanation = `Rejection: EXCESSIVE_LIQUIDITY_DROP (${driftPct.toFixed(2)}% < -2.00% limit / -200 BPS). Dump defense.`;
  } else if (isConcentrationViolated) {
    blockedExplanation = 'Rejection: SUSPECT_HOLDER_CONCENTRATION (insider cluster detected).';
  } else if (isMayhemViolated) {
    blockedExplanation = 'Rejection: MAYHEM_MODE_ACTIVE (predatory launch configuration).';
  } else if (isFrontrunViolated) {
    blockedExplanation = 'Rejection: FRONTRUN_SUSPECT (price preceded telemetry detection).';
  } else if (isVelocityViolated) {
    blockedExplanation = `Rejection: LOW_ORDER_FLOW_VELOCITY (median arrival gap ${medianObsGapSec.toFixed(2)}s > 1.0s limit; negative net EV).`;
  } else if (isChasingViolated) {
    blockedExplanation = `Rejection: OPENING_PRICE_CHASING (price ${initialPriceRatio.toFixed(2)}x initial curve quote > 1.15x limit).`;
  } else if (isMigrationPending) {
    if (isSniperCooldown) {
      blockedExplanation = 'Pending transition: CURVE_COMPLETED (SNIPER_COOLDOWN_ACTIVE: 30s AMM sniper dump defense active).';
    } else {
      blockedExplanation = 'Pending transition: CURVE_COMPLETED (Bonding curve complete; awaiting observed AMM venue).';
    }
  } else if (isTelemetryPending) {
    blockedExplanation = 'Awaiting verified mint/freeze authority, candidate curve and dual-snapshot drift telemetry before qualifying execution.';
  } else {
    blockedExplanation = eligibilityNotes || (isRaydiumActive ? 'Qualified for execution via Post-Graduation Raydium AMM Bridge.' : 'All configured dual-metric drift bounds and safety filters qualified for execution.');
  }

  if (blocked) {
    decisionBadge = 'DECISION: BLOCKED';
    decisionTone = 'decision-blocked';
  } else if (isMigrationPending) {
    decisionBadge = isSniperCooldown ? 'DECISION: SNIPER COOLDOWN' : 'DECISION: PENDING TRANSITION';
    decisionTone = 'decision-pending';
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
    isMigrationPending,
    isTransitionPending: isMigrationPending,
    netEdge: asset.netEdgePct || asset.edge || '+0.0%',
    opportunityStage: asset.decision || 'WATCH',
    spieNetEv: asset.netEdgePct || asset.edge || '+0.0%',
    medianObsGapSec,
    initialPriceRatio,
    isHighVelocity: medianObsGapSec != null ? !isVelocityViolated : null,
    isPriceChasing: initialPriceRatio != null ? isChasingViolated : null,
    empiricalExitPolicy: DEFAULT_EMPIRICAL_EXIT_POLICY,
  };
}
