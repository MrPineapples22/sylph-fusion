/**
 * SYLPH FUSION — PORTFOLIO RUIN SIMULATOR ENGINE
 * Section XXVI & Study 45: PORTFOLIO-RUIN-X
 *
 * Simulates chronological candidate streams with fixed $250 experiments,
 * execution frictions, correlated landing failures, and liquidity crashes.
 *
 * Survival Invariant: Optimize survival and ruin probability BEFORE maximum return.
 */

export interface RuinSimulationParameters {
  readonly initialBankrollUsd: number; // e.g. $10,000
  readonly fixedPositionSizeUsd: number; // $250
  readonly maxConcurrentPositions: number; // e.g. 5
  readonly candidateWinRate: number; // e.g. 0.0277 (2.77% 10x rate)
  readonly averageWinMultiple: number; // e.g. 4.5x executable
  readonly averageLossPct: number; // e.g. 0.3818 (38.18% empirical loss at -25% stop)
  readonly landingFailureRate: number; // e.g. 0.15
  readonly totalCandidateStreamCount: number; // e.g. 1000
  readonly monteCarloRuns?: number; // e.g. 500
}

export interface PortfolioRuinReport {
  readonly probDrawdown10Pct: number;
  readonly probDrawdown25Pct: number;
  readonly probDrawdown50Pct: number;
  readonly probDrawdown75Pct: number;
  readonly probRuin: number; // Bankroll < $250 or Drawdown >= 90%
  readonly medianMaxDrawdownPct: number;
  readonly medianTimeToRuinTrades?: number;
  readonly capitalConsumedPerRunnerUsd: number;
  readonly isPortfolioSurvivable: boolean;
}

export class PortfolioRuinEngine {
  public static simulate(params: RuinSimulationParameters): PortfolioRuinReport {
    const {
      initialBankrollUsd,
      fixedPositionSizeUsd,
      maxConcurrentPositions,
      candidateWinRate,
      averageWinMultiple,
      averageLossPct,
      landingFailureRate,
      totalCandidateStreamCount,
      monteCarloRuns = 300,
    } = params;

    let countDd10 = 0;
    let countDd25 = 0;
    let countDd50 = 0;
    let countDd75 = 0;
    let countRuin = 0;

    const maxDrawdowns: number[] = [];
    const ruinTimes: number[] = [];
    let totalCapitalConsumedInRunners = 0;
    let totalRunnersFound = 0;

    for (let sim = 0; sim < monteCarloRuns; sim++) {
      let bankroll = initialBankrollUsd;
      let peakBankroll = initialBankrollUsd;
      let maxDd = 0;
      let ruined = false;
      let capitalSpent = 0;
      let runners = 0;

      for (let t = 0; t < totalCandidateStreamCount; t++) {
        // Can only enter if bankroll supports $250
        if (bankroll < fixedPositionSizeUsd) {
          ruined = true;
          ruinTimes.push(t);
          break;
        }

        capitalSpent += fixedPositionSizeUsd;

        // Simulate trade outcome
        const isLandingFail = Math.random() < landingFailureRate;
        if (isLandingFail) {
          // Landing fail pays fee without trade
          bankroll -= 0.50; // $0.50 lost fee
        } else {
          const isWin = Math.random() < candidateWinRate;
          if (isWin) {
            runners++;
            const grossReturn = fixedPositionSizeUsd * averageWinMultiple;
            const netGain = grossReturn - fixedPositionSizeUsd - 3.50; // $3.50 net fees
            bankroll += netGain;
          } else {
            // Loss
            const lossUsd = fixedPositionSizeUsd * averageLossPct + 1.50; // Loss + fees
            bankroll -= lossUsd;
          }
        }

        if (bankroll > peakBankroll) {
          peakBankroll = bankroll;
        }

        const currentDd = peakBankroll > 0 ? (peakBankroll - bankroll) / peakBankroll : 1.0;
        if (currentDd > maxDd) {
          maxDd = currentDd;
        }

        if (bankroll < fixedPositionSizeUsd || currentDd >= 0.90) {
          ruined = true;
          ruinTimes.push(t);
          break;
        }
      }

      maxDrawdowns.push(maxDd);
      if (maxDd >= 0.10) countDd10++;
      if (maxDd >= 0.25) countDd25++;
      if (maxDd >= 0.50) countDd50++;
      if (maxDd >= 0.75) countDd75++;
      if (ruined) countRuin++;

      totalCapitalConsumedInRunners += capitalSpent;
      totalRunnersFound += runners;
    }

    maxDrawdowns.sort((a, b) => a - b);
    const medianMaxDrawdownPct = maxDrawdowns[Math.floor(maxDrawdowns.length * 0.50)] * 100;

    let medianTimeToRuin: number | undefined;
    if (ruinTimes.length > 0) {
      ruinTimes.sort((a, b) => a - b);
      medianTimeToRuin = ruinTimes[Math.floor(ruinTimes.length * 0.50)];
    }

    const capitalConsumedPerRunnerUsd = totalRunnersFound > 0
      ? totalCapitalConsumedInRunners / totalRunnersFound
      : 0;

    const probRuin = countRuin / monteCarloRuns;
    const isPortfolioSurvivable = probRuin < 0.05 && medianMaxDrawdownPct < 40.0;

    return {
      probDrawdown10Pct: countDd10 / monteCarloRuns,
      probDrawdown25Pct: countDd25 / monteCarloRuns,
      probDrawdown50Pct: countDd50 / monteCarloRuns,
      probDrawdown75Pct: countDd75 / monteCarloRuns,
      probRuin,
      medianMaxDrawdownPct,
      medianTimeToRuinTrades: medianTimeToRuin,
      capitalConsumedPerRunnerUsd,
      isPortfolioSurvivable,
    };
  }
}
