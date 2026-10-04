import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TradeLearningService } from '../../dist/intelligence/attribution/trade-learning-service.js';
import { OutcomeMaturityGate } from '../../dist/platform/pipeline/conservation-proofs.js';

const columns = [
  'trade_id', 'token_mint', 'symbol', 'entry_price_usd', 'exit_price_usd',
  'cost_basis_usd', 'proceeds_usd', 'realized_pnl_usd', 'realized_pnl_pct',
  'hold_duration_ms', 'exit_trigger', 'was_decision_sound', 'closed_at_ms',
  'mfe_pct', 'mae_pct', 'profit_capture_ratio', 'exit_efficiency', 'credit_archetype'
];

function createTempCsv(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maturity-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'trades.csv');
  const text = columns.join(',') + '\n' + rows.map(r => columns.map(c => r[c] ?? '').join(',')).join('\n') + '\n';
  fs.writeFileSync(file, text);
  return { file, text };
}

test('OUTCOME MATURITY GATE: recordClosedTrade rejects premature outcome when requireOutcomeMaturity is active', () => {
  const svc = new TradeLearningService(undefined, new OutcomeMaturityGate(), {
    requireOutcomeMaturity: true,
    minMaturityDelayMs: 60_000, // 60 seconds
    minMaturitySlotDelta: 100n, // 100 slots
  });

  const now = Date.now();
  const prematureReport = {
    tokenMint: 'TokenImmature111111111111111111111111111111111',
    symbol: 'IMMATURE',
    entryPriceUsd: 1.0,
    exitPriceUsd: 1.2,
    costBasisUsd: 100.0,
    proceedsUsd: 120.0,
    realizedPnlUsd: 20.0,
    realizedPnlPct: 20.0,
    holdDurationMs: 5_000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: true,
  };

  // Premature: elapsed time only 10s < 60s, slot delta only 25 < 100
  assert.throws(
    () =>
      svc.recordClosedTrade(prematureReport, {
        economicFactId: 'fact_premature_01',
        accountMode: 'paper',
        settledSlot: 1000n,
        currentSlot: 1025n,
        currentAtMs: now - 50_000,
      }),
    /IMMATURE_OUTCOME/
  );

  // Since it was rejected, autopsy count remains 0
  assert.equal(svc.getSnapshot().totalTradesEvaluated, 0);
});

test('OUTCOME MATURITY GATE: recordClosedTrade accepts mature outcome and attaches verified certificate', () => {
  const svc = new TradeLearningService(undefined, new OutcomeMaturityGate(), {
    requireOutcomeMaturity: true,
    minMaturityDelayMs: 60_000, // 60 seconds
    minMaturitySlotDelta: 100n, // 100 slots
  });

  const now = Date.now();
  const matureReport = {
    tokenMint: 'TokenMature1111111111111111111111111111111111',
    symbol: 'MATURE',
    entryPriceUsd: 1.0,
    exitPriceUsd: 1.25,
    costBasisUsd: 100.0,
    proceedsUsd: 125.0,
    realizedPnlUsd: 25.0,
    realizedPnlPct: 25.0,
    holdDurationMs: 15_000,
    exitTrigger: 'TRAILING_TARGET',
    wasDecisionSound: true,
  };

  // Mature: elapsed time 75s >= 60s, slot delta 150 >= 100
  const autopsy = svc.recordClosedTrade(matureReport, {
    economicFactId: 'fact_mature_01',
    accountMode: 'paper',
    settledSlot: 1000n,
    currentSlot: 1150n,
    settledAtMs: now - 75_000,
    currentAtMs: now,
  });

  assert.ok(autopsy);
  assert.ok(autopsy.maturityCertificate);
  assert.equal(autopsy.maturityCertificate.isMature, true);
  assert.equal(autopsy.maturityCertificate.learningReady, true);
  assert.equal(autopsy.maturityCertificate.labelDatasetTag, 'RESEARCH_COUNTERFACTUAL');
  assert.equal(autopsy.maturityCertificate.economicFactId, 'fact_mature_01');
  assert.equal(typeof autopsy.maturityCertificate.certificateHash, 'string');
  assert.equal(autopsy.maturityCertificate.certificateHash.length, 64);

  // Snapshot now reflects mature outcome
  assert.equal(svc.getSnapshot().totalTradesEvaluated, 1);
  assert.equal(svc.getSnapshot().totalRealizedPnlUsd, 25.0);
});

test('OUTCOME MATURITY GATE: loadFromCsv filters immature rows when requireOutcomeMaturity is active', (t) => {
  const now = Date.now();
  const matureRow = {
    trade_id: 'trd_csv_mature_01',
    token_mint: 'TokenCsvMature111111111111111111111111111111111',
    symbol: 'CSV_MATURE',
    entry_price_usd: 1.0,
    exit_price_usd: 1.5,
    cost_basis_usd: 100.0,
    proceeds_usd: 150.0,
    realized_pnl_usd: 50.0,
    realized_pnl_pct: 50.0,
    hold_duration_ms: 10_000,
    exit_trigger: 'TRAILING_TARGET',
    was_decision_sound: 1,
    closed_at_ms: now - 120_000, // 2 minutes ago (mature > 60s)
    mfe_pct: 50.0,
    mae_pct: 0.0,
    profit_capture_ratio: 1.0,
    exit_efficiency: 1.0,
    credit_archetype: 'GOOD_DECISION_GOOD_OUTCOME',
  };

  const immatureRow = {
    trade_id: 'trd_csv_immature_02',
    token_mint: 'TokenCsvImmature222222222222222222222222222222222',
    symbol: 'CSV_IMMATURE',
    entry_price_usd: 1.0,
    exit_price_usd: 1.1,
    cost_basis_usd: 100.0,
    proceeds_usd: 110.0,
    realized_pnl_usd: 10.0,
    realized_pnl_pct: 10.0,
    hold_duration_ms: 5_000,
    exit_trigger: 'TRAILING_TARGET',
    was_decision_sound: 1,
    closed_at_ms: now - 5_000, // 5 seconds ago (immature < 60s)
    mfe_pct: 10.0,
    mae_pct: 0.0,
    profit_capture_ratio: 1.0,
    exit_efficiency: 1.0,
    credit_archetype: 'GOOD_DECISION_GOOD_OUTCOME',
  };

  const { file } = createTempCsv(t, [matureRow, immatureRow]);

  const svc = new TradeLearningService(undefined, new OutcomeMaturityGate(), {
    requireOutcomeMaturity: true,
    minMaturityDelayMs: 60_000,
    minMaturitySlotDelta: 100n,
  });

  const res = svc.loadFromCsv(file);
  // Only 1 mature row accepted, 1 rejected as IMMATURE_OUTCOME
  assert.equal(res.loadedCount, 1);
  const snap = svc.getSnapshot();
  assert.equal(snap.totalTradesEvaluated, 1);
  assert.equal(snap.recentAutopsies[0].tradeId, 'trd_csv_mature_01');
  assert.equal(snap.dataQuality.rejectedRows, 1);
  assert.equal(snap.dataQuality.rejectionReasons['IMMATURE_OUTCOME'], 1);
});
