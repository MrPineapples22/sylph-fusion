/**
 * SYLPH FUSION — MONTE CARLO BANKROLL & RUIN ENGINE
 * Specifications: Master Blueprint Sections X, CV, CVI, CVII, CXIII
 *
 * Simulates thousands of bootstrapped/generative bankroll paths under:
 * 1. PAPER_STANDARD (conservative capital controls, 500 bps DD halt, 3 fails halt)
 * 2. PAPER_AGGRESSIVE (higher Kelly fraction, wider stops)
 * 3. PAPER_MAX_RISK (unrestricted risk, 100% sizing, zero halts, simulated bankruptcy permitted)
 *
 * Invariants:
 * - Bankroll hitting zero is an explicit BANKRUPT terminal outcome; NEVER reset.
 * - Compute P(bankrupt), P(2x), P(5x), P(10x), P(100x), and percentiles (p1, p10, p50, p90, p99).
 * - Evaluate log-growth E[log W_T] and luck-adjusted performance (excluding top 1/3/10 trades).
 */

import { PaperAuthorityMode } from './paper-authority-policy.js';

export interface MonteCarloTradeOutcome {
  readonly returnMultiple: number; // e.g. 0.0 (total loss/rug), 0.8 (-20%), 2.0 (+100%), 10.0 (10x), 100.0 (100x)
  readonly holdingTimeSeconds: number;
  readonly isRug: boolean;
}

export interface MonteCarloPathResult {
  readonly pathId: number;
  readonly mode: PaperAuthorityMode;
  readonly startingEquityUsd: number;
  readonly terminalEquityUsd: number;
  readonly maxEquityUsd: number;
  readonly maxDrawdownBps: number;
  readonly isBankrupt: boolean;
  readonly tradesExecuted: number;
  readonly timeToRuinSeconds: number | null;
  readonly reached2x: boolean;
  readonly reached5x: boolean;
  readonly reached10x: boolean;
  readonly reached100x: boolean;
  readonly logWealthRatio: number; // log(W_T / W_0)
}

export interface MonteCarloSimulationSummary {
  readonly mode: PaperAuthorityMode;
  readonly startingCapitalUsd: number;
  readonly totalPaths: number;
  readonly bankruptcyProbability: number;
  readonly p2xProbability: number;
  readonly p5xProbability: number;
  readonly p10xProbability: number;
  readonly p100xProbability: number;
  readonly medianTerminalEquityUsd: number;
  readonly meanTerminalEquityUsd: number;
  readonly percentiles: {
    readonly p1: number;
    readonly p5: number;
    readonly p10: number;
    readonly p25: number;
    readonly p50: number;
    readonly p75: number;
    readonly p90: number;
    readonly p95: number;
    readonly p99: number;
  };
  readonly medianDrawdownBps: number;
  readonly p95DrawdownBps: number;
  readonly worstDrawdownBps: number;
  readonly expectedLogGrowth: number;
  readonly luckAdjusted: {
    readonly totalReturnPct: number;
    readonly returnWithoutBestTradePct: number;
    readonly returnWithoutTop3Pct: number;
    readonly returnWithoutTop10Pct: number;
    readonly extremeWinnerContributionPct: number;
  };
}

