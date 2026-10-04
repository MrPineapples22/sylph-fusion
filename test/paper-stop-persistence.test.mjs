import {beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {CommandGateway} from '../dist/command-gateway.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';
import {EmergencyStopStore} from '../dist/platform/recovery/emergency-stop-store.js';

const command = (type, payload = {}, commandId = type) => ({type, payload, commandId, timestamp: Date.now(), initiator: 'persistence-test'});
const stop = () => command('EMERGENCY_STOP', {reason: 'test stop'});
const clear = () => command('CLEAR_EMERGENCY_STOP', {confirmClear: true, reason: 'test clear'});
const buy = () => command('SUBMIT_ORDER', {mint: 'mint', poolAddress: 'pool', side: 'BUY', usdAmount: 25});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
  return {promise, resolve, reject};
};
const evidence = () => ({mint: 'mint', poolAddress: 'pool', priceUsd: 1, liquidityUsd: 1_000_000,
  observedAt: Date.now(), solPriceUsd: 150, solObservedAt: Date.now(), marketObservationValid: true, source: 'TEST', entryAllowed: true});
const fill = request => ({report: {orderId: request.orderId, status: 'FILLED', execPrice: 1,
  inputAmount: request.amountLamports, outputAmount: 25_000_000n, priorityFeeLamports: 0n, jitoTipLamports: 0n, slotLatency: 1},
  telemetry: {engineMode: 'PAPER', simulatedSlotLagMs: 1, priceImpactPct: 0,
    preTradeReserves: {sol: 100n, token: 100n}, postTradeReserves: {sol: 100n, token: 100n}}});
const gatewayWith = store => {
  const gateway = CommandGateway.resetInstance();
  gateway.setEmergencyStopPersistence(store);
  return gateway;
};
beforeEach(() => globalLifecycle.bootstrapToHealthy('stop persistence test'));

test('stop immediately blocks entries while save waits, and save failure reports failure', async () => {
  const saving = deferred();
  const gateway = gatewayWith({save: () => saving.promise, clearSync: () => {}});
  const stopped = gateway.executeCommand(stop());
  assert.equal(gateway.getSnapshot().entriesHalted, true);
  assert.equal((await gateway.executeCommand(buy())).success, false);
  assert.equal((await gateway.executeCommand(command('SET_AUTOMATION', {enabled: true}))).success, false);
  saving.reject(new Error('disk full'));
  const result = await stopped;
  assert.equal(result.success, false);
  assert.equal(result.emergencyStopPersistence, 'PERSISTENCE_FAILED');
  assert.equal(gateway.getSnapshot().entriesHalted, true);
  assert.equal(gateway.getSnapshot().emergencyStop.commandId, 'EMERGENCY_STOP');
});

test('failed synchronous delete preserves the original durable and in-memory latch', async () => {
  const gateway = gatewayWith({save: async () => {}, clearSync: () => {throw new Error('EACCES');}});
  await gateway.executeCommand(stop());
  const record = gateway.getSnapshot().emergencyStop;
  const result = await gateway.executeCommand(clear());
  assert.equal(result.success, false);
  assert.equal(result.emergencyStopPersistence, 'CLEAR_FAILED');
  assert.deepEqual(gateway.getSnapshot().emergencyStop, record);
  assert.equal(gateway.getSnapshot().entriesHalted, true);
  assert.equal((await gateway.executeCommand(buy())).success, false);
});

test('successful clear performs disk commit and memory release without yielding between them', async () => {
  const events = [];
  const gateway = gatewayWith({save: async () => {}, clearSync: () => {
    assert.equal(gateway.getSnapshot().entriesHalted, true);
    events.push('delete');
    queueMicrotask(() => {events.push('next microtask'); assert.equal(gateway.getSnapshot().emergencyStop, null);});
  }});
  await gateway.executeCommand(stop());
  const result = await gateway.executeCommand(clear());
  assert.equal(result.success, true);
  assert.equal(result.emergencyStopPersistence, 'CLEARED');
  assert.equal(gateway.getSnapshot().entriesHalted, false);
  assert.equal(gateway.getSnapshot().emergencyStop, null);
  assert.deepEqual(events, ['delete', 'next microtask']);
});

