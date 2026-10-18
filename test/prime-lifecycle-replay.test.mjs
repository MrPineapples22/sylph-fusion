import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replayPrime, replayPrimeOpportunity } from '../scripts/prime-lifecycle-replay.mjs';

const Q = (id,side,t,qty,amount,more={}) => ({id,side,quotedAtMs:t-100,availableAtMs:t,expiresAtMs:t+1500,
  provider:'fixture-provider',routeId:id,simulatedOk:true,feeUsd:0,
  ...(side==='BUY'?{inputUsd:amount,outputTokenQty:qty}:{inputTokenQty:qty,outputUsd:amount}),...more});
const F = (id,side,t,qty,amount,more={}) => ({id,side,atMs:t,observedAtMs:t+50,kind:'CHAIN_FINALIZED',signature:'test_sig_'+id,
  tokenQty:qty,grossUsd:amount,feeUsd:0,...more});
const O = (over={}) => ({id:'opp',mint:'TESTMINT_A',symbol:'TEST',
  signal:{atMs:100000,receivedAtMs:100100,referencePriceUsd:1},budgetUsd:100,horizonEndMs:150000,
  quotes:[Q('buy','BUY',100300,100,100),Q('peak','SELL',120000,100,180),Q('tail','SELL',149000,100,60)],
  fills:[F('entry','BUY',101000,100,100),F('exit','SELL',148000,100,60)],...over});

test('replays 80% best quoted gain vs 40% finalized loss: retention candidate',()=>{
  const r=replayPrimeOpportunity(O());
  assert.equal(r.entryOpportunity.costUsd,100);
  assert.equal(r.actualEntry.quantity,100);
  assert.equal(r.bestObservedExit.modeledNetReturnPct,80);
  assert.equal(r.actualExit.finalNetReturnPct,-40);
  assert.equal(r.decomposition.grossRetentionOpportunityUsd,120);
  assert.equal(r.decomposition.exitCoverageComplete,true);
  assert.ok(r.hypotheses.includes('PROFIT_RETENTION_CANDIDATE'));
  assert.equal(r.bestObservedExit.executionVerified,false);
});

test('no quote is never an executable entry or PnL',()=>{
  const r=replayPrimeOpportunity(O({quotes:[],fills:[]}));
  assert.equal(r.entryOpportunity,null);
  assert.equal(r.bestObservedExit,null);
  assert.equal(r.actualExit.finalNetPnlUsd,null);
  assert.equal(r.actualExit.finalEvidence,'CENSORED');
  assert.ok(r.warnings.includes('NO_RECORDED_ENTRY_FILL'));
});

test('future quote, expired quote and failed simulation cannot form an entry',()=>{
  const a=O({quotes:[Q('future','BUY',149900,100,100),Q('expired','BUY',100300,100,100,{expiresAtMs:100350}),Q('unsafe','BUY',100500,100,100,{simulatedOk:false})],fills:[]});
  const r=replayPrimeOpportunity(a);
  assert.equal(r.entryOpportunity,null);
});

test('rejects impossible timestamps, overselling, duplicated IDs, missing finality signature',()=>{
  const f=O({fills:[F('entry','BUY',101000,100,100),F('oversell','SELL',102000,101,101)]});
  assert.throws(()=>replayPrimeOpportunity(f),/oversold/);
  assert.throws(()=>replayPrimeOpportunity(O({quotes:[Q('a','BUY',100300,100,100),Q('a','SELL',120000,100,110)]})),/duplicate/);
  assert.throws(()=>replayPrimeOpportunity(O({fills:[F('entry','BUY',101000,100,100,{signature:''})]})),/signature/);
  assert.throws(()=>replayPrimeOpportunity(O({signal:{atMs:100000,receivedAtMs:99999,referencePriceUsd:1}})),/signal received/);
});

