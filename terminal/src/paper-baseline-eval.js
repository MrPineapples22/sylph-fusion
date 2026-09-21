/**
 * Paper-vs-Baseline Comparison Evaluator
 *
 * Compares current simulated paper results against the deterministic baseline strategy:
 * - Net P&L after full friction deduction (DEX price impact, priority fees, tips, ATA rent, slippage)
 * - Maximum drawdown, rolling drawdown headroom, hit rate, and payoff ratio
 * - Trade exit stage distribution (TP1, TP2, TP3, stop_loss, censored)
 * - Filter Alpha & Opportunity Cost: Avoided losses (dump/rug rejections) vs missed upside
 */

export function evaluatePaperVsBaselineComparison({
  paperSession = null,
  baselineSession = null,
  outcomes = [],
  candidates = [],
  fills = [],
  solPriceUsd = 150,
  rollingDrawdownCapPct = 8.0,
} = {}) {
  const toSol = (lamports) => Number(lamports || 0) / 1e9;
  const toUsd = (lamports) => toSol(lamports) * solPriceUsd;

  // Process paper session trades / outcomes
  const rawOutcomes = outcomes && outcomes.length > 0
    ? outcomes
    : (paperSession?.outcomes || []);

  const paperStats = aggregateSessionStats(rawOutcomes, fills, solPriceUsd);

  // Baseline stats: either passed from baselineSession or derived from deterministic rules
  const rawBaselineOutcomes = baselineSession?.outcomes || [];
  const baselineStats = aggregateSessionStats(rawBaselineOutcomes, baselineSession?.fills || [], solPriceUsd);

  // Filter Alpha & Opportunity Cost Breakdown
  const filterAlpha = evaluateFilterAlpha({
    candidates: candidates.length > 0 ? candidates : (paperSession?.candidates || []),
    solPriceUsd,
  });

  // Sample Validity & Analytical Integrity Flags
  const modelUnavailableCount = (candidates || []).filter(c =>
    c.evaluationDisposition === 'modelUnavailable' ||
    c.disposition === 'modelUnavailable' ||
    c.modelStatus === 'modelUnavailable'
  ).length;

  const isSmallSample = paperStats.tradeCount < 30;
  const isSyntheticOrReplay = Boolean(paperSession?.isReplay || paperSession?.synthetic);
  const isPreliminary = isSmallSample || isSyntheticOrReplay || paperStats.censoredCount > 0;

  const sampleValidity = {
    isSmallSample,
    isSyntheticOrReplay,
    isPreliminary,
    totalTrades: paperStats.tradeCount,
    resolvedTrades: paperStats.resolvedTrades,
    censoredCount: paperStats.censoredCount,
    modelUnavailableCount,
    rejectedCount: filterAlpha.rejectedCount,
    auditClassification: isSmallSample ? 'PRELIMINARY_SAMPLE' : 'POPULATED_SOAK',
    warningTitle: `STATISTICAL LIMITATION · PRELIMINARY DATASET (N = ${paperStats.tradeCount})`,
    warningMessage: `This benchmark demonstrates pipeline mechanics, right-censoring, and friction reconciliation over a preliminary dataset. It does NOT represent statistical proof of trading profitability or strategy edge. Defensible strategy conclusions require a populated 24-hour paper soak (N ≥ 30) under dedicated RPC conditions with <5% drop rate.`,
    censoredNotice: paperStats.censoredCount > 0
      ? `${paperStats.censoredCount} active position(s) at observation cutoff are right-censored and excluded from win/loss attribution (0% loss imputation to prevent survivorship bias).`
      : null,
    unavailableNotice: modelUnavailableCount > 0
      ? `${modelUnavailableCount} candidate(s) were fail-closed as model-unavailable (inference timeout > 10ms or incomplete features) and tracked separately to prevent selection bias.`
      : null,
  };

  // Comparative Deltas
  const netPnlDeltaSol = paperStats.netReturnSol - baselineStats.netReturnSol;
  const netPnlDeltaUsd = paperStats.netReturnUsd - baselineStats.netReturnUsd;
  const winRateDelta = paperStats.winRatePct - baselineStats.winRatePct;
  const profitFactorDelta = paperStats.profitFactor - baselineStats.profitFactor;
  const maxDrawdownDelta = paperStats.maxDrawdownPct - baselineStats.maxDrawdownPct;
  const frictionSavingsSol = baselineStats.frictionTotalSol - paperStats.frictionTotalSol;

  return {
    paper: paperStats,
    baseline: baselineStats,
    baselineAvailable: rawBaselineOutcomes.length > 0,
    comparisonAvailable: rawBaselineOutcomes.length > 0 && rawOutcomes.length > 0,
    sampleValidity,
    deltas: rawBaselineOutcomes.length > 0 && rawOutcomes.length > 0 ? {
      netPnlDeltaSol: Number(netPnlDeltaSol.toFixed(4)),
      netPnlDeltaUsd: Number(netPnlDeltaUsd.toFixed(2)),
      winRateDelta: Number(winRateDelta.toFixed(1)),
      profitFactorDelta: Number(profitFactorDelta.toFixed(2)),
      maxDrawdownDelta: Number(maxDrawdownDelta.toFixed(1)),
      frictionSavingsSol: Number(frictionSavingsSol.toFixed(4)),
      paperOutperformed: netPnlDeltaSol >= 0,
    } : null,
    drawdownStatus: {
      currentDrawdownPct: paperStats.maxDrawdownPct,
      capPct: rollingDrawdownCapPct,
      headroomPct: Math.max(0, rollingDrawdownCapPct - paperStats.maxDrawdownPct),
      breached: paperStats.maxDrawdownPct > rollingDrawdownCapPct,
    },
    filterAlpha,
  };
}

