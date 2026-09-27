import assert from 'node:assert/strict';
import test from 'node:test';
import { OrchestraXScheduler } from '../../dist/platform/execution/orchestra-x.js';

test('ORCHESTRA-X: permits concurrent execution for non-conflicting tokens and accounts', () => {
  const scheduler = new OrchestraXScheduler();

  // Task A: Trade Token A on Curve A
  const resA = scheduler.schedule({
    taskId: 'task-a',
    mint: 'MintA111111111111111111111111111111111111111',
    lane: 'OPEN',
    writableAccounts: ['CurveA', 'UserAtaA'],
    readOnlyAccounts: ['TokenProgram', 'FeeConfig'],
  });
  assert.equal(resA.admitted, true);
  assert.equal(scheduler.getInFlightCount(), 1);

  // Task B: Trade Token B on Curve B (No shared writable accounts)
  const resB = scheduler.schedule({
    taskId: 'task-b',
    mint: 'MintB111111111111111111111111111111111111111',
    lane: 'OPEN',
    writableAccounts: ['CurveB', 'UserAtaB'],
    readOnlyAccounts: ['TokenProgram', 'FeeConfig'],
  });
  assert.equal(resB.admitted, true);
  assert.equal(scheduler.getInFlightCount(), 2);

  // Release Task A
  scheduler.release('task-a');
  assert.equal(scheduler.getInFlightCount(), 1);
  scheduler.release('task-b');
  assert.equal(scheduler.getInFlightCount(), 0);
});

test('ORCHESTRA-X: blocks candidate transactions with Faraday writable lock conflict', () => {
  const scheduler = new OrchestraXScheduler();

  // Task 1 locks SharedVault as writable
  scheduler.schedule({
    taskId: 'task-1',
    mint: 'Mint1111111111111111111111111111111111111111',
    lane: 'OPEN',
    writableAccounts: ['SharedVault', 'Ata1'],
  });

  // Task 2 also attempts to write to SharedVault
  const res2 = scheduler.schedule({
    taskId: 'task-2',
    mint: 'Mint2222222222222222222222222222222222222222',
    lane: 'INCREASE',
    writableAccounts: ['SharedVault', 'Ata2'],
  });

  assert.equal(res2.admitted, false);
  assert.match(res2.reason, /FARADAY_LOCK_CONFLICT: Account SharedVault locked by active task task-1/);
});

test('ORCHESTRA-X: EMERGENCY_CLOSE immediately preempts pending tasks and aborts signal', () => {
  const scheduler = new OrchestraXScheduler();
  const mint = 'MintEmergency111111111111111111111111111111';

  // Lower priority OPEN task in flight
  const resOpen = scheduler.schedule({
    taskId: 'task-open',
    mint,
    lane: 'OPEN',
    writableAccounts: ['CurveAcc', 'UserAta'],
  });
  assert.equal(resOpen.admitted, true);
  assert.equal(resOpen.cancelSignal.aborted, false);

  // EMERGENCY_CLOSE arrives for the same mint
  const resClose = scheduler.schedule({
    taskId: 'task-emergency-close',
    mint,
    lane: 'EMERGENCY_CLOSE',
    writableAccounts: ['CurveAcc', 'UserAta'],
  });

  assert.equal(resClose.admitted, true);
  // Lower priority task was aborted immediately!
  assert.equal(resOpen.cancelSignal.aborted, true);
  assert.match(String(resOpen.cancelSignal.reason), /Preempted by EMERGENCY_CLOSE/);
});

test('CancelTree: propagates cancellation hierarchy from TOKEN to INTENT', () => {
  const scheduler = new OrchestraXScheduler();
  const root = scheduler.getRootCancelTree();

  const tokenTree = root.createChild('TOKEN', 'MintCancelTest');
  const intent1 = tokenTree.createChild('INTENT', 'intent-1');
  const intent2 = tokenTree.createChild('INTENT', 'intent-2');

  assert.equal(intent1.isAborted, false);
  assert.equal(intent2.isAborted, false);

  // Aborting at token level cascades down to all child intents
  tokenTree.abort('Token invalidated by security sentinel');

  assert.equal(tokenTree.isAborted, true);
  assert.equal(intent1.isAborted, true);
  assert.equal(intent2.isAborted, true);
});
