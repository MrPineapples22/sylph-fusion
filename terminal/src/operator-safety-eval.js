/**
 * Operator Safety & Telemetry State Evaluator
 * Enforces strict boundaries between simulated actions and live autonomous execution,
 * and detects disconnected telemetry sources to prevent operating on stale data.
 */

export function evaluatePositionRiskAction({
  mode = 'paper',
  canExecuteClose = true,
  onPanicClose = null,
} = {}) {
  const isLive = mode === 'live';
  const showInformationalOnly = isLive || !canExecuteClose || !onPanicClose;

  return {
    isLive,
    showInformationalOnly,
    actionType: showInformationalOnly ? 'informational' : 'paper_executable',
    buttonLabel: showInformationalOnly ? null : 'Panic Close (Paper Sim)',
    infoBadgeText: 'INFORMATIONAL ONLY · AUTONOMOUS RISK EXITS ACTIVE',
    requiresConfirmation: !showInformationalOnly,
    explanation: showInformationalOnly
      ? 'No live emergency close endpoint exists here. The engine evaluates exits in software; settlement depends on on-chain execution.'
      : 'Paper simulator close: executes immediate local exit at current mark price.',
  };
}

export function evaluateTelemetryAvailability({
  isDisconnected = false,
  hasData = false,
  sourceName = 'Backend source',
} = {}) {
  if (isDisconnected) {
    return {
      available: false,
      status: 'unavailable',
      badgeText: 'TELEMETRY UNAVAILABLE',
      badgeTone: 'danger',
      message: `Telemetry unavailable — ${sourceName} disconnected`,
      detail: `Unable to fetch real-time data from ${sourceName}. Verify backend connectivity on port 8787 or select an active session.`,
      isStale: hasData,
    };
  }

  if (!hasData) {
    return {
      available: true,
      status: 'empty',
      badgeText: null,
      badgeTone: 'idle',
      message: `No active records from ${sourceName}`,
      detail: 'Monitoring cluster event stream for upcoming activity.',
      isStale: false,
    };
  }

  return {
    available: true,
    status: 'connected',
    badgeText: 'OPERATIONAL',
    badgeTone: 'good',
    message: 'Active telemetry stream',
    detail: null,
    isStale: false,
  };
}