test('partial exit uses proportional realized basis and exact-quantity terminal quote',()=>{
  const r=replayPrimeOpportunity(O({fills:[F('entry','BUY',101000,100,100),F('half','SELL',148000,50,55)],
    quotes:[Q('buy','BUY',100300,100,100),Q('peak','SELL',120000,100,180),Q('tail','SELL',149000,50,35)]}));
  assert.equal(r.actualExit.realizedPnlUsd,5);
  assert.equal(r.actualExit.remainingQuantity,50);
  assert.equal(r.actualExit.finalNetPnlUsd,-10);
  assert.equal(r.actualExit.finalEvidence,'MARK_TO_SIZE_AWARE_QUOTE');
  assert.equal(r.bestObservedExit.modeledNetReturnPct,80);
});

test('partial exit never scales a 100-token quote to value 50 tokens',()=>{
  const r=replayPrimeOpportunity(O({fills:[F('entry','BUY',101000,100,100),F('half','SELL',148000,50,55)]}));
  assert.equal(r.actualExit.finalNetPnlUsd,null);
  assert.ok(r.warnings.includes('OPEN_INVENTORY_UNPRICED'));
});

test('token-selection tag requires dense quote coverage; sparse series is censored for diagnosis',()=>{
  const base=O({quotes:[Q('buy','BUY',100300,100,100),Q('peak','SELL',120000,100,95),Q('tail','SELL',149000,100,80)]});
  assert.ok(replayPrimeOpportunity(base).hypotheses.includes('TOKEN_SELECTION_CANDIDATE'));
  const short=replayPrimeOpportunity(base,{maxCoverageGapMs:2000});
  assert.ok(!short.hypotheses.includes('TOKEN_SELECTION_CANDIDATE'));
  assert.ok(short.warnings.includes('SPARSE_EXIT_COVERAGE'));
});

test('detects entry deterioration but labels multiple hypotheses, not a claimed causal root',()=>{
  const r=replayPrimeOpportunity(O({fills:[F('entry','BUY',112000,100,120),F('exit','SELL',148000,100,60)],
    quotes:[Q('buy','BUY',100300,100,100,{expiresAtMs:115000}),Q('peak','SELL',120000,100,180),Q('tail','SELL',149000,100,60)]}));
  assert.ok(r.hypotheses.includes('SIGNAL_OR_ORDER_LATENCY_CANDIDATE'));
  assert.ok(r.hypotheses.includes('ENTRY_EXECUTION_DRAG_CANDIDATE'));
  assert.equal(r.decomposition.entryVsEarliestAvailableQuotePct,20);
});

test('aggregation, stable output, paper classification and CLI fail-if-existing output',()=>{
  const data={schema:'sylph-prime-lifecycle-v1',opportunities:[O(),O({id:'paper',mint:'TESTMINT_B',fills:[F('entry','BUY',101000,100,100,{kind:'PAPER'}),F('exit','SELL',148000,100,60,{kind:'PAPER'})]})]};
  const a=replayPrime(data),b=replayPrime(data);
  assert.deepEqual(a,b);
  assert.equal(a.summary.opportunities,2);
  assert.equal(a.liveTradingAuthorized,false);
  assert.ok(a.opportunities[1].warnings.includes('PAPER_FILLS_NOT_CHAIN_EXECUTIONS'));
  assert.throws(()=>replayPrime({...data,opportunities:[O(),O()]}),/Duplicate opportunity/);
  const tmp=mkdtempSync(join(tmpdir(),'prime-replay-'));
  try {
    const input=join(tmp,'input.json'), output=join(tmp,'out.json');
    writeFileSync(input,JSON.stringify(data));
    let cli=spawnSync(process.execPath,[new URL('../scripts/prime-lifecycle-replay.mjs',import.meta.url).pathname,input,output],{encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    assert.equal(JSON.parse(readFileSync(output,'utf8')).summary.closedPositions,2);
    cli=spawnSync(process.execPath,[new URL('./prime-lifecycle-replay.mjs',import.meta.url).pathname,input,output],{encoding:'utf8'});
    assert.notEqual(cli.status,0);
    assert.match(cli.stderr,/EEXIST/);
  } finally {rmSync(tmp,{recursive:true,force:true});}
});
