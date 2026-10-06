import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {SystemLifecycleManager,globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';
import {CommandGateway} from '../dist/command-gateway.js';
import {enterPaperStartupDegraded,PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON} from '../terminal/startup-readiness.mjs';

test('startup recovery gate stays degraded without inventing reconciliation or certification',()=>{
  const lifecycle=new SystemLifecycleManager();let reconciliationCalls=0;let certificationCalls=0;
  lifecycle.recordReconciliation=()=>{reconciliationCalls++;};
  lifecycle.recordCertification=()=>{certificationCalls++;};
  const readiness=enterPaperStartupDegraded(lifecycle);
  assert.equal(lifecycle.getState(),'DEGRADED');
  assert.equal(lifecycle.isEntryPermitted(),false);
  assert.equal(lifecycle.isExitPermitted(),true);
  assert.equal(readiness.recoveryStatus,'UNAVAILABLE');
  assert.equal(readiness.reconciliationStatus,'UNAVAILABLE');
  assert.equal(readiness.certificationStatus,'NOT_PERFORMED');
  assert.equal(readiness.reason,PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON);
  assert.equal(reconciliationCalls,0);
  assert.equal(certificationCalls,0);
  assert.deepEqual(lifecycle.getHistory().map(record=>record.to),['INITIALIZING','CONNECTING','SYNCHRONIZING','RECONCILING','DEGRADED']);
});

test('startup wiring reports recovery unavailable and never certifies or enables automation at boot',async()=>{
  const source=await readFile(new URL('../terminal/server.mjs',import.meta.url),'utf8');
  const gateAt=source.indexOf('const startupReadiness =');
  assert.notEqual(gateAt,-1);
  const gate=source.slice(gateAt,source.indexOf('async function readLive',gateAt));
  assert.match(gate,/enterPaperStartupDegraded\(globalLifecycle\)/);
  assert.doesNotMatch(gate,/recordReconciliation|recordCertification|transition\(['"](?:READY|HEALTHY|CERTIFYING)['"]|SET_AUTOMATION|executeCommand/);
  assert.doesNotMatch(source,/boot-auto-on|BOOT_SET_AUTOMATION_PERSIST/);
  assert.match(source,/recoveryStatus:\s*startupReadiness\.recoveryStatus/);
  assert.match(source,/reconciliationStatus:\s*startupReadiness\.reconciliationStatus/);
  assert.match(source,/recoveryReason:\s*startupReadiness\.reason/);
  assert.match(source,/console\.warn\(`\[Safety\] \$\{startupReadiness\.reason\}`\)/);
  const gateway=new CommandGateway();
  assert.equal(gateway.getSnapshot().lastReconciledAt,0);
  assert.equal(gateway.getSnapshot().automationEnabled,false);
});

test('degraded lifecycle blocks direct paper BUY while preserving SELL reductions',async()=>{
  globalLifecycle.bootstrapToHealthy('startup entry-gate test setup');
  const gateway=CommandGateway.resetInstance();
  gateway.setPaperEntryEvidenceProvider(async(mint,poolAddress)=>({mint,poolAddress,priceUsd:1,liquidityUsd:1_000_000,
    observedAt:Date.now(),solPriceUsd:150,solObservedAt:Date.now(),marketObservationValid:true,source:'TEST',entryAllowed:true}));
  try {
    const buy={commandId:'startup-gate-seed-buy',type:'SUBMIT_ORDER',timestamp:Date.now(),initiator:'startup-gate-test',
      payload:{orderId:'startup-gate-seed-intent',mint:'startup-gate-mint',poolAddress:'startup-gate-pool',side:'BUY',usdAmount:25}};
    const opened=await gateway.executeCommand(buy);
    assert.equal(opened.success,true,opened.error);
    const position=gateway.getSnapshot().positions[0];assert.ok(position);
    globalLifecycle.transition('DEGRADED',PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON);
    assert.equal(globalLifecycle.isEntryPermitted(),false);assert.equal(globalLifecycle.isExitPermitted(),true);
    const blocked=await gateway.executeCommand({...buy,commandId:'startup-gate-blocked-buy',timestamp:Date.now(),
      payload:{...buy.payload,orderId:'startup-gate-blocked-intent'}});
    assert.equal(blocked.success,false);assert.match(blocked.error,/ENTRY_BLOCKED: Paper\/shadow entries require lifecycle permission/);
    assert.equal(gateway.getSnapshot().positions.length,1);
    const closed=await gateway.executeCommand({commandId:'startup-gate-sell',type:'SUBMIT_ORDER',timestamp:Date.now(),initiator:'startup-gate-test',
      payload:{orderId:'startup-gate-sell-intent',mint:position.mint,poolAddress:position.asset,side:'SELL',tokenQty:position.qty,tokenDecimals:position.tokenDecimals}});
    assert.equal(closed.success,true,closed.error);
    assert.equal(gateway.getSnapshot().positions.length,0);
  } finally {
    globalLifecycle.bootstrapToHealthy('startup entry-gate test cleanup');
    CommandGateway.resetInstance();
  }
});

test('clearing a restored stop cannot promote startup-degraded lifecycle to entry-permitted',()=>{
  const lifecycleUrl=new URL('../dist/lifecycle/system-lifecycle.js',import.meta.url).href;
  const gatewayUrl=new URL('../dist/command-gateway.js',import.meta.url).href;
  const startupUrl=new URL('../terminal/startup-readiness.mjs',import.meta.url).href;
  const child=`import assert from 'node:assert/strict';
    import {globalLifecycle} from ${JSON.stringify(lifecycleUrl)};
    import {CommandGateway} from ${JSON.stringify(gatewayUrl)};
    import {enterPaperStartupDegraded} from ${JSON.stringify(startupUrl)};
    enterPaperStartupDegraded(globalLifecycle);
    const gateway=CommandGateway.resetInstance();
    gateway.setEmergencyStopPersistence({save:async()=>{},clearSync:()=>{}});
    gateway.restoreEmergencyStop({commandId:'restored-stop',reason:'persisted stop',timestamp:1,initiator:'test'});
    assert.equal(globalLifecycle.getState(),'REDUCE_ONLY');
    const cleared=await gateway.executeCommand({commandId:'clear-restored-stop',type:'CLEAR_EMERGENCY_STOP',timestamp:2,
      initiator:'test',payload:{confirmClear:true,reason:'operator confirmed'}});
    assert.equal(cleared.success,true,cleared.error);
    assert.equal(gateway.getSnapshot().entriesHalted,false);
    assert.equal(globalLifecycle.getState(),'REDUCE_ONLY');
    assert.equal(globalLifecycle.isEntryPermitted(),false);
    assert.equal(globalLifecycle.isExitPermitted(),true);
    globalLifecycle.bootstrapToHealthy('verified normal-clear fixture');
    const healthyGateway=CommandGateway.resetInstance();
    healthyGateway.setEmergencyStopPersistence({save:async()=>{},clearSync:()=>{}});
    const stopped=await healthyGateway.executeCommand({commandId:'healthy-stop',type:'EMERGENCY_STOP',timestamp:3,
      initiator:'test',payload:{reason:'test'}});
    assert.equal(stopped.success,true,stopped.error);
    const normallyCleared=await healthyGateway.executeCommand({commandId:'healthy-clear',type:'CLEAR_EMERGENCY_STOP',timestamp:4,
      initiator:'test',payload:{confirmClear:true,reason:'operator confirmed'}});
    assert.equal(normallyCleared.success,true,normallyCleared.error);
    assert.equal(globalLifecycle.getState(),'HEALTHY');
    assert.equal(globalLifecycle.isEntryPermitted(),true);`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',child],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr||result.stdout);
});
