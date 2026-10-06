import fs from 'node:fs';
import readline from 'node:readline';
import { assertCsvDatasetPresent, createColumnIndex, iterateCsvRecords, parseBacktestTokenRow, parseCsvRecord, runBacktestCli } from './empirical-alpha-backtest-data.mjs';

const filePath = process.env.SYLPH_BACKTEST_CSV_PATH || 'C:/Users/juans/Documents/Codex/2026-10-04/make-me-a-really-detail-csv/outputs/solana_tokens_peak_and_drop.csv';
const reportPath = process.env.SYLPH_BACKTEST_REPORT_PATH || 'scratch/empirical-backtest-results.json';

// Fixed trade parameters
const POSITION_SOL = 0.5; // ~ $75 USD at $150/SOL
const SOL_PRICE_USD = 150;
const POSITION_USD = POSITION_SOL * SOL_PRICE_USD;

// Friction modeling (700 bps round-trip equivalent)
const PROTOCOL_FEE_BPS = 100; // 1% buy, 1% sell
const AMM_PRICE_IMPACT_BPS = 160; // price impact on 30 SOL initial bonding curve
const JITO_TIP_SOL = 0.005; // ~$0.75 USD per tx
const SLIPPAGE_BPS = 50;

const ROUND_TRIP_FRICTION_PCT = ((PROTOCOL_FEE_BPS * 2 + AMM_PRICE_IMPACT_BPS * 2 + SLIPPAGE_BPS * 2) / 10000) + ((JITO_TIP_SOL * 2) / POSITION_SOL);
// 100*2 + 160*2 + 50*2 = 620 bps + (0.01 / 0.5 = 2.0%) = 8.2% total round-trip friction!

// Candidate filters use available source columns; their point-in-time availability is not established.
const ENTRY_RULES = [
  {
    id: 'BASELINE_ALL_TOKENS',
    description: 'No filter: Buy every token at first observed price (unconditional baseline)',
    predicate: () => true
  },
  {
    id: 'FILTER_ORGANIC_CLEAN',
    description: 'Reject suspect concentration, mayhem mode, and frontrun detection',
    predicate: (ctx) => ctx.holderConcentrationSuspect === false && ctx.isMayhemMode === false && ctx.firstPricePrecedesDetection === false
  },
  {
    id: 'FILTER_FAST_ORGANIC_DISCOVERY',
    description: 'Clean token + fast discovery (< 3.0s detection lag)',
    predicate: (ctx) => ctx.holderConcentrationSuspect === false && ctx.isMayhemMode === false && ctx.firstPricePrecedesDetection === false && ctx.detectionLagSec <= 3.0 && ctx.detectionLagSec >= 0
  },
  {
    id: 'FILTER_PRICE_NOT_PUMPED',
    description: 'Clean token + first observed price <= 1.05x initial curve price (not frontrun)',
    predicate: (ctx) => ctx.holderConcentrationSuspect === false && ctx.isMayhemMode === false && ctx.firstPricePrecedesDetection === false && ctx.initialPriceRatio <= 1.05 && ctx.initialPriceRatio >= 0.8
  },
];

// Define candidate exit strategies
const EXIT_STRATEGIES = [
  {
    id: 'STATIC_2X_STOP_25',
    name: 'Static 2.0x Target / -25% Stop',
    targetX: 2.0,
    stopLossPct: 0.25,
    stagedDerisk: false,
    maxHoldMinutes: 3.0
  },
  {
    id: 'STAGED_DERISK_2X_TRAIL',
    name: 'Staged Derisk: Sell 50% at 2.0x, Trail Remainder -30%',
    targetX: 2.0,
    stopLossPct: 0.25,
    stagedDerisk: true,
    maxHoldMinutes: 5.0
  },
  {
    id: 'QUICK_SCALP_1_5X_STOP_20',
    name: 'Quick Scalp: 1.5x Target / -20% Stop / 2m Time-Stop',
    targetX: 1.5,
    stopLossPct: 0.20,
    stagedDerisk: false,
    maxHoldMinutes: 2.0
  },
  {
    id: 'MOONSHOT_RUNNER_3X',
    name: 'Moonshot: Staged 50% at 2.0x, Hold Remainder for 5.0x / 10m',
    targetX: 2.0,
    stopLossPct: 0.35,
    stagedDerisk: true,
    runnerTargetX: 5.0,
    maxHoldMinutes: 10.0
  }
];

