import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const output=process.env.PAPER_SCRATCH_TEST_DIST;
const storageModule=output
  ? pathToFileURL(join(output,'platform','storage','paper-account-v3-scratch-identity-index.js')).href
  : new URL('../../dist/platform/storage/paper-account-v3-scratch-identity-index.js',import.meta.url).href;
const {
  PaperAccountV3ScratchIdentityIndex,
  assertPaperAccountV3ScratchIdentityRuntime,
  paperAccountV3ScratchIdentityIndexLimits:limits,
}=await import(storageModule);

function freshDir(t) {
  const parent=mkdtempSync(join(tmpdir(),'sylph-scratch-index-test-'));
  const attempt=join(parent,'attempt');mkdirSync(attempt);
  t.after(()=>rmSync(parent,{recursive:true,force:true}));
  return {parent,attempt};
}
function errorCode(code) {return new RegExp(code.replaceAll('_','_'));}
const TEST_MAX_BYTES=1024*1024;
const FULL_TEST_MAX_BYTES=limits.pageSize*64;
function key(i) {return `00000000-0000-4000-8000-${Number(i).toString(16).padStart(12,'0')}`;}
function openIndex(dir,maxBytes=TEST_MAX_BYTES) {return PaperAccountV3ScratchIdentityIndex.open(dir,{maxBytes});}
function rawInspect(path) {
  const db=new DatabaseSync(path);
  try {
    return {
      integrity:db.prepare('PRAGMA integrity_check').get().integrity_check,
      pages:db.prepare('PRAGMA page_count').get().page_count,
      rows:db.prepare('SELECT count(*) AS count FROM identities').get().count,
    };
  } finally {db.close();}
}

test('runtime gate requires Node APIs introduced by Node 24.15 and fails closed on older versions',()=>{
  assert.doesNotThrow(()=>assertPaperAccountV3ScratchIdentityRuntime('24.15.0'));
  assert.doesNotThrow(()=>assertPaperAccountV3ScratchIdentityRuntime('25.0.0'));
  assert.throws(()=>assertPaperAccountV3ScratchIdentityRuntime('not-a-version'),errorCode('PAPER_ACCOUNT_V3_SCRATCH_RUNTIME_UNSUPPORTED'));
  assert.throws(()=>assertPaperAccountV3ScratchIdentityRuntime('24.14.99'),errorCode('PAPER_ACCOUNT_V3_SCRATCH_RUNTIME_UNSUPPORTED'));
});

test('identity index records exact scoped identities idempotently and uses only the main database file',t=>{
  const {attempt}=freshDir(t);
  const index=openIndex(attempt);
  assert.equal(index.has('owner',key(1)),false);
  assert.equal(index.remember('owner',key(1)),true);
  assert.equal(index.remember('owner',key(1)),false);
  assert.equal(index.has('owner',key(1)),true);
  assert.equal(index.has('lease',key(1)),false,'namespaces are independent');
  assert.equal(index.remember('lease',key(1)),true);
  assert.equal(index.remember('lockNonce',key(2)),true);
  index.close();
  assert.deepEqual(readdirSync(attempt),[limits.databaseFileName]);
  assert.equal(statSync(join(attempt,limits.databaseFileName)).size<=TEST_MAX_BYTES,true);
  const db=new DatabaseSync(join(attempt,limits.databaseFileName));
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(db.prepare('PRAGMA page_size').get().page_size,limits.pageSize);
    assert.ok(db.prepare('PRAGMA page_count').get().page_count<=TEST_MAX_BYTES/limits.pageSize);
    assert.equal(db.prepare('SELECT count(*) AS count FROM identities').get().count,3);
  } finally {db.close();}
  assert.throws(()=>index.has('owner',key(1)),/PAPER_ACCOUNT_V3_SCRATCH_INDEX_CLOSED/);
});

