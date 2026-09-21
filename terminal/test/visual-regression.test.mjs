import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSystemAlerts, ALERT_SEVERITIES } from '../src/alert-manager.js';
import { evaluatePositionRiskAction, evaluateTelemetryAvailability } from '../src/operator-safety-eval.js';

test('Visual state regression: GATE_BLOCKED renders danger alerts and blocks 24h soak', () => {
  const alerts = extractSystemAlerts({
    gatePassed: false,
    rpcDropRate: 54.8,
    rpcDropsCount: 34,
    halted: false,
  });

  const gateAlert = alerts.find(a => a.type === 'quality_gate_blocked');
  assert.ok(gateAlert, 'Quality gate blocked alert must be emitted');
  assert.equal(gateAlert.severity, ALERT_SEVERITIES.CRITICAL);
  assert.match(gateAlert.title, /QUALITY GATE BLOCKED/);
  assert.match(gateAlert.message, /54.8% candidate drop rate/);
  assert.match(gateAlert.action, /Configure dedicated\/private RPC/);
});

test('Visual state regression: SAFETY_HALTED prevents resume and demands liquidation or restart', () => {
  const alerts = extractSystemAlerts({
    gatePassed: true,
    halted: true,
    haltReason: 'Drawdown ceiling -15% exceeded',
  });

  const haltAlert = alerts.find(a => a.type === 'engine_halted');
  assert.ok(haltAlert, 'Engine halted alert must be emitted');
  assert.equal(haltAlert.severity, ALERT_SEVERITIES.CRITICAL);
  assert.match(haltAlert.message, /Drawdown ceiling -15% exceeded/);
  assert.match(haltAlert.action, /Safety halt cannot be cleared by resume/);
});

test('Visual state regression: STALE_TELEMETRY flags feed lag and locks operations', () => {
  const alerts = extractSystemAlerts({
    gatePassed: true,
    feedFresh: false,
    feedAgeMs: 9500,
  });

  const staleAlert = alerts.find(a => a.type === 'feed_stale');
  assert.ok(staleAlert, 'Feed stale alert must be emitted');
  assert.equal(staleAlert.severity, ALERT_SEVERITIES.WARNING);
  assert.match(staleAlert.title, /MARKET FEED STALE/);
  assert.match(staleAlert.message, /9.5s/);

  // Telemetry evaluator check
  const telState = evaluateTelemetryAvailability({
    isDisconnected: true,
    hasData: true,
    sourceName: 'Cluster feed',
  });
  assert.equal(telState.available, false);
  assert.equal(telState.isStale, true);
  assert.equal(telState.badgeText, 'TELEMETRY UNAVAILABLE');
});

test('Visual state regression: PENDING_LANE and EXIT_BLOCKED capture in-flight order risk', () => {
  const alerts = extractSystemAlerts({
    gatePassed: true,
    blockedExits: [{
      mint: 'BlockedMint1111111111111111111111111111111',
      pendingSide: 'buy',
      pendingMint: 'OtherMint2222222222222222222222222222222',
      stage: 1,
    }],
  });

  const exitBlockedAlert = alerts.find(a => a.type === 'exit_blocked');
  assert.ok(exitBlockedAlert, 'Exit blocked alert must be emitted');
  assert.equal(exitBlockedAlert.severity, ALERT_SEVERITIES.WARNING);
  assert.match(exitBlockedAlert.title, /EXIT BLOCKED BY IN-FLIGHT ORDER/);
  assert.match(exitBlockedAlert.message, /BlockedM/);
});

test('Visual state regression: EMPTY_PIPELINE evaluates clean diagnostic empty state without errors', () => {
  const telState = evaluateTelemetryAvailability({
    isDisconnected: false,
    hasData: false,
    sourceName: 'Candidate pipeline',
  });

  assert.equal(telState.available, true);
  assert.equal(telState.status, 'empty');
  assert.match(telState.message, /No active records/);
  assert.equal(telState.isStale, false);
});

test('Visual state regression: INFORMATIONAL_RISK in live mode prevents executable buttons', () => {
  const riskAction = evaluatePositionRiskAction({
    mode: 'live',
    canExecuteClose: true,
    onPanicClose: () => {},
  });

  assert.equal(riskAction.showInformationalOnly, true);
  assert.equal(riskAction.actionType, 'informational');
  assert.equal(riskAction.buttonLabel, null);
  assert.match(riskAction.infoBadgeText, /INFORMATIONAL ONLY/);
  assert.match(riskAction.explanation, /No live emergency close endpoint exists/);
});