export function aggregateSessionStats(outcomes = [], fills = [], solPriceUsd = 150) {
  let costBasisLamports = 0n;
  let grossProceedsLamports = 0n;
  let dexImpactLamports = 0n;
  let priorityFeeLamports = 0n;
  let jitoTipLamports = 0n;
  let ataRentLamports = 0n;
  let totalFrictionLamports = 0n;
  let netReturnLamports = 0n;

  let winsCount = 0;
  let lossesCount = 0;
  let censoredCount = 0;
  let grossWinsLamports = 0n;
  let grossLossesLamports = 0n;

  let totalDurationMs = 0;
  const exitStageCounts = {
    tp1: 0,
    tp2: 0,
    tp3: 0,
    stop_loss: 0,
    censored: 0,
    manual: 0,
  };

  // Peak equity tracking for drawdown
  let runningEquityLamports = 0n;
  let peakEquityLamports = 0n;
  let maxDrawdownLamports = 0n;

  for (const outcome of outcomes) {
    if (outcome.censored) {
      censoredCount++; exitStageCounts.censored++;
      continue;
    }
    const cost = BigInt(String(outcome.costBasisLamports || '0'));
    const proceeds = BigInt(String(outcome.grossProceedsLamports || '0'));
    const dex = BigInt(String(outcome.dexImpactLamports || '0'));
    const priority = BigInt(String(outcome.priorityFeeLamports || '0'));
    const tip = BigInt(String(outcome.jitoTipLamports || '0'));
    const rent = BigInt(String(outcome.ataRentLamports || '0'));
    const friction = outcome.frictionTotalLamports
      ? BigInt(String(outcome.frictionTotalLamports))
      : (outcome.totalFrictionLamports
        ? BigInt(String(outcome.totalFrictionLamports))
        : dex + priority + tip + rent);

    const net = outcome.netReturnLamports
      ? BigInt(String(outcome.netReturnLamports))
      : (outcome.netRealizedPnlLamports
        ? BigInt(String(outcome.netRealizedPnlLamports))
        : proceeds - cost - friction);

    costBasisLamports += cost;
    grossProceedsLamports += proceeds;
    dexImpactLamports += dex;
    priorityFeeLamports += priority;
    jitoTipLamports += tip;
    ataRentLamports += rent;
    totalFrictionLamports += friction;
    netReturnLamports += net;

    totalDurationMs += Number(outcome.observationDurationMs || outcome.holdingPeriodMs || 0);

    // Track running equity and drawdown
    runningEquityLamports += net;
    if (runningEquityLamports > peakEquityLamports) {
      peakEquityLamports = runningEquityLamports;
    }
    const currentDrawdown = peakEquityLamports - runningEquityLamports;
    if (currentDrawdown > maxDrawdownLamports) {
      maxDrawdownLamports = currentDrawdown;
    }

    if (outcome.censored) {
      censoredCount++;
      exitStageCounts.censored++;
    } else if (net > 0n) {
      winsCount++;
      grossWinsLamports += net;
      if (outcome.exitStage === 1) exitStageCounts.tp1++;
      else if (outcome.exitStage === 2) exitStageCounts.tp2++;
      else if (outcome.exitStage === 3) exitStageCounts.tp3++;
      else exitStageCounts.tp1++;
    } else {
      lossesCount++;
      grossLossesLamports += -net;
      if (outcome.terminalState === 'stop_loss') exitStageCounts.stop_loss++;
      else exitStageCounts.manual++;
    }
  }

  const resolvedTrades = winsCount + lossesCount;
  const winRatePct = resolvedTrades > 0 ? (winsCount / resolvedTrades) * 100 : 0;
  const lossRatePct = resolvedTrades > 0 ? (lossesCount / resolvedTrades) * 100 : 0;

  const avgWinLamports = winsCount > 0 ? Number(grossWinsLamports) / winsCount : 0;
  const avgLossLamports = lossesCount > 0 ? Number(grossLossesLamports) / lossesCount : 0;
  const payoffRatio = avgLossLamports > 0 ? avgWinLamports / avgLossLamports : avgWinLamports > 0 ? 99.0 : 0;
  const profitFactor = grossLossesLamports > 0n
    ? Number(grossWinsLamports) / Number(grossLossesLamports)
    : grossWinsLamports > 0n ? 99.0 : 0;

  const toSol = (l) => Number(l) / 1e9;
  const toUsd = (l) => toSol(l) * solPriceUsd;

  const maxDrawdownPct = costBasisLamports > 0n
    ? (Number(maxDrawdownLamports) / Number(costBasisLamports)) * 100
    : 0;

  const returnOnCostPct = costBasisLamports > 0n
    ? (Number(netReturnLamports) / Number(costBasisLamports)) * 100
    : 0;

  return {
    tradeCount: outcomes.length,
    resolvedTrades,
    winsCount,
    lossesCount,
    censoredCount,
    winRatePct: Number(winRatePct.toFixed(1)),
    lossRatePct: Number(lossRatePct.toFixed(1)),
    payoffRatio: Number(payoffRatio.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    avgDurationSec: outcomes.length > 0 ? Math.round(totalDurationMs / outcomes.length / 1000) : 0,
    costBasisSol: toSol(costBasisLamports),
    grossProceedsSol: toSol(grossProceedsLamports),
    frictionTotalSol: toSol(totalFrictionLamports),
    frictionDexSol: toSol(dexImpactLamports),
    frictionPrioritySol: toSol(priorityFeeLamports),
    frictionTipSol: toSol(jitoTipLamports),
    frictionRentSol: toSol(ataRentLamports),
    netReturnSol: toSol(netReturnLamports),
    netReturnUsd: toUsd(netReturnLamports),
    returnOnCostPct: Number(returnOnCostPct.toFixed(2)),
    maxDrawdownSol: toSol(maxDrawdownLamports),
    maxDrawdownPct: Number(maxDrawdownPct.toFixed(1)),
    exitStages: exitStageCounts,
  };
}

export function evaluateFilterAlpha({ candidates = [] } = {}) {
  // Decision-time features cannot establish a rejected token's counterfactual P&L.
  return {
    available: false,
    reason: 'Requires recorded counterfactual outcomes with matching policy, horizon and execution costs.',
    rejectedCount: candidates.filter(c => (c.evaluationDisposition || c.disposition) === 'rejected').length,
    lossAvoidedCount: 0, missedUpsideCount: 0, neutralCount: 0,
    avoidedLossSol: null, missedUpsideSol: null,
    netFilterAlphaSol: null, netFilterAlphaUsd: null, filterAlphaPositive: null,
  };
}
