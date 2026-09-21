import {test} from 'node:test';
import assert from 'node:assert/strict';
import {globalCommandGateway} from '../dist/command-gateway.js';
import {globalLifecycle} from '../dist/lifecycle/system-lifecycle.js';

test('simulation gateway cannot relabel itself as live execution', async () => {
  const before = globalCommandGateway.getSnapshot().mode;
  const result = await globalCommandGateway.executeCommand({commandId: 'live-capability',
    type: 'CHANGE_MODE', timestamp: Date.now(), initiator: 'test', payload: {mode: 'live'}});
  assert.equal(result.success, false);
  assert.match(result.error, /LIVE_UNAVAILABLE/);
  assert.equal(globalCommandGateway.getSnapshot().mode, before);
});

test('automation requires boolean intent and verified entry readiness', async t => {
  t.mock.method(globalLifecycle, 'isEntryPermitted', () => false);
  for (const enabled of ['false', true]) {
    const result = await globalCommandGateway.executeCommand({commandId: 'automation-capability',
      type: 'SET_AUTOMATION', timestamp: Date.now(), initiator: 'test', payload: {enabled}});
    assert.equal(result.success, false);
  }
});
