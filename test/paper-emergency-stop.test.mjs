import {beforeEach, test} from 'node:test';
import assert from 'node:assert/strict';
import {CommandGateway} from '../dist/command-gateway.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';

const command = (commandId, type, payload) => ({
  commandId,
  type,
  timestamp: Date.now(),
  initiator: 'paper-emergency-test',
  payload,
});

const buy = (commandId = 'buy-after-stop', poolAddress = 'pool-after-stop') => command(commandId, 'SUBMIT_ORDER', {
  orderId: commandId,
  mint: `mint-${poolAddress}`,
  poolAddress,
  side: 'BUY',
  usdAmount: 25,
});

const stop = (commandId = 'emergency-stop') => command(commandId, 'EMERGENCY_STOP', {
  reason: 'adversarial test halt',
});

const authorizeTestEntry = gateway => gateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => ({
  mint,
  poolAddress,
  priceUsd: 1,
  liquidityUsd: 1_000_000,
  observedAt: Date.now(),
  solPriceUsd: 150,
  solObservedAt: Date.now(),
  verified: true,
  entryAllowed: true,
}));

const assertEntryHalted = async (gateway, commandId, poolAddress) => {
  const result = await gateway.executeCommand(buy(commandId, poolAddress));
  assert.equal(result.success, false);
  assert.match(result.error, /ENTRY_(?:BLOCKED|HALTED)/);
  assert.equal(gateway.getSnapshot().positions.length, 0);
};

beforeEach(() => {
  globalLifecycle.bootstrapToHealthy('paper emergency test reset');
});

test('repeated emergency stop is idempotent and keeps paper entries halted', async () => {
  const gateway = CommandGateway.resetInstance();

  const first = await gateway.executeCommand(stop('stop-once'));
  const firstRecord = gateway.getSnapshot().emergencyStop;
  const second = await gateway.executeCommand(stop('stop-twice'));

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(firstRecord.commandId, 'stop-once');
  assert.equal(firstRecord.reason, 'adversarial test halt');
  assert.equal(firstRecord.triggerType, 'OPERATOR_STOP');
  assert.deepEqual(gateway.getSnapshot().emergencyStop, firstRecord, 'repeated stop cannot overwrite the original cause');
  assert.equal(gateway.getSnapshot().automationEnabled, false);
  await assertEntryHalted(gateway, 'buy-after-two-stops', 'pool-after-two-stops');
});

test('an invalid lifecycle transition cannot prevent the local emergency latch', async () => {
  const gateway = CommandGateway.resetInstance();
  globalLifecycle.transition('SHUTTING_DOWN', 'simulate concurrent shutdown');

  await gateway.executeCommand(stop('stop-during-shutdown'));

  assert.equal(globalLifecycle.getState(), 'SHUTTING_DOWN');
  await assertEntryHalted(gateway, 'buy-during-shutdown', 'pool-during-shutdown');
});

test('panic close records its trigger and reason before attempting position reductions', async () => {
  const gateway = CommandGateway.resetInstance();
  const result = await gateway.executeCommand(command('panic-with-cause', 'PANIC_CLOSE_ALL', {reason: 'Operator requested account safety'}));
  assert.equal(result.success, true);
  assert.deepEqual(gateway.getSnapshot().emergencyStop, {
    commandId: 'panic-with-cause',
    initiator: 'paper-emergency-test',
    triggeredAt: gateway.getSnapshot().emergencyStop.triggeredAt,
    triggerType: 'PANIC_CLOSE_ALL',
    reason: 'Operator requested account safety',
  });
});

test('changing paper mode cannot clear an emergency halt', async () => {
  const gateway = CommandGateway.resetInstance();
  assert.equal((await gateway.executeCommand(stop('stop-before-mode-change'))).success, true);

  const changed = await gateway.executeCommand(command('change-to-shadow', 'CHANGE_MODE', {mode: 'shadow'}));

  assert.equal(changed.success, true);
  assert.equal(gateway.getSnapshot().mode, 'shadow');
  await assertEntryHalted(gateway, 'buy-after-mode-change', 'pool-after-mode-change');
});

