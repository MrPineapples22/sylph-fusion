import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePositionRiskAction,
  evaluateTelemetryAvailability,
} from '../src/operator-safety-eval.js';

test('evaluatePositionRiskAction enforces informational status when live or unauthorized', () => {
  // 1. Live mode must NEVER offer executable panic close without live endpoint
  const liveAction = evaluatePositionRiskAction({
    mode: 'live',
    canExecuteClose: true,
    onPanicClose: () => {},
  });

  assert.equal(liveAction.isLive, true);
  assert.equal(liveAction.showInformationalOnly, true);
  assert.equal(liveAction.actionType, 'informational');
  assert.equal(liveAction.buttonLabel, null);
  assert.match(liveAction.infoBadgeText, /INFORMATIONAL ONLY/);
  assert.match(liveAction.explanation, /No live emergency close endpoint exists/);
  assert.equal(liveAction.requiresConfirmation, false);

  // 2. Paper mode with canExecuteClose = false
  const paperDisabled = evaluatePositionRiskAction({
    mode: 'paper',
    canExecuteClose: false,
    onPanicClose: () => {},
  });

  assert.equal(paperDisabled.showInformationalOnly, true);
  assert.equal(paperDisabled.actionType, 'informational');

  // 3. Paper mode with no onPanicClose handler
  const paperNoHandler = evaluatePositionRiskAction({
    mode: 'paper',
    canExecuteClose: true,
    onPanicClose: null,
  });

  assert.equal(paperNoHandler.showInformationalOnly, true);
  assert.equal(paperNoHandler.actionType, 'informational');
});

test('evaluatePositionRiskAction authorizes explicit paper simulation with confirmation', () => {
  const paperAction = evaluatePositionRiskAction({
    mode: 'paper',
    canExecuteClose: true,
    onPanicClose: () => {},
  });

  assert.equal(paperAction.isLive, false);
  assert.equal(paperAction.showInformationalOnly, false);
  assert.equal(paperAction.actionType, 'paper_executable');
  assert.equal(paperAction.buttonLabel, 'Panic Close (Paper Sim)');
  assert.equal(paperAction.requiresConfirmation, true);
  assert.match(paperAction.explanation, /Paper simulator close/);
});

test('evaluateTelemetryAvailability flags disconnected sources and detects stale data', () => {
  // 1. Disconnected with zero prior data
  const disconnectedEmpty = evaluateTelemetryAvailability({
    isDisconnected: true,
    hasData: false,
    sourceName: 'RPC pool',
  });

  assert.equal(disconnectedEmpty.available, false);
  assert.equal(disconnectedEmpty.status, 'unavailable');
  assert.equal(disconnectedEmpty.badgeText, 'TELEMETRY UNAVAILABLE');
  assert.equal(disconnectedEmpty.badgeTone, 'danger');
  assert.match(disconnectedEmpty.message, /RPC pool disconnected/);
  assert.equal(disconnectedEmpty.isStale, false);

  // 2. Disconnected with stale prior data (must flag stale, not present as active)
  const disconnectedStale = evaluateTelemetryAvailability({
    isDisconnected: true,
    hasData: true,
    sourceName: 'Candidate funnel',
  });

  assert.equal(disconnectedStale.available, false);
  assert.equal(disconnectedStale.isStale, true);
  assert.equal(disconnectedStale.badgeText, 'TELEMETRY UNAVAILABLE');

  // 3. Connected with empty queue (clean empty state)
  const connectedEmpty = evaluateTelemetryAvailability({
    isDisconnected: false,
    hasData: false,
    sourceName: 'Order lifecycle',
  });

  assert.equal(connectedEmpty.available, true);
  assert.equal(connectedEmpty.status, 'empty');
  assert.equal(connectedEmpty.isStale, false);

  // 4. Connected with active data
  const connectedActive = evaluateTelemetryAvailability({
    isDisconnected: false,
    hasData: true,
    sourceName: 'RPC pool',
  });

  assert.equal(connectedActive.available, true);
  assert.equal(connectedActive.status, 'connected');
  assert.equal(connectedActive.badgeText, 'OPERATIONAL');
  assert.equal(connectedActive.isStale, false);
});
