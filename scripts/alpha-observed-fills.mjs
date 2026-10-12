import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {evaluate} from './alpha-tournament.mjs';
const STRATEGIES=new Set(['wallet_copy','launch_momentum','cross_dex_arbitrage','execution_optimization']);
const finite=(v,k)=>{if(typeof v!=='number'||!Number.isFinite(v))throw Error('INVALID_'+k);return v};
const nonneg=(v,k)=>{const n=finite(v,k);if(n<0)throw Error('NEGATIVE_'+k);return n};
const iso=(v,k)=>{if(typeof v!=='string'||!/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?Z$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('INVALID_'+k);return Date.parse(v)};
const hash=(s)=>createHash('sha256').update(s).digest('hex');
export function reconstruct(records){
 if(!Array.isArray(records)||!records.length)throw Error('EMPTY_EXECUTION_RECORDS');
 const seen=new Set();const rows=[];
 for(const r of records){
  if(!r||typeof r!=='object'||Array.isArray(r))throw Error('INVALID_RECORD');
  if(!STRATEGIES.has(r.strategy)||!['train','holdout'].includes(r.split))throw Error('INVALID_STRATEGY_SPLIT');
  if(typeof r.eventId!=='string'||!r.eventId||typeof r.mint!=='string'||!r.mint)throw Error('INVALID_IDENTITY');
  const id=r.strategy+':'+r.eventId;if(seen.has(id))throw Error('DUPLICATE_EVENT');seen.add(id);
  if(r.source!=='OBSERVED_EXECUTION'||typeof r.entrySignature!=='string'||!r.entrySignature||typeof r.exitSignature!=='string'||!r.exitSignature||r.entrySignature===r.exitSignature)throw Error('MISSING_OBSERVED_PROVENANCE');
  if(typeof r.sourceSha256!=='string'||! /^[a-f0-9]{64}$/.test(r.sourceSha256))throw Error('INVALID_SOURCE_HASH');
  if(r.currency!=='SOL')throw Error('UNSUPPORTED_CURRENCY');
  const entryTime=iso(r.entryTimestamp,'entryTimestamp'),exitTime=iso(r.exitTimestamp,'exitTimestamp');
  if(exitTime<entryTime)throw Error('EXIT_BEFORE_ENTRY');
  const entry=nonneg(r.entryDebitSol,'entryDebitSol'),exit=nonneg(r.exitCreditSol,'exitCreditSol');
  if(entry<=0)throw Error('INVALID_ENTRY_VALUE');
  const costFields=['networkFeeSol','priorityFeeSol','tipSol','priceImpactSol','otherCostsSol'];
  const cost=Object.fromEntries(costFields.map(k=>[k,nonneg(r[k],k)]));
  const baseline=finite(r.baselinePnlSol,'baselinePnlSol');
  if(typeof r.baselineEvidenceSha256!=='string'||! /^[a-f0-9]{64}$/.test(r.baselineEvidenceSha256))throw Error('MISSING_BASELINE_PROVENANCE');
  if(r.feesIncludedInEntryExit!==false)throw Error('AMBIGUOUS_FEE_ACCOUNTING');
  if(r.fillStatus!=='FILLED_BOTH_LEGS')throw Error('UNSUPPORTED_PARTIAL_OR_FAILED_FILL');
  rows.push({strategy:r.strategy,split:r.split,eventId:r.eventId,timestamp:r.entryTimestamp,entryValue:entry,exitValue:exit,networkFee:cost.networkFeeSol,priorityFee:cost.priorityFeeSol,tip:cost.tipSol,priceImpact:cost.priceImpactSol,otherCosts:cost.otherCostsSol,baselinePnl:baseline});
 }
 return rows;
}
export function runObserved(records,opts){const rows=reconstruct(records);return {...evaluate(rows,opts),inputType:'OBSERVED_EXECUTION_RECORDS',inputRows:rows.length,executionParity:'NOT_VERIFIED',sourceVerification:'SELF_ATTESTED_NOT_INDEPENDENT'};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,output]=process.argv.slice(2);
 if(!input||!output){console.error('Usage: node scripts/alpha-observed-fills.mjs observed-fills.json report.json');process.exit(2)}
 try{const raw=readFileSync(input);const report=runObserved(JSON.parse(raw.toString('utf8')));report.inputSha256=hash(raw);writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,rows:report.inputRows,certification:report.certification}));}
 catch(e){console.error('OBSERVED_FILLS_BLOCKED:',e.message);process.exitCode=1;}
}