test('unconfirmed clear does not invoke storage or clear the original record', async () => {
  let deletes = 0;
  const gateway = gatewayWith({save: async () => {}, clearSync: () => {deletes++;}});
  await gateway.executeCommand(stop());
  for (const confirmClear of [false, undefined, 'true', 1]) {
    assert.equal((await gateway.executeCommand(command('CLEAR_EMERGENCY_STOP', {confirmClear}))).success, false);
  }
  assert.equal(deletes, 0);
  assert.equal(gateway.getSnapshot().entriesHalted, true);
});

test('clear queues behind a pending save; a failed operation does not poison a later recovery', async () => {
  const saving = deferred();
  const events = [];
  const gateway = gatewayWith({save: async () => {events.push('save'); await saving.promise;}, clearSync: () => {events.push('clear');}});
  const stopped = gateway.executeCommand(stop());
  const clearing = gateway.executeCommand(clear());
  await Promise.resolve();
  assert.deepEqual(events, ['save']);
  assert.equal(gateway.getSnapshot().entriesHalted, true);
  saving.reject(new Error('disk full'));
  assert.equal((await stopped).success, false);
  assert.equal((await clearing).success, true);
  assert.deepEqual(events, ['save', 'clear']);
  assert.equal(gateway.getSnapshot().entriesHalted, false);
});

test('new stop before clear commit keeps the acknowledged durable latch even when its replacement save fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-stop-preempt-'));
  const path = join(directory, 'stop.json');
  const store = new EmergencyStopStore(path);
  let saves = 0, clears = 0;
  const gateway = gatewayWith({save: async record => {
    saves++;
    if (saves > 1) throw new Error('replacement save failed');
    await store.save(record);
  }, clearSync: record => {clears++; store.clearSync(record);}});
  try {
    await gateway.executeCommand(stop());
    const original = await store.load();
    const clearing = gateway.executeCommand(clear());
    const stoppedAgain = gateway.executeCommand(command('EMERGENCY_STOP', {reason: 'new stop'}, 'new-stop'));
    assert.equal((await clearing).emergencyStopPersistence, 'CLEAR_SUPERSEDED');
    assert.equal((await stoppedAgain).emergencyStopPersistence, 'PERSISTENCE_FAILED');
    assert.equal(clears, 0);
    assert.equal(gateway.getSnapshot().entriesHalted, true);
    assert.deepEqual(await new EmergencyStopStore(path).load(), original);
  } finally {await rm(path, {force: true}); await rmdir(directory);}
});

test('stop before queued clear begins prevents deletion altogether', async () => {
  const saving = deferred();
  let clears = 0;
  const gateway = gatewayWith({save: () => saving.promise, clearSync: () => {clears++;}});
  const first = gateway.executeCommand(stop());
  const clearing = gateway.executeCommand(clear());
  const second = gateway.executeCommand(stop());
  saving.resolve();
  await Promise.all([first, second]);
  assert.equal((await clearing).emergencyStopPersistence, 'CLEAR_SUPERSEDED');
  assert.equal(clears, 0);
  assert.equal(gateway.getSnapshot().entriesHalted, true);
});

test('entry waiting for evidence cannot resume after stop then successful clear', async () => {
  const observing = deferred(), started = deferred();
  const gateway = gatewayWith({save: async () => {}, clearSync: () => {}});
  gateway.setPaperEntryEvidenceProvider(async () => {started.resolve(); await observing.promise; return evidence();});
  let executions = 0;
  gateway.executionEngine.execute = async request => {executions++; return fill(request);};
  const buying = gateway.executeCommand(buy());
  await started.promise;
  await gateway.executeCommand(stop());
  await gateway.executeCommand(clear());
  observing.resolve();
  assert.equal((await buying).success, false);
  assert.equal(executions, 0);
  assert.equal(gateway.getSnapshot().positions.length, 0);
});