test('a buy fill racing an emergency stop cannot commit paper exposure', async () => {
  const gateway = CommandGateway.resetInstance();
  authorizeTestEntry(gateway);
  let releaseFill;
  let executionStarted;
  const started = new Promise(resolve => { executionStarted = resolve; });
  const fill = new Promise(resolve => { releaseFill = resolve; });
  gateway.executionEngine.execute = async () => {
    executionStarted();
    return fill;
  };
  gateway.executionEngine.cancelAllBuys = () => {};

  const pendingBuy = gateway.executeCommand(buy('racing-buy', 'racing-pool'));
  await started;
  const halted = await gateway.executeCommand(stop('stop-racing-buy'));
  assert.equal(halted.success, true);

  releaseFill({
    report: {
      orderId: 'racing-buy',
      status: 'FILLED',
      execPrice: 0.00005,
      inputAmount: 166_666_667n,
      outputAmount: 1_000_000_000n,
      priorityFeeLamports: 0n,
      jitoTipLamports: 0n,
      slotLatency: 1,
    },
    telemetry: {
      engineMode: 'PAPER',
      simulatedSlotLagMs: 1,
      priceImpactPct: 0,
      preTradeReserves: {sol: 1n, token: 1n},
      postTradeReserves: {sol: 1n, token: 1n},
    },
  });

  const result = await pendingBuy;
  assert.equal(result.success, false);
  assert.match(result.error, /ENTRY_(?:BLOCKED|HALTED)|cancel/i);
  assert.equal(gateway.getSnapshot().positions.length, 0);
  assert.equal(gateway.getSnapshot().cashUsd, 10_000);
  assert.equal(gateway.getSnapshot().inFlightOrdersCount, 0);
});

test('emergency halt preserves position-reducing exits', async () => {
  const gateway = CommandGateway.resetInstance();
  gateway.setPaperEntryEvidenceProvider(async (mint, poolAddress) => ({mint, poolAddress,
    priceUsd: 1, liquidityUsd: 100_000, observedAt: Date.now(), solPriceUsd: 150,
    solObservedAt: Date.now(), verified: true, entryAllowed: false}));
  gateway.positions.set('exit-pool', {
    asset: 'exit-pool',
    mint: 'exit-mint',
    qty: 10,
    entry: 1,
    stop: 0.8,
    peak: 1,
    openedAt: Date.now(),
    costBasisUsd: 10,
    stage: 0,
    reconciliationState: 'SIMULATED',
    tokenDecimals: 9,
  });
  gateway.executionEngine.execute = async request => ({
    report: {
      orderId: request.orderId,
      status: 'FILLED',
      execPrice: 0.00005,
      inputAmount: request.amountLamports,
      outputAmount: 100_000_000n,
      priorityFeeLamports: 0n,
      jitoTipLamports: 0n,
      slotLatency: 1,
    },
    telemetry: {
      engineMode: 'PAPER', simulatedSlotLagMs: 1, priceImpactPct: 0,
      preTradeReserves: {sol: 1n, token: 1n}, postTradeReserves: {sol: 1n, token: 1n},
    },
  });

  assert.equal((await gateway.executeCommand(stop('stop-before-exit'))).success, true);
  const result = await gateway.executeCommand(command('close-after-stop', 'CLOSE_POSITION', {
    mint: 'exit-mint',
    poolAddress: 'exit-pool',
  }));

  assert.equal(result.success, true);
  assert.equal(gateway.getSnapshot().positions.length, 0);
});

test('automation cannot be enabled after an emergency halt', async () => {
  const gateway = CommandGateway.resetInstance();
  assert.equal((await gateway.executeCommand(stop('stop-before-automation'))).success, true);

  const result = await gateway.executeCommand(command('enable-after-stop', 'SET_AUTOMATION', {enabled: true}));

  assert.equal(result.success, false);
  assert.match(result.error, /ENTRY_BLOCKED:.*clear emergency stop/i);
  assert.equal(gateway.getSnapshot().automationEnabled, false);
});
