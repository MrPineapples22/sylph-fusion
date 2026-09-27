#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateTrial } from './sweep-evaluator.mjs';

export const DEFAULT_GRID = Object.freeze([0.8, 1.2, 1.6].flatMap(velocity =>
  [5, 7].flatMap(trailing => [[15, 35, 75], [20, 40, 80]].map(tp =>
    ({ velocity, trailing, slippageBps: 300, tp })))));

// Only the earlier partition selects parameters. Holdout never ranks candidates.
export function researchProfitability(fixture, { grid = DEFAULT_GRID, trainFraction = 0.7,
  minClosedTrades = 30, options = {} } = {}) {
  const ticks = Array.isArray(fixture) ? fixture : fixture?.ticks;
  if (!Array.isArray(ticks) || ticks.length < 10) throw new Error('At least 10 chronological frames required');
  if (!(trainFraction >= 0.5 && trainFraction <= 0.9)) throw new Error('trainFraction must be between 0.5 and 0.9');
  if (!Number.isInteger(minClosedTrades) || minClosedTrades < 1) throw new Error('Invalid minimum closed-trade count');
  if (!Array.isArray(grid) || !grid.length || grid.length > 10000) throw new Error('Invalid parameter grid');
  for (let i = 0; i < ticks.length; i++) {
    if (!Number.isFinite(ticks[i]?.timestamp) || (i && ticks[i].timestamp <= ticks[i - 1].timestamp)) {
      throw new Error('Frames must have strictly increasing finite timestamps; input is never silently sorted');
    }
  }
  const split = Math.floor(ticks.length * trainFraction);
  const training = ticks.slice(0, split), holdout = ticks.slice(split);
  const rankings = grid.map((params, index) => ({ index, params,
    training: evaluateTrial(training, params, options) }))
    .sort((a, b) => b.training.netReturnPct - a.training.netReturnPct ||
      a.training.maxDrawdownPct - b.training.maxDrawdownPct || a.index - b.index);
  const selected = rankings[0];
  const validation = evaluateTrial(holdout, selected.params, options);
  const stress = evaluateTrial(holdout, { ...selected.params,
    slippageBps: Math.min(5000, selected.params.slippageBps * 2) }, options);
  const closedTrades = validation.closedTrades ?? validation.trades;
  const reasons = [];
  if (closedTrades < minClosedTrades) reasons.push('INSUFFICIENT_HOLDOUT_TRADES');
  if (!(validation.netReturnPct > 0)) reasons.push('NONPOSITIVE_HOLDOUT_RETURN');
  if (!(stress.netReturnPct > 0)) reasons.push('NONPOSITIVE_STRESSED_RETURN');
  if (fixture?.provenance?.kind !== 'recorded-market') reasons.push('SYNTHETIC_OR_UNVERIFIED_INPUT');
  // A file label is not an attestation, and one holdout is not a live release gate.
  return {
    version: 1, purpose: 'RESEARCH_ONLY', liveTradingAuthorized: false,
    status: reasons.length ? 'NOT_DEMONSTRATED' : 'POSITIVE_HOLDOUT_REQUIRES_FORWARD_PAPER_VALIDATION',
    reasons, selectedParams: selected.params, candidateCount: grid.length,
    partition: { trainFrames: training.length, holdoutFrames: holdout.length,
      trainEnd: training.at(-1).timestamp, holdoutStart: holdout[0].timestamp,
      stateResetAtBoundary: true },
    training: selected.training, holdout: validation, stressedHoldout: stress,
    minimumHoldoutClosedTrades: minClosedTrades,
    claimedProvenance: fixture?.provenance ?? null,
    limitations: [
      'This simplified momentum strategy is not a replay of the full SYLPH decision engine.',
      'No signing, exchange orders, automatic configuration changes, or model promotion.',
      'Costs and fills are modeled, not proof that a real transaction would execute.',
      'Input coverage, survivorship, available-at feature timing and provider provenance require independent verification.',
      'Repeated use of this holdout makes it development data; collect a fresh forward paper sample.',
      'No statistical confidence or guarantee of future profit is asserted.'
    ]
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('Usage: node scripts/research-profitability.mjs <ticks.json> <report.json>');
    const raw = readFileSync(resolve(input), 'utf8');
    const report = researchProfitability(JSON.parse(raw));
    report.inputSha256 = createHash('sha256').update(raw).digest('hex');
    writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, reasons: report.reasons,
      holdoutReturnPct: report.holdout.netReturnPct, report: resolve(output) }, null, 2));
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
