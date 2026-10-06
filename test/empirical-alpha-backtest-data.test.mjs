import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {assertCsvDatasetPresent,createColumnIndex,iterateCsvRecords,isCsvRecordComplete,parseBacktestTokenRow,parseCsvRecord,runBacktestCli} from '../scripts/empirical-alpha-backtest-data.mjs';

const header=[
  'valid_price_observations','extreme_multiple_above_1000x_review','detected_at_utc','first_price_at_utc',
  'first_observed_price_sol','source_initial_price_sol','peak_multiple_x','minutes_first_price_to_peak',
  'last_observed_price_sol','largest_observed_drop_from_peak_pct','last_observed_drop_from_peak_pct',
  'median_observation_gap_seconds','first_price_precedes_detection','is_mayhem_mode','source_holder_concentration_suspect',
];
const row=['5','false','2026-06-05T09:12:26.343743Z','2026-06-05T09:12:28.604950Z','1.5e-8','2.5e-8','2.4','0.5',
  '2e-8','20','10','0.25','false','true','true'];

test('CSV parser handles delimiters and escaped quotes inside quoted fields',()=>{
  assert.deepEqual(parseCsvRecord('mint,"name, with comma","say ""hello""",symbol'),
    ['mint','name, with comma','say "hello"','symbol']);
  const multiline='mint,"name with\nembedded line",symbol';
  assert.equal(isCsvRecordComplete('mint,"name with'),false);
  assert.equal(isCsvRecordComplete('mint,"name with\nembedded line",symbol'),true);
  assert.deepEqual(parseCsvRecord(multiline),['mint','name with\nembedded line','symbol']);
  assert.throws(()=>parseCsvRecord('"unterminated'),/BACKTEST_CSV_QUOTE_UNTERMINATED/);
  assert.throws(()=>parseCsvRecord('unquoted"quote'),/BACKTEST_CSV_QUOTE_INVALID/);
});

test('backtest requires named fields and uses actual Mayhem/concentration columns',()=>{
  const index=createColumnIndex(header);
  const context=parseBacktestTokenRow(row,index);
  assert.equal(context.isMayhemMode,true);
  assert.equal(context.holderConcentrationSuspect,true);
  assert.equal(context.firstPricePrecedesDetection,false);
  assert.equal(context.detectionLagSec,2.261);
  assert.equal(context.peakMultipleX,2.4);
  assert.throws(()=>createColumnIndex(header.map(name=>name==='is_mayhem_mode'?'wrong_mode':name)),
    /BACKTEST_CSV_REQUIRED_COLUMN_MISSING:is_mayhem_mode/);
  assert.throws(()=>createColumnIndex([...header,'peak_multiple_x']),/BACKTEST_CSV_DUPLICATE_COLUMN:peak_multiple_x/);
});

test('named fields remain correct when the input header is reordered',()=>{
  const order=header.map((_,i)=>header.length-i-1);
  const context=parseBacktestTokenRow(order.map(i=>row[i]),createColumnIndex(order.map(i=>header[i])));
  assert.equal(context.isMayhemMode,true);
  assert.equal(context.holderConcentrationSuspect,true);
  assert.equal(context.firstPricePrecedesDetection,false);
  assert.equal(context.firstPriceSol,1.5e-8);
});

test('malformed observations do not silently become zeroes or safe flags',()=>{
  const index=createColumnIndex(header);
  const badPrice=[...row];badPrice[4]='';
  assert.throws(()=>parseBacktestTokenRow(badPrice,index),/BACKTEST_CSV_NUMBER_MISSING:first_observed_price_sol/);
  const badMode=[...row];badMode[13]='yes';
  assert.throws(()=>parseBacktestTokenRow(badMode,index),/BACKTEST_CSV_BOOLEAN_INVALID:is_mayhem_mode/);
  const unknownConcentration=[...row];unknownConcentration[14]='';
  assert.equal(parseBacktestTokenRow(unknownConcentration,index).holderConcentrationSuspect,null);
  for (const [position,property] of [[12,'firstPricePrecedesDetection'],[13,'isMayhemMode'],[14,'holderConcentrationSuspect']]) {
    const unknown=[...row];unknown[position]='';
    assert.equal(parseBacktestTokenRow(unknown,index)[property],null);
  }
  const excluded=[...row];excluded[0]='1';excluded[2]='';
  assert.equal(parseBacktestTokenRow(excluded,index),null);
  const censored=[...row];censored[8]='';censored[9]='';censored[10]='';
  const censoredContext=parseBacktestTokenRow(censored,index);
  assert.equal(censoredContext.lastObservedPriceSol,null);
  assert.equal(censoredContext.largestDropFromPeakPct,null);
  assert.equal(censoredContext.exitOutcomeEvidenceComplete,false);
});