function simulateTrade(token, exitStrategy) {
  // The source is right-censored and may lack any post-peak/last-price evidence.
  // Do not convert absent observations into a profitable or losing point estimate.
  if (!token.exitOutcomeEvidenceComplete) {
    return { won: false, outcome: 'UNRESOLVED_CENSORED', pnlPct: null, pnlUsd: null, proceedsUsd: null };
  }
  // Check if token went straight down from start (never exceeded starting price)
  if (token.peakMultipleX <= 1.0) {
    // Loss: hit stop loss or unexitability
    const isUnexitable = token.lastObservedDropFromPeakPct >= 90 || token.largestDropFromPeakPct >= 95;
    const lossPct = isUnexitable ? 1.0 : exitStrategy.stopLossPct; // Sizing for total loss if illiquid
    const netLossPct = lossPct + (ROUND_TRIP_FRICTION_PCT * 0.7); // partial friction on failure
    return {
      won: false,
      outcome: isUnexitable ? 'UNEXITABLE_TOTAL_LOSS' : 'STOP_LOSS',
      pnlPct: -netLossPct,
      pnlUsd: -netLossPct * POSITION_USD,
      proceedsUsd: Math.max(0, (1 - netLossPct) * POSITION_USD)
    };
  }

  // Did token reach target multiple?
  const reachedTarget = token.peakMultipleX >= exitStrategy.targetX;
  const peakTimeMinutes = token.minutesToPeak;

  // Check if peak occurred within maximum hold time
  const peakedInTime = peakTimeMinutes <= exitStrategy.maxHoldMinutes;

  if (reachedTarget && peakedInTime) {
    if (exitStrategy.stagedDerisk) {
      // 50% sold at targetX
      const halfGain = 0.5 * (exitStrategy.targetX - 1.0);

      // What happened to remaining 50%?
      let remainderGain = 0;
      if (exitStrategy.runnerTargetX && token.peakMultipleX >= exitStrategy.runnerTargetX) {
        // Runner hit moonshot target
        remainderGain = 0.5 * (exitStrategy.runnerTargetX - 1.0);
      } else if (token.lastObservedPriceSol < token.firstObservedPriceSol) {
        // Runner round-tripped into loss
        remainderGain = 0.5 * (-exitStrategy.stopLossPct);
      } else {
        // Trailed out at 70% of peak
        remainderGain = 0.5 * ((token.peakMultipleX * 0.7) - 1.0);
      }

      const grossPnlPct = halfGain + remainderGain;
      const netPnlPct = grossPnlPct - ROUND_TRIP_FRICTION_PCT;
      return {
        won: netPnlPct > 0,
        outcome: 'STAGED_DERISK_PROFIT',
        pnlPct: netPnlPct,
        pnlUsd: netPnlPct * POSITION_USD,
        proceedsUsd: (1 + netPnlPct) * POSITION_USD
      };
    } else {
      // Full take-profit at targetX
      const grossPnlPct = exitStrategy.targetX - 1.0;
      const netPnlPct = grossPnlPct - ROUND_TRIP_FRICTION_PCT;
      return {
        won: true,
        outcome: 'TARGET_PROFIT',
        pnlPct: netPnlPct,
        pnlUsd: netPnlPct * POSITION_USD,
        proceedsUsd: (1 + netPnlPct) * POSITION_USD
      };
    }
  }

  // Target not reached or timed out: did it reach partial profit before dying?
  if (token.peakMultipleX >= 1.2 && peakedInTime) {
    // Timed out with modest peak: likely sold at trailing drop or time stop
    const isRoundTrip = token.lastObservedPriceSol < token.firstObservedPriceSol;
    const lossPct = isRoundTrip ? exitStrategy.stopLossPct : 0.05;
    const netPnlPct = -lossPct - ROUND_TRIP_FRICTION_PCT;
    return {
      won: false,
      outcome: 'TIME_STOP_SCRATCH',
      pnlPct: netPnlPct,
      pnlUsd: netPnlPct * POSITION_USD,
      proceedsUsd: Math.max(0, (1 + netPnlPct) * POSITION_USD)
    };
  }

  // Hit stop loss
  const isUnexitable = token.largestDropFromPeakPct >= 95 || token.lastObservedDropFromPeakPct >= 90;
  const lossPct = isUnexitable ? 1.0 : exitStrategy.stopLossPct;
  const netLossPct = lossPct + (ROUND_TRIP_FRICTION_PCT * 0.7);
  return {
    won: false,
    outcome: isUnexitable ? 'UNEXITABLE_TOTAL_LOSS' : 'STOP_LOSS',
    pnlPct: -netLossPct,
    pnlUsd: -netLossPct * POSITION_USD,
    proceedsUsd: Math.max(0, (1 - netLossPct) * POSITION_USD)
  };
}

