import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CommandGateway} from '../dist/command-gateway.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';

const buy = {
  commandId: 'paper-boundary-order',
  type: 'SUBMIT_ORDER',
  timestamp: Date.now(),
  initiator: 'boundary-test',
  payload: {orderId: 'paper-boundary-intent', mint: 'mint', poolAddress: 'pool', side: 'BUY', usdAmount: 25},
};

test('terminal command gateway produces paper effects without chain identity or reconciliation claims', async () => {
  globalLifecycle.bootstrapToHealthy();
  const gateway = CommandGateway.resetInstance();
  const result = await gateway.executeCommand(buy);

  assert.equal(result.success, true);
  assert.equal(result.data.executionMode, 'PAPER');
  assert.equal('permitId' in result.data, false);
  assert.equal('signature' in result.data, false);
  assert.equal('slot' in result.data, false);
  assert.equal(gateway.getSnapshot().mode, 'paper');
  assert.equal(gateway.getSnapshot().lastReconciledAt, 0);
  assert.equal(gateway.getSnapshot().positions[0].reconciliationState, 'SIMULATED');
});

test('terminal command gateway has no TPU network client or transmission path', () => {
  const gateway = CommandGateway.resetInstance();
  assert.equal('heliosClient' in gateway, false);
  assert.deepEqual(gateway.getSolarisSnapshot().helios, {
    directTransmissionsCount: 0,
    pipelinedTransmissionsCount: 0,
    fallbackTransmissionsCount: 0,
    avgTransmissionDurationMs: 0,
    activeTpuEndpointsCount: 0,
  });
});

test('terminal server rejects the live command alias before parsing or execution', async () => {
  const source = await readFile(new URL('../terminal/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /reqUrl\.pathname==='\/live\/api\/command'[\s\S]*?writeHead\(409[\s\S]*?LIVE_UNAVAILABLE/);
  assert.doesNotMatch(source, /pathname==='\/api\/command'\|\|reqUrl\.pathname==='\/live\/api\/command'/);
});