test('old simulated fill cannot commit after stop then successful clear', async () => {
  const filling = deferred(), started = deferred();
  const gateway = gatewayWith({save: async () => {}, clearSync: () => {}});
  gateway.setPaperEntryEvidenceProvider(async () => evidence());
  gateway.executionEngine.cancelAllBuys = () => {};
  gateway.executionEngine.execute = async request => {started.resolve(); await filling.promise; return fill(request);};
  const buying = gateway.executeCommand(buy());
  await started.promise;
  await gateway.executeCommand(stop());
  await gateway.executeCommand(clear());
  filling.resolve();
  assert.equal((await buying).success, false);
  assert.equal(gateway.getSnapshot().positions.length, 0);
  assert.equal(gateway.getSnapshot().cashUsd, 10_000);
});

test('panic continues reductions on save failure and rejects clear during reductions', async () => {
  const closing = deferred(), started = deferred();
  const gateway = gatewayWith({save: async () => {throw new Error('disk full');}, clearSync: () => {assert.fail('must not delete');}});
  gateway.positions.set('pool', {asset: 'pool', mint: 'mint', qty: 1, entry: 1, lastMark: 1, stop: 0.8,
    peak: 1, trough: 1, openedAt: Date.now(), costBasisUsd: 1, stage: 0, reconciliationState: 'SIMULATED', tokenDecimals: 9});
  gateway.setPaperEntryEvidenceProvider(async () => evidence());
  gateway.executionEngine.execute = async request => {started.resolve(); await closing.promise; return fill(request);};
  const panic = gateway.executeCommand(command('PANIC_CLOSE_ALL', {reason: 'panic test'}));
  await started.promise;
  assert.equal((await gateway.executeCommand(clear())).emergencyStopPersistence, 'CLEAR_SUPERSEDED');
  closing.resolve();
  const result = await panic;
  assert.equal(result.success, false);
  assert.equal(result.emergencyStopPersistence, 'PERSISTENCE_FAILED');
  assert.equal(result.data.closedCount, 1);
  assert.equal(gateway.getSnapshot().positions.length, 0);
  assert.equal(gateway.getSnapshot().entriesHalted, true);
});

test('successful stop and clear survive store recreation without changing the legacy record schema', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-gateway-stop-'));
  const path = join(directory, 'stop.json');
  try {
    const gateway = gatewayWith(new EmergencyStopStore(path));
    assert.equal((await gateway.executeCommand(stop())).emergencyStopPersistence, 'PERSISTED');
    const recovered = await new EmergencyStopStore(path).load();
    assert.deepEqual(recovered, gateway.getSnapshot().emergencyStop);
    const restarted = gatewayWith(new EmergencyStopStore(path));
    restarted.restoreEmergencyStop(recovered);
    assert.equal(restarted.getSnapshot().entriesHalted, true);
    assert.equal((await restarted.executeCommand(clear())).emergencyStopPersistence, 'CLEARED');
    assert.equal(await new EmergencyStopStore(path).load(), null);
  } finally {await rm(path, {force: true}); await rmdir(directory);}
});

test('storage wiring cannot be replaced after attachment or stop activity', async () => {
  const store = {save: async () => {}, clearSync: () => {}};
  const gateway = gatewayWith(store);
  assert.throws(() => gateway.setEmergencyStopPersistence(store), /ALREADY_INITIALIZED/);
  const memoryGateway = CommandGateway.resetInstance();
  await memoryGateway.executeCommand(stop());
  assert.throws(() => memoryGateway.setEmergencyStopPersistence(store), /ALREADY_INITIALIZED/);
});


