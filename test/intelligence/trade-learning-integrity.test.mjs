import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { harmonizeCsv } from '../../scripts/harmonize-pavlov-attributions.mjs';
import { TradeLearningService } from '../../dist/intelligence/attribution/trade-learning-service.js';
import { PavlovOutcomeAttributionEngine } from '../../dist/intelligence/attribution/pavlov-attribution.js';

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
    {...base,trade_id:'negative',cost_basis_usd:-100}, {...base,trade_id:'flag',was_decision_sound:'not-a-verdict'}];
  const {file,text}=fixture(t,rows);
  const svc=new TradeLearningService();
  assert.equal(svc.loadFromCsv(file).loadedCount,2);
  const snap=svc.getSnapshot();
  assert.equal(snap.totalRealizedPnlUsd,20);
  assert.equal(snap.totalTradesEvaluated,2);
  assert.equal(snap.adaptiveCalibration.calibrationRegime,'BALANCED');
  assert.equal(snap.evidenceStatus,'RESEARCH_ONLY_NOT_PROOF_OF_PROFITABILITY');
  assert.deepEqual(snap.dataQuality,{csvRowsRead:10,acceptedRows:2,rejectedRows:8,rejectionReasons:{SYNTHETIC_RECORD:2,DUPLICATE_TRADE_ID:1,MISSING_OR_NONFINITE_NUMBER:3,INCONSISTENT_PNL:1,INVALID_ECONOMIC_RANGE:1}});
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

const report = {tokenMint:'Mint111',symbol:'REAL',entryPriceUsd:1,exitPriceUsd:1.1,costBasisUsd:100,proceedsUsd:110,realizedPnlUsd:10,realizedPnlPct:10,holdDurationMs:1000,exitTrigger:'OPERATOR_CLOSE',wasDecisionSound:true};
const noQuadrants = {unknown:0,reinforceAlpha:0,neutralVariance:0,doNotReinforceLuck:0,penalizePolicy:0};

test('process evidence evaluation is invariant to PnL, MAE and compliant emergency exits', () => {
  assert.equal(PavlovOutcomeAttributionEngine.evaluateDecisionSoundness({}).wasDecisionSound,'UNKNOWN');
  for (const realizedPnlPct of [-100,-10,0,10,100]) {
    for (const exitTrigger of ['STOP_LOSS','EMERGENCY_UNWIND','TRAILING_TARGET']) {
      for (const maePct of [-100,-15,0]) {
        const outcome = {realizedPnlPct,exitTrigger,maePct,isPanicExit:true};
        assert.deepEqual(PavlovOutcomeAttributionEngine.evaluateDecisionSoundness({passedSafety:true,...outcome}),
          {wasDecisionSound:true,reason:'SOUND_DECISION_PROCESS'});
        assert.deepEqual(PavlovOutcomeAttributionEngine.evaluateDecisionSoundness({passedSafety:true,executionPermitValid:false,...outcome}),
          {wasDecisionSound:false,reason:'INVALID_OR_EXPIRED_EXECUTION_PERMIT'});
        assert.equal(PavlovOutcomeAttributionEngine.evaluateDecisionSoundness(outcome).wasDecisionSound,'UNKNOWN');
      }
    }
  }
});

test('unverified flags never populate quality quadrants or change calibration, including on reload', t => {
  const {file}=fixture(t,[]);
  const svc=new TradeLearningService(); svc.loadFromCsv(file);
  const before=svc.getSnapshot().adaptiveCalibration;
  for (let i=0;i<8;i++) {
    const a=svc.recordClosedTrade({...report,wasDecisionSound:i%2===0,exitPriceUsd:0.9,proceedsUsd:90,realizedPnlUsd:-10,realizedPnlPct:-10,exitTrigger:'STOP_LOSS'});
    assert.equal(a.wasDecisionSound,'UNKNOWN');
    assert.equal(a.attribution.credit_archetype,'UNKNOWN');
    assert.equal(a.attribution.policy_reinforcement_action,'NO_POLICY_UPDATE');
  }
  const snap=svc.getSnapshot();
  assert.deepEqual(snap.attributionSummary,{...noQuadrants,unknown:8});
  assert.deepEqual(snap.adaptiveCalibration,before);
  assert.equal(snap.totalRealizedPnlUsd,-80);
  assert.equal(snap.lossCount,8);
  const reloaded=new TradeLearningService(); reloaded.loadFromCsv(file);
  assert.deepEqual(reloaded.getSnapshot().attributionSummary,snap.attributionSummary);
  assert.deepEqual(reloaded.getSnapshot().adaptiveCalibration,snap.adaptiveCalibration);
  assert.equal(reloaded.getSnapshot().recentAutopsies[0].decisionSoundnessReason,'MISSING_VERIFIED_PROCESS_EVIDENCE');
});

