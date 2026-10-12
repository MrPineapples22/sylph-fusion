import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isoMonth = (value) => new Date(value).toISOString().slice(0, 7);

function validateInput(input) {
  if (input?.schemaVersion !== 1 || !Array.isArray(input.launches) || !Array.isArray(input.events) ||
      !input.coverage || typeof input.coverage.completeForRange !== 'boolean' ||
      typeof input.range?.start !== 'string' || typeof input.range?.endExclusive !== 'string') {
    throw new Error('INVALID_NORMALIZED_DATASET');
  }
  const start = Date.parse(input.range.start);
  const end = Date.parse(input.range.endExclusive);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('INVALID_ANALYSIS_RANGE');

  const launches = new Map();
  for (const launch of input.launches) {
    const createdAt = Date.parse(launch?.createdAt);
    if (typeof launch?.mint !== 'string' || !launch.mint || !Number.isFinite(createdAt) ||
        typeof launch.source !== 'string' || !launch.source) throw new Error('INVALID_LAUNCH_RECORD');
    if (launches.has(launch.mint)) throw new Error('DUPLICATE_LAUNCH_MINT');
    launches.set(launch.mint, { ...launch, createdMs: createdAt });
  }

  const eventIds = new Set();
  const eventsByMint = new Map();
  for (const event of input.events) {
    const observedAt = Date.parse(event?.observedAt);
    if (typeof event?.eventId !== 'string' || !event.eventId || eventIds.has(event.eventId) ||
        !launches.has(event?.mint) || !Number.isFinite(observedAt) ||
        typeof event.source !== 'string' || !event.source ||
        !['TRADE', 'GRADUATION', 'SETTLED_EXECUTION'].includes(event?.kind)) throw new Error('INVALID_LIFECYCLE_EVENT');
    if (event.kind === 'TRADE' && event.marketCapUsd != null && (!finite(event.marketCapUsd) || event.marketCapUsd < 0)) {
      throw new Error('INVALID_MARKET_CAP');
    }
    if (event.kind === 'SETTLED_EXECUTION' && !finite(event.realizedNetPnlUsd)) throw new Error('INVALID_SETTLED_PNL');
    eventIds.add(event.eventId);
    const tokenEvents = eventsByMint.get(event.mint) ?? [];
    tokenEvents.push({ ...event, observedMs: observedAt });
    eventsByMint.set(event.mint, tokenEvents);
  }
  return { launches, eventsByMint, start, end };
}

/**
 * Cohort analysis over already-decoded, normalized evidence. This does not decode
 * chain transactions, infer missing events, or produce a trading signal.
 */
export function analyzePumpfunCohorts(input) {
  const { launches, eventsByMint, start, end } = validateInput(input);
  const selectedLaunches = [...launches.values()].filter((launch) => launch.createdMs >= start && launch.createdMs < end);
  const byMonth = new Map();

  for (const launch of selectedLaunches) {
    const month = isoMonth(launch.createdMs);
    const cohort = byMonth.get(month) ?? { month, launched: 0, mature24h: 0, tradedObserved: 0, graduatedWithin24h: 0, observedPeakMarketCapUsd: null, settledExecutionCount: 0, settledRealizedNetPnlUsd: 0 };
    cohort.launched += 1;
    const mature = launch.createdMs + DAY_MS <= end;
    if (mature) cohort.mature24h += 1;

    const tokenEvents = eventsByMint.get(launch.mint) ?? [];
    const trades = tokenEvents.filter((event) => event.kind === 'TRADE' && event.observedMs >= launch.createdMs && event.observedMs < end);
    if (trades.length) cohort.tradedObserved += 1;
    if (mature && tokenEvents.some((event) => event.kind === 'GRADUATION' && event.observedMs >= launch.createdMs && event.observedMs < launch.createdMs + DAY_MS)) {
      cohort.graduatedWithin24h += 1;
    }
    for (const trade of trades) {
      if (finite(trade.marketCapUsd)) cohort.observedPeakMarketCapUsd = Math.max(cohort.observedPeakMarketCapUsd ?? 0, trade.marketCapUsd);
    }
    for (const execution of tokenEvents.filter((event) => event.kind === 'SETTLED_EXECUTION' && event.observedMs >= launch.createdMs && event.observedMs < end)) {
      cohort.settledExecutionCount += 1;
      cohort.settledRealizedNetPnlUsd += execution.realizedNetPnlUsd;
    }
    byMonth.set(month, cohort);
  }

  const cohorts = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((cohort) => ({
    ...cohort,
    graduationWithin24hRateOfMatureLaunches: cohort.mature24h ? cohort.graduatedWithin24h / cohort.mature24h : null,
    observedTradeRateOfAllLaunches: cohort.launched ? cohort.tradedObserved / cohort.launched : null,
    completeness: input.coverage.completeForRange ? 'SOURCE_ASSERTED_COMPLETE' : 'PARTIAL_UNVERIFIED',
  }));

  return {
    schemaVersion: 1,
    analysis: 'PUMPFUN_LAUNCH_COHORTS_RESEARCH_ONLY',
    range: input.range,
    coverage: { ...input.coverage, status: input.coverage.completeForRange ? 'SOURCE_ASSERTED_COMPLETE' : 'PARTIAL_UNVERIFIED' },
    definitions: {
      launched: 'Unique normalized launch mints created inside the requested range.',
      mature24h: 'Launches with the full 24 hours after creation inside the requested range.',
      tradedObserved: 'Launches with at least one normalized trade observed after creation; zero observed is not proof of no trade when coverage is incomplete.',
      graduationWithin24hRateOfMatureLaunches: 'Graduations observed within 24 hours divided by launches whose 24-hour window fits inside the requested range.',
      observedPeakMarketCapUsd: 'Maximum supplied trade market-cap observation; not executable value or a realizable exit.',
      settledRealizedNetPnlUsd: 'Sum of explicitly supplied settled execution net P&L events; never inferred from peak market cap.',
    },
    cohorts,
    authority: 'RESEARCH_ONLY_NO_TRADING_AUTHORITY',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/analyze-pumpfun-cohorts.mjs NORMALIZED.json OUTPUT.json');
    process.exit(2);
  }
  try {
    const result = analyzePumpfunCohorts(JSON.parse(readFileSync(inputPath, 'utf8')));
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    console.log(`Wrote ${result.cohorts.length} cohorts (${result.coverage.status}); authority remains blocked.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'ANALYSIS_FAILED');
    process.exit(1);
  }
}
