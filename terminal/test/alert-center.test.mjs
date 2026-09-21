import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlert,
  groupAlerts,
  acknowledgeAlert,
  acknowledgeAllAlerts,
  getUnacknowledgedCount,
  extractSystemAlerts,
  ALERT_SEVERITIES,
} from '../src/alert-manager.js';

test('createAlert initializes an unacknowledged incident with default count 1', () => {
  const alert = createAlert({
    id: 'test-1',
    type: 'rpc_throttle',
    severity: ALERT_SEVERITIES.WARNING,
    title: 'RPC 429 Throttle',
    message: 'Too many requests',
    action: 'Switch endpoints',
  });

  assert.equal(alert.id, 'test-1');
  assert.equal(alert.type, 'rpc_throttle');
  assert.equal(alert.severity, 'warning');
  assert.equal(alert.count, 1);
  assert.equal(alert.acknowledged, false);
  assert.equal(alert.acknowledgedAt, null);
});

test('groupAlerts deduplicates repeated occurrences and increments count', () => {
  const incoming = [
    createAlert({ type: 'rpc_throttle', title: 'RPC Rate Limit' }),
    createAlert({ type: 'rpc_throttle', title: 'RPC Rate Limit' }),
    createAlert({ type: 'feed_stale', title: 'Feed Lag' }),
  ];

  const grouped = groupAlerts(incoming, []);
  assert.equal(grouped.length, 2);

  const throttle = grouped.find(a => a.type === 'rpc_throttle');
  assert.equal(throttle.count, 2);

  const feed = grouped.find(a => a.type === 'feed_stale');
  assert.equal(feed.count, 1);
});

test('acknowledgeAlert marks an incident acknowledged without deleting it from state', () => {
  const alert = createAlert({ id: 'alert-1', type: 'engine_halted', title: 'Halt' });
  const state = [alert];

  const updated = acknowledgeAlert('alert-1', state);
  assert.equal(updated[0].acknowledged, true);
  assert.ok(updated[0].acknowledgedAt > 0);
  assert.equal(getUnacknowledgedCount(updated), 0);
});

test('acknowledgeAllAlerts marks all active incidents as acknowledged', () => {
  const state = [
    createAlert({ id: 'a1', type: 'rpc_throttle', title: 'RPC 1' }),
    createAlert({ id: 'a2', type: 'feed_stale', title: 'Feed 1' }),
  ];

  assert.equal(getUnacknowledgedCount(state), 2);
  const updated = acknowledgeAllAlerts(state);
  assert.equal(getUnacknowledgedCount(updated), 0);
  assert.ok(updated.every(a => a.acknowledged === true));
});

test('extractSystemAlerts maps engine state to correct alert severities', () => {
  const alerts = extractSystemAlerts({
    gatePassed: false,
    rpcDropRate: 54.8,
    rpcDropsCount: 34,
    halted: true,
    haltReason: 'drawdown ceiling',
    feedFresh: false,
    feedAgeMs: 8000,
    creatorSell: true,
    curveComplete: true,
    blockedExits: [{ mint: 'Mint111', pendingSide: 'buy' }],
  });

  // Verify critical alerts
  const gateBlocked = alerts.find(a => a.type === 'quality_gate_blocked');
  assert.ok(gateBlocked);
  assert.equal(gateBlocked.severity, ALERT_SEVERITIES.CRITICAL);

  const engineHalt = alerts.find(a => a.type === 'engine_halted');
  assert.ok(engineHalt);
  assert.equal(engineHalt.severity, ALERT_SEVERITIES.CRITICAL);

  const creatorDump = alerts.find(a => a.type === 'creator_sell');
  assert.ok(creatorDump);
  assert.equal(creatorDump.severity, ALERT_SEVERITIES.CRITICAL);

  // Verify warnings
  const feedStale = alerts.find(a => a.type === 'feed_stale');
  assert.ok(feedStale);
  assert.equal(feedStale.severity, ALERT_SEVERITIES.WARNING);

  const exitBlocked = alerts.find(a => a.type === 'exit_blocked');
  assert.ok(exitBlocked);
  assert.equal(exitBlocked.severity, ALERT_SEVERITIES.WARNING);

  // Verify info
  const curveComp = alerts.find(a => a.type === 'curve_completed');
  assert.ok(curveComp);
  assert.equal(curveComp.severity, ALERT_SEVERITIES.INFO);
});