test('verified linked assessment survives persistence/reload and remains sound after a stop loss', t => {
  const {file}=fixture(t,[]);
  fs.writeFileSync(file,[...columns,'decision_soundness_reason','process_evidence_ref','custom_field'].join(',')+'\n');
  // Independent evidence store. This fixture verifier checks the entry identity and
  // economic fields before evaluating process facts; outcomes are not available to it.
  const evidence=new Map([['fixture:entry-111',{tokenMint:'Mint111',entryPriceUsd:1,costBasisUsd:100,passedSafety:true,executionPermitValid:true}]]);
  const resolve=context=>{
    assert.equal('realizedPnlPct' in context,false);
    assert.equal('wasDecisionSound' in context,false);
    const record=evidence.get(context.processEvidenceRef);
    if(!record || record.tokenMint!==context.tokenMint || record.entryPriceUsd!==context.entryPriceUsd || record.costBasisUsd!==context.costBasisUsd) return;
    return {...PavlovOutcomeAttributionEngine.evaluateDecisionSoundness(record),evidenceRef:context.processEvidenceRef};
  };
  const svc=new TradeLearningService(resolve); svc.loadFromCsv(file);
  const a=svc.recordClosedTrade({...report,processEvidenceRef:'fixture:entry-111',exitPriceUsd:0.9,proceedsUsd:90,realizedPnlUsd:-10,realizedPnlPct:-10,exitTrigger:'STOP_LOSS'});
  assert.equal(a.wasDecisionSound,true);
  assert.equal(a.attribution.credit_archetype,'GOOD_DECISION_BAD_OUTCOME');
  const bytes=fs.readFileSync(file);
  const reloaded=new TradeLearningService(resolve); reloaded.loadFromCsv(file);
  const b=reloaded.getSnapshot().recentAutopsies[0];
  assert.equal(b.wasDecisionSound,a.wasDecisionSound);
  assert.equal(b.processEvidenceRef,a.processEvidenceRef);
  assert.equal(b.decisionSoundnessReason,a.decisionSoundnessReason);
  assert.equal(b.attribution.credit_archetype,a.attribution.credit_archetype);
  assert.deepEqual(fs.readFileSync(file),bytes);
  const unverified=new TradeLearningService(); unverified.loadFromCsv(file);
  assert.equal(unverified.getSnapshot().recentAutopsies[0].wasDecisionSound,'UNKNOWN');
  assert.equal(svc.recordClosedTrade({...report,processEvidenceRef:'missing'}).wasDecisionSound,'UNKNOWN');
});

test('missing or failed verifier evidence cannot fabricate a process assessment', () => {
  for(const resolve of [()=>undefined,()=>{throw new Error('unavailable')},()=>({wasDecisionSound:true,reason:'ok',evidenceRef:''})]) {
    const svc=new TradeLearningService(resolve);
    assert.equal(svc.recordClosedTrade({...report,processEvidenceRef:'fixture:unverified'}).attribution.credit_archetype,'UNKNOWN');
  }
});

test('unknown trades do not change an assessed cohort calibration', () => {
  const svc=new TradeLearningService(context=>context.tokenMint==='verified'
    ? {wasDecisionSound:true,reason:'FIXTURE_PROCESS_VERIFIED',evidenceRef:'fixture:verified-entry'} : undefined);
  for(let i=0;i<3;i++)svc.recordClosedTrade({...report,tokenMint:'verified',processEvidenceRef:'fixture:verified-entry'});
  const calibration=svc.getSnapshot().adaptiveCalibration;
  assert.equal(calibration.calibrationRegime,'OPTIMAL');
  for(let i=0;i<20;i++)svc.recordClosedTrade({...report,exitPriceUsd:0,proceedsUsd:0,realizedPnlUsd:-100,realizedPnlPct:-100});
  assert.deepEqual(svc.getSnapshot().adaptiveCalibration,calibration);
  assert.deepEqual(svc.getSnapshot().attributionSummary,{...noQuadrants,reinforceAlpha:3,unknown:20});
});

function getGitExecutable() {
  if (process.env.GIT_PATH && fs.existsSync(process.env.GIT_PATH)) return process.env.GIT_PATH;
  for (const c of ['git', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe']) {
    if (c === 'git') {
      try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return 'git'; } catch {}
    } else if (fs.existsSync(c)) {
      return c;
    }
  }
  return 'git';
}

