import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverySnapshot} from '../dist/discovery.js';
const now=100000;
function fixture(){return {now,feedStale:false,mode:'paper',positions:[],tokens:[{mint:'a',at:now,price:1,liquidity:100000}],risks:new Map([['a',{mint:'a',at:now,safe:true,rugged:false,authorities:{status:'revoked',mint:null,freeze:null},liquidity:{state:'locked'},holders:{top10Status:'within-limit'},bundling:{state:'clear'},token2022:{},risks:[]}]]),signals:new Map([['a',{mint:'a',at:now,source:'test-only',version:'1',highSignalIndex:90,pod:'UP',confidence:.9,devDump:false,bundler:false}]])};}
const row=x=>discoverySnapshot(x).rows[0];
test('complete fresh evidence ranks prime without granting execution',()=>{const x=fixture();assert.equal(row(x).tier,'PRIME');assert.equal(row(x).buyAllowed,false);assert.equal(discoverySnapshot(x).executionAuthority,'LOCKED');});
test('a completed or migrated curve remains visible and rankable as an observed AMM venue',()=>{const x=fixture();Object.assign(x.tokens[0],{complete:true,migrated:true});const observed=row(x);assert.equal(observed.venueState,'MIGRATED_AMM_OBSERVED');assert.equal(observed.tier,'PRIME');assert.equal(observed.buyAllowed,false);});
test('a stale Pump discovery stream does not veto fresh migrated AMM market evidence',()=>{const x=fixture();x.feedStale=true;Object.assign(x.tokens[0],{complete:true,migrated:true});assert.equal(row(x).tier,'PRIME');assert.equal(row(x).vetoes.includes('MARKET FEED STALE — CAPITAL LOCKED'),false);});
test('stale feed and token observations restrict entry without creating a veto',()=>{for(const change of [x=>x.feedStale=true,x=>x.tokens[0].at=now-5001,x=>x.tokens[0].at=now+1]){const x=fixture();change(x);assert.equal(row(x).tier,'QUARANTINED');assert.equal(row(x).outcome.tokenSafety,'UNKNOWN');}});
test('missing or invalid signals cannot confer prime status',()=>{for(const patch of [{at:now-5001},{at:now+1},{mint:'other'},{highSignalIndex:NaN},{confidence:2},{source:''},{devDump:undefined},{bundler:undefined}]){const x=fixture();Object.assign(x.signals.get('a'),patch);assert.notEqual(row(x).tier,'PRIME',JSON.stringify(patch));}const x=fixture();x.signals.clear();assert.equal(row(x).highSignalIndex,null);});
test('provider and actor findings quarantine without asserting token failure',()=>{for(const change of [r=>r.safe=false,r=>r.authorities.freeze='active',r=>r.holders.top10Status='over-limit',r=>r.bundling.state='flagged',r=>r.rugged=true]){const x=fixture();change(x.risks.get('a'));assert.equal(row(x).tier,'QUARANTINED');assert.equal(row(x).outcome.tokenSafety,'UNKNOWN');}});
test('unknown concentration, bundling or nonpositive market data never rank prime',()=>{for(const change of [x=>x.risks.get('a').holders.top10Status='unknown',x=>x.risks.get('a').bundling.state='unknown',x=>x.tokens[0].liquidity=0,x=>x.tokens[0].price=null]){const x=fixture();change(x);assert.notEqual(row(x).tier,'PRIME');}});
test('freshness boundary is inclusive and stale scans cannot verify protection',()=>{const x=fixture();x.tokens[0].at=now-5000;assert.equal(row(x).tier,'PRIME');x.risks.get('a').at=now-45001;assert.equal(row(x).liquidityLocked,false);assert.equal(row(x).tier,'DEVELOPING');});
test('fresh native SOL is observed without Pump-token safety or signal prerequisites',()=>{const x=fixture();Object.assign(x.tokens[0],{mint:'So11111111111111111111111111111111111111112',symbol:'SOL'});x.risks.clear();x.signals.clear();const observed=row(x);assert.equal(observed.tier,'OBSERVED');assert.equal(observed.safety,'NOT_APPLICABLE');assert.deepEqual(observed.pending,[]);assert.equal(observed.evidence[1].state,'NOT_APPLICABLE');assert.equal(observed.evidence[2].state,'NOT_APPLICABLE');assert.equal(observed.buyAllowed,false);});
test('a fresh native SOL observation does not inherit a stale PumpPortal discovery veto',()=>{const x=fixture();Object.assign(x.tokens[0],{mint:'So11111111111111111111111111111111111111112',symbol:'SOL'});x.risks.clear();x.signals.clear();x.feedStale=true;const observed=row(x);assert.equal(observed.tier,'OBSERVED');assert.equal(observed.safety,'NOT_APPLICABLE');assert.deepEqual(observed.vetoes,[]);});
test('a native SOL market conflict is not mislabelled as a security veto',()=>{const x=fixture();Object.assign(x.tokens[0],{mint:'So11111111111111111111111111111111111111112',symbol:'SOL',crossValidationStatus:'CONFLICTING'});x.risks.clear();x.signals.clear();const observed=row(x);assert.equal(observed.tier,'OBSERVED');assert.equal(observed.safety,'NOT_APPLICABLE');assert.match(observed.vetoes[0],/Market sources conflict/);});
test('discoverySnapshot exports authoritative systemStatus for mobile operations',()=>{
  const x = fixture();
  const snap = discoverySnapshot(x);
  assert.equal(snap.systemStatus.mode, 'PAPER');
  assert.equal(snap.systemStatus.feedFreshness, 'FRESH');
  assert.equal(snap.systemStatus.executionAuthority, 'LOCKED');
  assert.equal(snap.systemStatus.riskAuthority, 'LOCKED');
  assert.equal(snap.systemStatus.dcveCertification, 'UNVERIFIED');
  assert.ok(snap.systemStatus.executionLockReason.length > 0);

  x.feedStale = true;
  const staleSnap = discoverySnapshot(x);
  assert.equal(staleSnap.systemStatus.feedFreshness, 'STALE');
  assert.match(staleSnap.systemStatus.executionLockReason, /Market feed stale/);
});

test('decision trace preserves unknown evidence instead of fabricating positive observations',()=>{
  const x=fixture();
  delete x.tokens[0].txs;
  delete x.tokens[0].txCount;
  x.tokens[0].volume=5000;
  x.tokens[0].crossValidationStatus='SINGLE_SOURCE';
  x.risks.get('a').safe=undefined;
  const trace=row(x).decisionTrace;
  assert.equal(trace.find(step=>step.stage==='TRANSACTIONS').observed,'Awaiting trade count');
  assert.equal(trace.find(step=>step.stage==='CANONICAL_STATE').status,'PENDING');
  assert.equal(trace.find(step=>step.stage==='RUG_SECURITY').status,'PENDING');
});

