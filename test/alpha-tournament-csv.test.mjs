import test from 'node:test';
import assert from 'node:assert/strict';
import {convertCsv,runCsvTournament} from '../scripts/alpha-tournament-csv.mjs';
const header='strategy,split,eventId,timestamp,entryValue,exitValue,networkFee,priorityFee,tip,priceImpact,otherCosts,baselinePnl';
const a='wallet_copy,train,a,2026-01-01T00:00:00Z,100,110,1,1,1,2,1,0';
const b='wallet_copy,holdout,b,2026-02-01T00:00:00Z,100,110,1,1,1,2,1,0';
test('normalized CSV connects to tournament evaluator',()=>{
 const x=runCsvTournament([header,a,b].join('\n'),{minHoldoutTrades:1});
 assert.equal(x.results.wallet_copy.holdoutNetPnl,4);
 assert.equal(x.results.wallet_copy.status,'RESEARCH_CANDIDATE');
 assert.equal(x.liveAuthority,'BLOCKED');
});
test('missing cost rejects input',()=>assert.throws(()=>convertCsv([header,a.replace(',1,1,1,2,1,0',',1,1,,2,1,0')].join('\n')),/MISSING_tip/));
test('extra columns reject input',()=>assert.throws(()=>convertCsv([header,a+',0'].join('\n')),/INVALID_COLUMN_COUNT/));
test('CSV quoted comma handled',()=>{const x=convertCsv([header,a.replace(',a,',',"a,1",')].join('\n'));assert.equal(x[0].eventId,'a,1');});