test('historical CSV is exactly restored; legacy labels remain unassessed without altering any field', () => {
  const file=path.resolve('data/pavlov_attributions.csv');
  const original=execFileSync(getGitExecutable(),['show','9bbe14d:data/pavlov_attributions.csv'],{maxBuffer:20*1024*1024});
  const before=fs.readFileSync(file);
  assert.deepEqual(before,original);
  const svc=new TradeLearningService(); const loaded=svc.loadFromCsv(file);
  assert.ok(loaded.loadedCount>1000);
  const snap=svc.getSnapshot();
  assert.deepEqual(snap.attributionSummary,{...noQuadrants,unknown:loaded.loadedCount});
  assert.equal(snap.adaptiveCalibration.adaptiveHsiHurdle,80);
  assert.equal(snap.adaptiveCalibration.calibrationRegime,'BALANCED');
  assert.deepEqual(fs.readFileSync(file),before);
  // This comparison includes the populated fields on CSV line 694.
  assert.equal(before.toString().split('\n')[693],original.toString().split('\n')[693]);
});

test('harmonizer import and explicit audit preserve every source byte and require a path', t => {
  const {file}=fixture(t,[base]);
  const dir=path.dirname(file);
  fs.mkdirSync(path.join(dir,'data'));
  const candidate=path.join(dir,'data','pavlov_attributions.csv');
  const bytes=Buffer.from('a,b,custom\r\n"quoted,field",old-label,"kept"\r\n');
  fs.writeFileSync(candidate,bytes);
  const moduleUrl=pathToFileURL(path.resolve('scripts/harmonize-pavlov-attributions.mjs')).href;
  execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(moduleUrl)})`],{cwd:dir});
  assert.deepEqual(fs.readFileSync(candidate),bytes);
  assert.throws(()=>harmonizeCsv(),/explicit input CSV path/);
  const audit=harmonizeCsv(candidate);
  assert.equal(audit.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(audit.processAssessment,'UNKNOWN');
  assert.deepEqual(fs.readFileSync(candidate),bytes);
  assert.deepEqual(fs.readdirSync(path.join(dir,'data')),['pavlov_attributions.csv']);
});

test('missing explicit path never reads or appends to an environment or repository fallback', t => {
  const {file,text}=fixture(t,[base]);
  const missing=path.join(path.dirname(file),'missing.csv');
  const prior=process.env.PAVLOV_ATTRIBUTIONS_PATH;
  t.after(()=>{if(prior===undefined)delete process.env.PAVLOV_ATTRIBUTIONS_PATH;else process.env.PAVLOV_ATTRIBUTIONS_PATH=prior;});
  process.env.PAVLOV_ATTRIBUTIONS_PATH=file;
  const local=path.resolve('data/pavlov_attributions.csv');
  const before=fs.readFileSync(local);
  const svc=new TradeLearningService();svc.loadFromCsv(file);
  const result=svc.loadFromCsv(missing);
  assert.equal(result.loadedCount,0);
  assert.equal(result.source,'Not found: '+missing);
  assert.equal(svc.getSnapshot().totalTradesEvaluated,0);
  svc.recordClosedTrade(report);
  assert.equal(fs.readFileSync(file,'utf8'),text);
  assert.deepEqual(fs.readFileSync(local),before);
  assert.equal(fs.existsSync(missing),false);
  process.env.PAVLOV_ATTRIBUTIONS_PATH=missing;
  assert.equal(new TradeLearningService().loadFromCsv().source,'Not found: '+missing);
});

test('older headers cannot drop an evidence link and change the assessment on reload', t => {
  const {file}=fixture(t,[]);
  const resolver=()=>({wasDecisionSound:true,reason:'FIXTURE_VERIFIED',evidenceRef:'fixture:entry'});
  const svc=new TradeLearningService(resolver);svc.loadFromCsv(file);
  assert.equal(svc.recordClosedTrade({...report,processEvidenceRef:'fixture:entry'}).wasDecisionSound,'UNKNOWN');
  const reloaded=new TradeLearningService(resolver);reloaded.loadFromCsv(file);
  assert.equal(reloaded.getSnapshot().recentAutopsies[0].wasDecisionSound,'UNKNOWN');
  const inMemory=new TradeLearningService(resolver);
  assert.equal(inMemory.recordClosedTrade(report).wasDecisionSound,'UNKNOWN');
  assert.equal(inMemory.recordClosedTrade({...report,processEvidenceRef:'fixture:wrong-link'}).wasDecisionSound,'UNKNOWN');
});