test('record iterator joins quoted multiline fields and rejects truncated records',async()=>{
  const records=[];
  for await (const record of iterateCsvRecords(Readable.from(['a,"line one','line two",c','d,e,f']))) records.push(record);
  assert.deepEqual(records,['a,"line one\nline two",c','d,e,f']);
  await assert.rejects(async()=>{
    for await (const _record of iterateCsvRecords(Readable.from(['a,"unterminated\nlast']))) { /* consume */ }
  },/BACKTEST_CSV_QUOTE_UNTERMINATED/);
});

test('failed CLI run clears stale report and returns failure status',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sylph-backtest-'));
  const reportPath=path.join(dir,'report.json');
  fs.writeFileSync(reportPath,'old report');
  let exitCode=0;
  let reportedError;
  try {
    await runBacktestCli(async()=>{throw new Error('BACKTEST_CSV_NUMBER_INVALID:first_observed_price_sol');},{
      reportPath,stderr:error=>{reportedError=error;},setExitCode:code=>{exitCode=code;},
    });
    assert.equal(exitCode,1);
    assert.match(reportedError.message,/BACKTEST_CSV_NUMBER_INVALID/);
    assert.equal(fs.existsSync(reportPath),false);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('empty and header-only datasets are rejected',()=>{
  assert.throws(()=>assertCsvDatasetPresent(null,0),/BACKTEST_CSV_HEADER_MISSING/);
  assert.throws(()=>assertCsvDatasetPresent(createColumnIndex(header),1),/BACKTEST_CSV_DATA_ROWS_MISSING/);
  assert.doesNotThrow(()=>assertCsvDatasetPresent(createColumnIndex(header),2));
});

test('CLI rejects empty, malformed-header, invalid-scalar, and truncated-quote inputs',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sylph-backtest-cli-'));
  const inputPath=path.join(dir,'input.csv');
  const reportPath=path.join(dir,'report.json');
  const scriptPath=fileURLToPath(new URL('../scripts/empirical-alpha-backtest.mjs',import.meta.url));
  const malformedScalar=[...row];malformedScalar[4]='not-a-price';
  const cases=[
    '',
    'wrong,header\nvalue,other',
    `${header.join(',')}\n${malformedScalar.join(',')}`,
    `${header.join(',')}\n"unterminated`,
  ];
  try {
    for (const input of cases) {
      fs.writeFileSync(inputPath,input);
      fs.writeFileSync(reportPath,'stale report');
      const result=spawnSync(process.execPath,[scriptPath],{
        encoding:'utf8',timeout:10_000,
        env:{...process.env,SYLPH_BACKTEST_CSV_PATH:inputPath,SYLPH_BACKTEST_REPORT_PATH:reportPath},
      });
      assert.notEqual(result.status,0,`expected CLI failure for input ${JSON.stringify(input.slice(0,50))}`);
      assert.equal(fs.existsSync(reportPath),false);
    }
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

test('scenario CLI labels the parser-defined cohort and accounts for excluded source rows',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sylph-backtest-cohort-'));
  const inputPath=path.join(dir,'input.csv');
  const reportPath=path.join(dir,'report.json');
  const scriptPath=fileURLToPath(new URL('../scripts/empirical-alpha-backtest.mjs',import.meta.url));
  const singleObservation=[...row];singleObservation[0]='1';singleObservation[2]='';
  try {
    fs.writeFileSync(inputPath,[header.join(','),row.join(','),singleObservation.join(',')].join('\n'));
    const result=spawnSync(process.execPath,[scriptPath],{
      encoding:'utf8',timeout:10_000,
      env:{...process.env,SYLPH_BACKTEST_CSV_PATH:inputPath,SYLPH_BACKTEST_REPORT_PATH:reportPath},
    });
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/RULE: \[BASELINE_RESEARCH_COHORT\]/);
    assert.match(result.stdout,/Source rows: 2 \| malformed-width rows: 0 \| excluded before rule evaluation: 1/);
    const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
    assert.deepEqual(report.cohort,{
      id:'MULTI_OBSERVATION_NONEXTREME_SOURCE_COHORT',sourceRows:2,malformedWidthRows:0,
      excludedBeforeRuleEvaluation:1,includedRows:1,
    });
    assert.equal(report.matrix.BASELINE_RESEARCH_COHORT.STATIC_2X_STOP_25.inSample.trades,1);
    assert.equal(Object.hasOwn(report.matrix,'BASELINE_ALL_TOKENS'),false);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
