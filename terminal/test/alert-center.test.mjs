import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlert,
  groupAlerts,
  acknowledgeAlert,
  acknowledgeAllAlerts,
  getUnacknowledgedCount,
  extractSystemAlerts,
  readSoakGateEvidence,
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

test('missing or malformed gate telemetry stays unverified instead of becoming a pass or measured zero', () => {
  for (const gatePassed of [undefined, null, 'true', 0]) {
    const alerts = extractSystemAlerts({ gatePassed });
    const gateAlert = alerts.find(alert => alert.type.startsWith('quality_gate_'));
    assert.equal(gateAlert?.type, 'quality_gate_unverified');
    assert.match(gateAlert.message, /Missing telemetry is not evidence/);
    assert.doesNotMatch(gateAlert.message, /0\.0%|0 observed/);
  }
  const explicitPass = extractSystemAlerts({ gatePassed: true });
  assert.equal(explicitPass.some(alert => alert.type.startsWith('quality_gate_')), false);
  const measuredFailure = extractSystemAlerts({ gatePassed: false, rpcDropRate: 2.5, rpcDropsCount: 4 });
  const blocked = measuredFailure.find(alert => alert.type === 'quality_gate_blocked');
  assert.match(blocked.message, /2\.5%/);
  assert.match(blocked.message, /4 observed/);
  const unknownFailureMetrics = extractSystemAlerts({ gatePassed: false })
    .find(alert => alert.type === 'quality_gate_blocked');
  assert.match(unknownFailureMetrics.message, /Unknown candidate drop rate; Unknown observed RPC-related drops/);
});

test('soak gate extraction preserves only explicit boolean and valid numeric evidence', () => {
  assert.deepEqual(readSoakGateEvidence(null), {gatePassed:null,rpcDropRate:null,rpcDropsCount:null});
  assert.deepEqual(readSoakGateEvidence({session:{rpcHealth:{}}}), {gatePassed:null,rpcDropRate:null,rpcDropsCount:null});
  assert.deepEqual(readSoakGateEvidence({engineRunning:false,session:{rpcHealth:{gatePassed:true,rateLimitPct:0,failedRpcCount:0}}}),
    {gatePassed:null,rpcDropRate:null,rpcDropsCount:null});
  assert.deepEqual(readSoakGateEvidence({engineRunning:true,liveEngine:{connected:false,rpcHealth:{gatePassed:true,rateLimitPct:0,failedRpcCount:0}}}),
    {gatePassed:null,rpcDropRate:null,rpcDropsCount:null});
  assert.deepEqual(readSoakGateEvidence({engineRunning:true,liveEngine:{rpcHealth:{gatePassed:true,rateLimitPct:0,failedRpcCount:0}}}),
    {gatePassed:true,rpcDropRate:0,rpcDropsCount:0});
  for (const bad of ['0',-1,Infinity,NaN]) {
    assert.deepEqual(readSoakGateEvidence({engineRunning:true,liveEngine:{rpcHealth:{gatePassed:'true',rateLimitPct:bad,failedRpcCount:bad}}}),
      {gatePassed:null,rpcDropRate:null,rpcDropsCount:null});
  }
});