test('identity and namespace validation is bounded and rejects malformed values without coercion',t=>{
  const {attempt}=freshDir(t);const index=openIndex(attempt);
  const maximum=key(0);
  assert.equal(index.remember('owner',maximum),true);
  assert.equal(index.has('owner',maximum),true);
  assert.throws(()=>index.remember('owner','x'.repeat(limits.maxIdentityUtf8Bytes+1)),/PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_TOO_LARGE/);
  assert.throws(()=>index.has('bad','x'),/PAPER_ACCOUNT_V3_SCRATCH_NAMESPACE_INVALID/);
  let getterCalls=0;const getterValue={};Object.defineProperty(getterValue,'toString',{get(){getterCalls++;return ()=> 'identity';}});
  assert.throws(()=>index.remember('owner',getterValue),/PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_INVALID/);
  assert.equal(getterCalls,0);
  assert.throws(()=>index.remember('owner','bad\ud800'),/PAPER_ACCOUNT_V3_SCRATCH_IDENTITY_INVALID/);
  assert.throws(()=>PaperAccountV3ScratchIdentityIndex.open(attempt,{maxBytes:TEST_MAX_BYTES+1}),/PAPER_ACCOUNT_V3_SCRATCH_MAX_BYTES_INVALID/);
  let optionGetterCalls=0;const badOptions={};Object.defineProperty(badOptions,'maxBytes',{enumerable:true,get(){optionGetterCalls++;return TEST_MAX_BYTES;}});
  assert.throws(()=>PaperAccountV3ScratchIdentityIndex.open(attempt,badOptions),/PAPER_ACCOUNT_V3_SCRATCH_OPTIONS_INVALID/);
  assert.equal(optionGetterCalls,0);
  index.close();
});

test('index refuses missing, linked, nonempty, and pre-existing database attempt paths',t=>{
  const {parent,attempt}=freshDir(t);
  assert.throws(()=>openIndex(join(parent,'missing')),/PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID/);
  const filePath=join(parent,'plain-file');writeFileSync(filePath,'x');
  assert.throws(()=>openIndex(filePath),/PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_INVALID/);
  writeFileSync(join(attempt,'preexisting'),'x');
  assert.throws(()=>openIndex(attempt),/PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_NOT_EMPTY/);
  rmSync(join(attempt,'preexisting'));
  const index=openIndex(attempt);index.close();
  assert.throws(()=>openIndex(attempt),/PAPER_ACCOUNT_V3_SCRATCH_ATTEMPT_DIRECTORY_NOT_EMPTY/);
});

test('SQLITE_FULL at the caller-selected page cap poisons the helper without a partial identity',t=>{
  const {attempt}=freshDir(t);const databasePath=join(attempt,limits.databaseFileName);
  const index=openIndex(attempt,FULL_TEST_MAX_BYTES);
  let inserted=0;let failure;
  for(let i=0;i<5000;i+=1) {
    try {
      assert.equal(index.remember('owner',key(i)),true);
      inserted+=1;
    } catch(error) {failure=error;break;}
  }
  assert.ok(failure,'bounded database must stop growing at its configured cap');
  assert.match(failure.message,/PAPER_ACCOUNT_V3_SCRATCH_INDEX_SQLITE_FAILURE/);
  assert.match(failure.cause.message,/database or disk is full/i);
  assert.throws(()=>index.has('owner',key(0)),/PAPER_ACCOUNT_V3_SCRATCH_INDEX_POISONED/);
  assert.throws(()=>index.close(),/PAPER_ACCOUNT_V3_SCRATCH_INDEX_POISONED/);
  const state=rawInspect(databasePath);
  assert.equal(state.integrity,'ok');
  assert.equal(state.pages,FULL_TEST_MAX_BYTES/limits.pageSize);
  assert.equal(state.rows,inserted,'the failed identity was not partially committed');
  assert.equal(statSync(databasePath).size,FULL_TEST_MAX_BYTES);
  assert.deepEqual(readdirSync(attempt),[limits.databaseFileName],'MEMORY journal/temp settings leave no persistent sidecars');
});