export class MonteCarloBankrollEngine {
  /**
   * Runs Monte Carlo simulation across N paths using empirical trade distribution.
   */
  public static simulatePaths(params: {
    mode: PaperAuthorityMode;
    startingCapitalUsd: number;
    numPaths: number;
    tradesPerPath: number;
    empiricalOutcomes: readonly MonteCarloTradeOutcome[];
    sizingFraction: number; // e.g., 0.1 for 10%, 1.0 for 100% max risk
  }): MonteCarloSimulationSummary {
    const { mode, startingCapitalUsd, numPaths, tradesPerPath, empiricalOutcomes, sizingFraction } = params;
    const paths: MonteCarloPathResult[] = [];

    // Fallback distribution if empirical dataset is small
    const outcomes = empiricalOutcomes.length > 0 ? empiricalOutcomes : [
      { returnMultiple: 0.0, holdingTimeSeconds: 45, isRug: true },
      { returnMultiple: 0.1, holdingTimeSeconds: 60, isRug: true },
      { returnMultiple: 0.7, holdingTimeSeconds: 90, isRug: false },
      { returnMultiple: 0.9, holdingTimeSeconds: 120, isRug: false },
      { returnMultiple: 1.3, holdingTimeSeconds: 150, isRug: false },
      { returnMultiple: 2.0, holdingTimeSeconds: 300, isRug: false },
      { returnMultiple: 5.0, holdingTimeSeconds: 600, isRug: false },
      { returnMultiple: 15.0, holdingTimeSeconds: 1200, isRug: false },
    ];

    const allExecutedReturns: number[] = [];

    for (let pathIdx = 0; pathIdx < numPaths; pathIdx++) {
      let equity = startingCapitalUsd;
      let maxEquity = equity;
      let maxDdBps = 0;
      let isBankrupt = false;
      let tradesExecuted = 0;
      let timeToRuin: number | null = null;
      let totalElapsedSec = 0;

      for (let t = 0; t < tradesPerPath; t++) {
        if (equity <= 0.01) {
          isBankrupt = true;
          equity = 0;
          timeToRuin = totalElapsedSec;
          break;
        }

        // Conservative halt checks for PAPER_STANDARD
        if (mode === 'PAPER_STANDARD') {
          // Standard mode halts on 500 bps (5%) rolling drawdown
          if (maxDdBps >= 500) {
            break; // halted
          }
        }

        // Draw random empirical trade
        const trade = outcomes[Math.floor(Math.random() * outcomes.length)];
        totalElapsedSec += trade.holdingTimeSeconds;
        tradesExecuted++;

        // Sizing logic
        let size = equity * Math.min(1.0, Math.max(0.01, sizingFraction));
        if (mode === 'PAPER_STANDARD') {
          size = Math.min(size, equity * 0.05); // Standard caps position at 5%
        } else if (mode === 'PAPER_MAX_RISK' || mode === 'PAPER_CHAOS') {
          // Max risk allows up to 100% allocation
          size = equity * Math.min(1.0, sizingFraction);
        }

        const unallocated = equity - size;
        const returnedCapital = size * trade.returnMultiple;
        equity = unallocated + returnedCapital;
        allExecutedReturns.push(trade.returnMultiple);

        if (equity > maxEquity) {
          maxEquity = equity;
        }

        const currentDdBps = maxEquity > 0 ? Math.round(((maxEquity - equity) / maxEquity) * 10_000) : 10_000;
        if (currentDdBps > maxDdBps) {
          maxDdBps = currentDdBps;
        }
      }

      const logWealthRatio = equity > 0 ? Math.log(equity / startingCapitalUsd) : -10;

      paths.push({
        pathId: pathIdx,
        mode,
        startingEquityUsd: startingCapitalUsd,
        terminalEquityUsd: equity,
        maxEquityUsd: maxEquity,
        maxDrawdownBps: maxDdBps,
        isBankrupt: isBankrupt || equity <= 0.01,
        tradesExecuted,
        timeToRuinSeconds: timeToRuin,
        reached2x: maxEquity >= startingCapitalUsd * 2,
        reached5x: maxEquity >= startingCapitalUsd * 5,
        reached10x: maxEquity >= startingCapitalUsd * 10,
        reached100x: maxEquity >= startingCapitalUsd * 100,
        logWealthRatio,
      });
    }

    // Sort terminal equities for percentiles
    const sortedEquities = paths.map(p => p.terminalEquityUsd).sort((a, b) => a - b);
    const sortedDds = paths.map(p => p.maxDrawdownBps).sort((a, b) => a - b);

    const getP = (arr: number[], pct: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * (pct / 100)))];

    const bankruptCount = paths.filter(p => p.isBankrupt).length;
    const reached2xCount = paths.filter(p => p.reached2x).length;
    const reached5xCount = paths.filter(p => p.reached5x).length;
    const reached10xCount = paths.filter(p => p.reached10x).length;
    const reached100xCount = paths.filter(p => p.reached100x).length;

    const meanTerminalEquity = paths.reduce((sum, p) => sum + p.terminalEquityUsd, 0) / paths.length;
    const expectedLogGrowth = paths.reduce((sum, p) => sum + p.logWealthRatio, 0) / paths.length;

    // Luck adjusted calculation on executed trades
    const sortedReturns = [...allExecutedReturns].sort((a, b) => b - a);
    const totalReturnVal = sortedReturns.reduce((a, b) => a + b, 0);
    const withoutBest = sortedReturns.slice(1).reduce((a, b) => a + b, 0);
    const withoutTop3 = sortedReturns.slice(3).reduce((a, b) => a + b, 0);
    const withoutTop10 = sortedReturns.slice(10).reduce((a, b) => a + b, 0);
    const top1PctCount = Math.max(1, Math.floor(sortedReturns.length * 0.01));
    const extremeWinnerContrib = totalReturnVal > 0
      ? (sortedReturns.slice(0, top1PctCount).reduce((a, b) => a + b, 0) / totalReturnVal) * 100
      : 0;

    return {
      mode,
      startingCapitalUsd,
      totalPaths: numPaths,
      bankruptcyProbability: Number((bankruptCount / numPaths).toFixed(4)),
      p2xProbability: Number((reached2xCount / numPaths).toFixed(4)),
      p5xProbability: Number((reached5xCount / numPaths).toFixed(4)),
      p10xProbability: Number((reached10xCount / numPaths).toFixed(4)),
      p100xProbability: Number((reached100xCount / numPaths).toFixed(4)),
      medianTerminalEquityUsd: Number(getP(sortedEquities, 50).toFixed(2)),
      meanTerminalEquityUsd: Number(meanTerminalEquity.toFixed(2)),
      percentiles: {
        p1: Number(getP(sortedEquities, 1).toFixed(2)),
        p5: Number(getP(sortedEquities, 5).toFixed(2)),
        p10: Number(getP(sortedEquities, 10).toFixed(2)),
        p25: Number(getP(sortedEquities, 25).toFixed(2)),
        p50: Number(getP(sortedEquities, 50).toFixed(2)),
        p75: Number(getP(sortedEquities, 75).toFixed(2)),
        p90: Number(getP(sortedEquities, 90).toFixed(2)),
        p95: Number(getP(sortedEquities, 95).toFixed(2)),
        p99: Number(getP(sortedEquities, 99).toFixed(2)),
      },
      medianDrawdownBps: getP(sortedDds, 50),
      p95DrawdownBps: getP(sortedDds, 95),
      worstDrawdownBps: sortedDds[sortedDds.length - 1],
      expectedLogGrowth: Number(expectedLogGrowth.toFixed(4)),
      luckAdjusted: {
        totalReturnPct: Number(totalReturnVal.toFixed(2)),
        returnWithoutBestTradePct: Number(withoutBest.toFixed(2)),
        returnWithoutTop3Pct: Number(withoutTop3.toFixed(2)),
        returnWithoutTop10Pct: Number(withoutTop10.toFixed(2)),
        extremeWinnerContributionPct: Number(extremeWinnerContrib.toFixed(2)),
      },
    };
  }
}
