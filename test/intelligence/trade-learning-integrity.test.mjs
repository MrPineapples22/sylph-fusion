import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TradeLearningService } from '../../dist/intelligence/attribution/trade-learning-service.js';

const columns = ['trade_id','token_mint','symbol','entry_price_usd','exit_price_usd','cost_basis_usd','proceeds_usd','realized_pnl_usd','realized_pnl_pct','hold_duration_ms','exit_trigger','was_decision_sound','closed_at_ms','mfe_pct','mae_pct','profit_capture_ratio','exit_efficiency','credit_archetype'];
const base = {trade_id:'a',token_mint:'Mint111',symbol:'REAL',entry_price_usd:1,exit_price_usd:1.1,cost_basis_usd:100,proceeds_usd:110,realized_pnl_usd:10,realized_pnl_pct:10,hold_duration_ms:1000,exit_trigger:'OPERATOR_CLOSE',was_decision_sound:1,closed_at_ms:1700000000000,mfe_pct:10,mae_pct:0,profit_capture_ratio:1,exit_efficiency:1};
test('persisted trades roundtrip through an extended CSV header', t => {
  const {file} = fixture(t, []);
  fs.writeFileSync(file, [...columns, 'extra_optional_column'].join(',') + '\n');
  const svc = new TradeLearningService(); svc.loadFromCsv(file);
  svc.recordClosedTrade({tokenMint:'Mint111',symbol:'REAL,QUOTED',entryPriceUsd:1,exitPriceUsd:1.1,costBasisUsd:100,proceedsUsd:110,realizedPnlUsd:10,realizedPnlPct:10,holdDurationMs:1000,exitTrigger:'OPERATOR_CLOSE',wasDecisionSound:true});
  const reloaded = new TradeLearningService();
  assert.equal(reloaded.loadFromCsv(file).loadedCount, 1);
  assert.equal(reloaded.getSnapshot().recentAutopsies[0].symbol, 'REAL,QUOTED');
});
function fixture(t, rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'learning-integrity-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir,'trades.csv');
  const text = columns.join(',')+'\n'+rows.map(r=>columns.map(c=>r[c]??'').join(',')).join('\n')+'\n';
  fs.writeFileSync(file,text);
  return {file,text};
}

test('CSV excludes synthetic, invalid and duplicate records without changing the source', t => {
  const rows = [base,{...base,trade_id:'synthetic',symbol:'TEST'}, {...base,trade_id:'sim',token_mint:'GodTierSim999111'},base,
    {...base,trade_id:'blank',cost_basis_usd:''}, {...base,trade_id:'infinity',proceeds_usd:'Infinity'},
    {...base,trade_id:'trailing',realized_pnl_usd:'10garbage'}, {...base,trade_id:'inconsistent',realized_pnl_usd:200},
    {...base,trade_id:'negative',cost_basis_usd:-100}, {...base,trade_id:'flag',was_decision_sound:''}];
  const {file,text}=fixture(t,rows);
  const svc=new TradeLearningService();
  assert.equal(svc.loadFromCsv(file).loadedCount,1);
  const snap=svc.getSnapshot();
  assert.equal(snap.totalRealizedPnlUsd,10);
  assert.equal(snap.totalTradesEvaluated,1);
  assert.equal(snap.adaptiveCalibration.calibrationRegime,'BALANCED');
  assert.equal(snap.evidenceStatus,'RESEARCH_ONLY_NOT_PROOF_OF_PROFITABILITY');
  assert.deepEqual(snap.dataQuality,{csvRowsRead:10,acceptedRows:1,rejectedRows:9,rejectionReasons:{SYNTHETIC_RECORD:2,DUPLICATE_TRADE_ID:1,MISSING_OR_NONFINITE_NUMBER:3,INCONSISTENT_PNL:1,INVALID_ECONOMIC_RANGE:1,INVALID_DECISION_FLAG:1}});
  assert.equal(fs.readFileSync(file,'utf8'),text);
});

test('zero proceeds total loss and exact zero metrics survive; CSV credit cannot fabricate alpha', t => {
  const {file}=fixture(t,[{...base,trade_id:'loss',exit_price_usd:0,proceeds_usd:0,realized_pnl_usd:-100,realized_pnl_pct:-100,profit_capture_ratio:0,exit_efficiency:0,hold_duration_ms:0,credit_archetype:'GOOD_DECISION_GOOD_OUTCOME'},
    {...base,trade_id:'flat',exit_price_usd:1,proceeds_usd:100,realized_pnl_usd:0,realized_pnl_pct:0,profit_capture_ratio:0,exit_efficiency:0}]);
  const svc=new TradeLearningService(); svc.loadFromCsv(file);
  const snap=svc.getSnapshot();
  assert.equal(snap.totalTradesEvaluated,2); assert.equal(snap.totalRealizedPnlUsd,-100);
  assert.equal(snap.averageProfitCaptureRatio,0); assert.equal(snap.averageExitEfficiency,0);
  assert.equal(snap.recentAutopsies.find(r=>r.tradeId==='loss').proceedsUsd,0);
  assert.equal(snap.recentAutopsies.find(r=>r.tradeId==='loss').holdDurationMs,0);
  assert.equal(snap.recentAutopsies.find(r=>r.tradeId==='flat').realizedPnlUsd,0);
  assert.equal(snap.attributionSummary.reinforceAlpha,0);
});

test('empty reload removes old evidence, and invalid in-memory reports cannot reach persistence', t => {
  const {file}=fixture(t,[base]);
  const svc=new TradeLearningService();svc.loadFromCsv(file);
  fs.writeFileSync(file,columns.join(',')+'\n'); svc.loadFromCsv(file);
  assert.equal(svc.getSnapshot().totalTradesEvaluated,0);
  const report={tokenMint:'GodTierSim111',symbol:'SIM',entryPriceUsd:1,exitPriceUsd:1.1,costBasisUsd:100,proceedsUsd:110,realizedPnlUsd:10,realizedPnlPct:10,holdDurationMs:1000,exitTrigger:'OPERATOR_CLOSE',wasDecisionSound:true};
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>svc.recordClosedTrade(report),/SYNTHETIC_RECORD/);
  assert.throws(()=>svc.recordClosedTrade({...report,tokenMint:'Mint111',realizedPnlUsd:NaN}),/MISSING_OR_NONFINITE_NUMBER/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.equal(svc.getSnapshot().totalTradesEvaluated,0);
});
