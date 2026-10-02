/**
 * SOL-SYLPH Pavlov Attributions Harmonizer
 * Re-evaluates decision soundness across all historical rows and formats all rows
 * to canonical 43-column standard with accurate 4-quadrant attributions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PavlovOutcomeAttributionEngine } from '../dist/intelligence/attribution/pavlov-attribution.js';
import { TradeLearningService } from '../dist/intelligence/attribution/trade-learning-service.js';

export const STANDARD_43_HEADERS = [
  'trade_id', 'token_mint', 'symbol', 'entry_price_usd', 'exit_price_usd',
  'cost_basis_usd', 'proceeds_usd', 'realized_pnl_usd', 'realized_pnl_pct',
  'hold_duration_ms', 'exit_trigger', 'was_decision_sound', 'closed_at_ms',
  'mfe_pct', 'mae_pct', 'profit_capture_ratio', 'exit_efficiency',
  'credit_archetype', 'policy_reinforcement_action', 'adaptive_hsi_hurdle',
  'calibration_regime', 'counterfactual_pnl_pct', 'exit_envelope_hash',
  'attribution_notes', 'ensemble_prob', 'binary_prob', 'momentum_prob',
  'fast_prob', 'peak_prediction', 'pump_score', 'twox_score', 'ai_prob',
  'entry_age_sec', 'entry_fdv', 'price_impact_pct', 'slippage_pct',
  'protocol_fee_usd', 'priority_fee_usd', 'total_fees_usd', 'latency_ms',
  'pre_liquidity_usd', 'post_liquidity_usd', 'decision_soundness_reason'
];

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function harmonizeCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[Harmonizer] File not found: ${filePath}`);
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.trim().split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return null;

  const originalHeader = parseCsvLine(lines[0]);
  const colMap = new Map();
  originalHeader.forEach((h, i) => colMap.set(h.toLowerCase().trim(), i));

  const newRows = [STANDARD_43_HEADERS.join(',')];
  let reinforceCount = 0;
  let neutralCount = 0;
  let luckyCount = 0;
  let penalizeCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    const getVal = name => {
      const idx = colMap.get(name);
      return idx != null && idx < row.length ? row[idx] : '';
    };

    const tradeId = getVal('trade_id');
    const tokenMint = getVal('token_mint');
    const symbol = getVal('symbol');
    const entryPriceUsd = getVal('entry_price_usd');
    const exitPriceUsd = getVal('exit_price_usd');
    const costBasisUsd = getVal('cost_basis_usd');
    const proceedsUsd = getVal('proceeds_usd');
    const realizedPnlUsd = getVal('realized_pnl_usd');
    const realizedPnlPctStr = getVal('realized_pnl_pct');
    const realizedPnlPct = parseFloat(realizedPnlPctStr);
    const holdDurationMs = getVal('hold_duration_ms');
    const exitTrigger = getVal('exit_trigger');
    const closedAtMs = getVal('closed_at_ms');
    const mfePct = getVal('mfe_pct');
    const maePctStr = getVal('mae_pct');
    const maePct = maePctStr !== '' && !Number.isNaN(Number(maePctStr)) ? parseFloat(maePctStr) : undefined;
    const profitCaptureRatio = getVal('profit_capture_ratio');
    const exitEfficiency = getVal('exit_efficiency');
    const exitEnvelopeHash = getVal('exit_envelope_hash');

    let wasDecisionSound = true;
    let decisionReason = 'SOUND_DECISION_PROCESS';

    if (symbol.toUpperCase() !== 'TEST' && !/^GodTierSim/i.test(tokenMint)) {
      const evalResult = PavlovOutcomeAttributionEngine.evaluateDecisionSoundness({
        passedSafety: true,
        exitTrigger,
        realizedPnlPct,
        maePct,
      });
      wasDecisionSound = evalResult.wasDecisionSound;
      decisionReason = evalResult.reason;
    }

    const isProfit = realizedPnlPct > 0;
    let creditArchetype;
    let policyAction;
    let notes;

    if (wasDecisionSound && isProfit) {
      creditArchetype = 'GOOD_DECISION_GOOD_OUTCOME';
      policyAction = 'REINFORCE';
      notes = 'Sound decision process produced profitable outcome. Reinforce policy weights.';
      reinforceCount++;
    } else if (wasDecisionSound && !isProfit) {
      creditArchetype = 'GOOD_DECISION_BAD_OUTCOME';
      policyAction = 'NEUTRAL_VARIANCE';
      notes = 'Sound decision met adverse tail variance. Do NOT penalize valid process.';
      neutralCount++;
    } else if (!wasDecisionSound && isProfit) {
      creditArchetype = 'BAD_DECISION_GOOD_OUTCOME';
      policyAction = 'DO_NOT_REINFORCE_LUCK';
      notes = 'Flawed process produced lucky profit. Strictly avoid reinforcing bad habits.';
      luckyCount++;
    } else {
      creditArchetype = 'BAD_DECISION_BAD_OUTCOME';
      policyAction = 'PENALIZE_POLICY';
      notes = 'Flawed process caused loss. Penalize strategy parameters and raise adaptive HSI hurdle to 85.';
      penalizeCount++;
    }

    const adaptiveHsiHurdle = policyAction === 'PENALIZE_POLICY' ? '85' : '82';
    const calibrationRegime = policyAction === 'PENALIZE_POLICY' ? 'DEFENSIVE' : 'BALANCED';

    const vals = [
      tradeId, tokenMint, symbol, entryPriceUsd, exitPriceUsd, costBasisUsd, proceedsUsd,
      realizedPnlUsd, realizedPnlPctStr, holdDurationMs, exitTrigger,
      wasDecisionSound ? '1' : '0',
      closedAtMs, mfePct, maePctStr, profitCaptureRatio, exitEfficiency,
      creditArchetype, policyAction, adaptiveHsiHurdle, calibrationRegime,
      '', exitEnvelopeHash, notes.replaceAll(',', ';'),
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      decisionReason
    ];

    newRows.push(vals.join(','));
  }

  const newCsvContent = newRows.join('\n') + '\n';
  fs.writeFileSync(filePath, newCsvContent, 'utf8');

  console.log(`[Harmonizer] Processed ${filePath}:`);
  console.log(`  Total Rows: ${newRows.length - 1} (each with exactly ${STANDARD_43_HEADERS.length} columns)`);
  console.log(`  1. Reinforce Alpha: ${reinforceCount}`);
  console.log(`  2. Neutral Variance: ${neutralCount}`);
  console.log(`  3. Filter Lucky Gamble: ${luckyCount}`);
  console.log(`  4. Penalize Policy: ${penalizeCount}`);

  return { reinforceCount, neutralCount, luckyCount, penalizeCount, total: newRows.length - 1 };
}

// Execute harmonization on candidate paths
const targetPaths = [
  'data/pavlov_attributions.csv',
  'D:/pump/SOL-SYLPH/pavlov_attributions.csv'
];

for (const p of targetPaths) {
  if (fs.existsSync(p)) {
    harmonizeCsv(p);
  }
}