test('a gateway without persistence cannot clear a restored stop or claim a persisted stop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-stop-no-port-'));
  const path = join(directory, 'stop.json');
  try {
    const first = gatewayWith(new EmergencyStopStore(path));
    await first.executeCommand(stop());
    const record = await new EmergencyStopStore(path).load();
    const restored = CommandGateway.resetInstance();
    restored.restoreEmergencyStop(record);
    const clearing = await restored.executeCommand(clear());
    assert.equal(clearing.success, false);
    assert.match(clearing.error, /NO_STORE/);
    assert.equal(restored.getSnapshot().entriesHalted, true);
    assert.deepEqual(await new EmergencyStopStore(path).load(), record);
    const fresh = CommandGateway.resetInstance();
    const stopped = await fresh.executeCommand(stop());
    assert.equal(stopped.success, false);
    assert.match(stopped.error, /NO_STORE/);
    assert.equal(fresh.getSnapshot().entriesHalted, true);
    assert.equal((await fresh.executeCommand(clear())).success, false);
  } finally {await rm(path, {force: true}); await rmdir(directory);}
});

test('duplicate clears are idempotent and never perform a second failing delete', async () => {
  let clears = 0;
  const gateway = gatewayWith({save: async () => {}, clearSync: () => {
    clears++;
    if (clears > 1) throw new Error('second delete must not happen');
  }});
  await gateway.executeCommand(stop());
  const results = await Promise.all([gateway.executeCommand(clear()), gateway.executeCommand(clear())]);
  assert.equal(results.every(result => result.success), true);
  assert.equal(clears, 1);
  assert.equal(gateway.getSnapshot().entriesHalted, false);
  assert.equal(gateway.getSnapshot().emergencyStop, null);
});

test('process death before clear commit preserves stop; after commit recovers the authorized clear', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-stop-crash-'));
  const path = join(directory, 'stop.json');
  const moduleUrl = new URL('../dist/platform/recovery/emergency-stop-store.js', import.meta.url).href;
  const gatewayModuleUrl = new URL('../dist/command-gateway.js', import.meta.url).href;
  try {
    const gateway = gatewayWith(new EmergencyStopStore(path));
    await gateway.executeCommand(stop());
    const original = await new EmergencyStopStore(path).load();
    const childCode = `import {EmergencyStopStore} from ${JSON.stringify(moduleUrl)};
      import {CommandGateway} from ${JSON.stringify(gatewayModuleUrl)};
      const store = new EmergencyStopStore(process.argv[1]);
      const record = await store.load();
      const gateway = CommandGateway.resetInstance();
      gateway.setEmergencyStopPersistence({save: value => store.save(value), clearSync: value => {
        if (process.argv[2] === 'before') process.exit(73);
        store.clearSync(value);
        process.exit(74);
      }});
      gateway.restoreEmergencyStop(record);
      await gateway.executeCommand({type: 'CLEAR_EMERGENCY_STOP', commandId: 'crash-clear',
        timestamp: Date.now(), initiator: 'test-child', payload: {confirmClear: true, reason: 'crash test'}});
      process.exit(75);`;
    const before = spawnSync(process.execPath, ['--input-type=module', '-e', childCode, path, 'before'], {encoding: 'utf8'});
    assert.equal(before.status, 73, before.stderr);
    assert.deepEqual(await new EmergencyStopStore(path).load(), original);
    const after = spawnSync(process.execPath, ['--input-type=module', '-e', childCode, path, 'after'], {encoding: 'utf8'});
    assert.equal(after.status, 74, after.stderr);
    assert.equal(await new EmergencyStopStore(path).load(), null);
  } finally {await rm(path, {force: true}); await rmdir(directory);}
});

test('clear rejects a mismatched durable stop and preserves its bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sylph-stop-conflict-'));
  const path = join(directory, 'stop.json');
  try {
    const store = new EmergencyStopStore(path);
    const gateway = gatewayWith(store);
    await gateway.executeCommand(stop());
    const record = await store.load();
    assert.throws(() => store.clearSync({...record, commandId: 'different-stop'}), /CONFLICT/);
    assert.deepEqual(await store.load(), record);
  } finally {await rm(path, {force: true}); await rmdir(directory);}
});