async function runBacktest() {
  console.log('================================================================');
  console.log(' SYLPH FUSION — CENSORED OBSERVED-WINDOW SCENARIO ANALYSIS');
  console.log(' NOT a capturable-return backtest: no full path, executable route, landed fills, or settlement evidence.');
  console.log('================================================================');
  console.log(`Position size: ${POSITION_SOL} SOL ($${POSITION_USD.toFixed(2)} USD)`);
  console.log(`Modelled Round-Trip Friction: ${(ROUND_TRIP_FRICTION_PCT * 100).toFixed(2)}% (DEX fee + Impact + Jito Tips + Slippage)`);
  console.log(`Chronological Split: In-Sample (June 5-25) vs Out-of-Sample (June 26 - July 14)`);
  console.log('----------------------------------------------------------------\n');

  const csvRecords = iterateCsvRecords(readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity
  }));

  // Track results: results[rule.id][exit.id] = { inSample: stats, outOfSample: stats }
  const matrix = {};
  for (const rule of ENTRY_RULES) {
    matrix[rule.id] = {};
    for (const exit of EXIT_STRATEGIES) {
      matrix[rule.id][exit.id] = {
        inSample: { trades: 0, wins: 0, unresolved: 0, totalPnlUsd: 0, unexitableLosses: 0, grossWinsUsd: 0, grossLossesUsd: 0 },
        outOfSample: { trades: 0, wins: 0, unresolved: 0, totalPnlUsd: 0, unexitableLosses: 0, grossWinsUsd: 0, grossLossesUsd: 0 }
      };
    }
  }

  let totalParsed = 0;
  let usableTokens = 0;
  let malformedRows = 0;
  let columnIndex = null;
  const SPLIT_DATE = '2026-06-25T23:59:59Z';

  for await (const line of csvRecords) {
    if (totalParsed === 0) {
      columnIndex = createColumnIndex(parseCsvRecord(line));
      totalParsed += 1;
      continue;
    }
    totalParsed++;

    const row = parseCsvRecord(line);
    if (row.length !== columnIndex.size) {
      // Preserve data quality: never shift or pad columns to make malformed rows appear valid.
      malformedRows++;
      continue;
    }
    const tokenContext = parseBacktestTokenRow(row, columnIndex);
    if (tokenContext === null) continue;
    usableTokens++;
    const isOutSample = tokenContext.detectedAtMs > Date.parse(SPLIT_DATE);

    // Evaluate each rule
    for (const rule of ENTRY_RULES) {
      if (rule.predicate(tokenContext)) {
        for (const exit of EXIT_STRATEGIES) {
          const outcome = simulateTrade(tokenContext, exit);
          const bucket = isOutSample ? matrix[rule.id][exit.id].outOfSample : matrix[rule.id][exit.id].inSample;
          bucket.trades++;
          if (outcome.outcome === 'UNRESOLVED_CENSORED') {
            bucket.unresolved++;
            continue;
          }
          if (outcome.won) {
            bucket.wins++;
            bucket.grossWinsUsd += outcome.pnlUsd;
          } else {
            bucket.grossLossesUsd += Math.abs(outcome.pnlUsd);
          }
          bucket.totalPnlUsd += outcome.pnlUsd;
          if (outcome.outcome === 'UNEXITABLE_TOTAL_LOSS') {
            bucket.unexitableLosses++;
          }
        }
      }
    }

    if (usableTokens % 100000 === 0) {
      console.log(`Processed ${usableTokens} usable tokens...`);
    }
  }
  assertCsvDatasetPresent(columnIndex, totalParsed);
  console.log('\n================================================================');
  console.log(' BACKTEST EXECUTION COMPLETE — ANALYSIS & COMPARISON');
  console.log(` Total Usable Tokens Evaluated: ${usableTokens}`);
  console.log(` Malformed CSV records excluded: ${malformedRows}`);
  console.log('================================================================\n');

  for (const rule of ENTRY_RULES) {
    console.log(`\n================================================================`);
    console.log(`RULE: [${rule.id}]`);
    console.log(`Description: ${rule.description}`);
    console.log(`----------------------------------------------------------------`);

    for (const exit of EXIT_STRATEGIES) {
      const is = matrix[rule.id][exit.id].inSample;
      const oos = matrix[rule.id][exit.id].outOfSample;

      const isResolved = is.trades - is.unresolved;
      const oosResolved = oos.trades - oos.unresolved;
      const isWinRate = isResolved > 0 ? ((is.wins / isResolved) * 100).toFixed(2) : '0.00';
      const oosWinRate = oosResolved > 0 ? ((oos.wins / oosResolved) * 100).toFixed(2) : '0.00';

      const isEvPerTrade = isResolved > 0 ? (is.totalPnlUsd / isResolved).toFixed(2) : '0.00';
      const oosEvPerTrade = oosResolved > 0 ? (oos.totalPnlUsd / oosResolved).toFixed(2) : '0.00';

      const isProfitFactor = is.grossLossesUsd > 0 ? (is.grossWinsUsd / is.grossLossesUsd).toFixed(3) : '0.000';
      const oosProfitFactor = oos.grossLossesUsd > 0 ? (oos.grossWinsUsd / oos.grossLossesUsd).toFixed(3) : '0.000';

      console.log(`  Exit Strategy: ${exit.name} [${exit.id}]`);
      console.log(`    [COVERAGE]      Candidates: ${is.trades.toLocaleString()} IS / ${oos.trades.toLocaleString()} OOS | Censored/unresolved: ${is.unresolved.toLocaleString()} IS / ${oos.unresolved.toLocaleString()} OOS`);
      console.log(`    [IN-SAMPLE SCENARIO]     Resolved: ${isResolved.toLocaleString().padStart(7)} | WinRate: ${isWinRate.padStart(6)}% | Scenario EV: $${isEvPerTrade.padStart(6)} | PF: ${isProfitFactor} | Scenario P&L: $${is.totalPnlUsd.toLocaleString(undefined, {maximumFractionDigits:0})}`);
      console.log(`    [OUT-OF-SAMPLE SCENARIO] Resolved: ${oosResolved.toLocaleString().padStart(7)} | WinRate: ${oosWinRate.padStart(6)}% | Scenario EV: $${oosEvPerTrade.padStart(6)} | PF: ${oosProfitFactor} | Scenario P&L: $${oos.totalPnlUsd.toLocaleString(undefined, {maximumFractionDigits:0})}`);
      console.log(`    Unexitable / Total Ruin Trades: IS=${is.unexitableLosses.toLocaleString()} (${((is.unexitableLosses/Math.max(1,is.trades))*100).toFixed(1)}%) | OOS=${oos.unexitableLosses.toLocaleString()} (${((oos.unexitableLosses/Math.max(1,oos.trades))*100).toFixed(1)}%)`);
      console.log('    - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -');
    }
  }

  // Save full JSON report
  fs.writeFileSync(reportPath, JSON.stringify({
    evidenceClass: 'CENSORED_OBSERVED_WINDOW_SCENARIO_NOT_CAPTURABLE_BACKTEST',
    caveats: [
      'Observed-window peak and drawdown summaries are not a full point-in-time price path.',
      'Cohort inclusion uses full-window observation counts and an extreme-peak review flag; cohort sizes are not a point-in-time eligible universe.',
      'Source safety flags are not timestamped, so filtered cohorts are not proven to be actionable at entry.',
      'Peak and drawdown summaries do not establish whether targets, stops, or trailing exits occurred first.',
      'Hypothetical exits, size-aware liquidity, route availability, landed fills, and settlement are not observed.',
      'Rows lacking complete last-price and drawdown fields remain unresolved and are excluded from PnL denominators.',
      'Scenario PnL sums use fixed position-size and friction assumptions; they are not realized PnL or positive-expectancy evidence.',
      'Malformed-width CSV records are excluded without padding or repairing field boundaries.',
    ],
    matrix, totalTokens: usableTokens, malformedRows, frictionPct: ROUND_TRIP_FRICTION_PCT,
  }, null, 2));
  console.log(`\nDetailed backtest results saved to: ${reportPath}`);
}

await runBacktestCli(runBacktest, { reportPath });
