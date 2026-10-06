/**
 * Alert Center State & Incident Deduplication Manager
 * Groups repeated incidents, tracks severity, and manages operator acknowledgment.
 */

export const ALERT_SEVERITIES = {
  CRITICAL: 'critical',
  WARNING: 'warning',
  INFO: 'info',
};

export function createAlert({
  id,
  type,
  severity = ALERT_SEVERITIES.WARNING,
  title,
  message,
  action,
  timestamp = Date.now(),
}) {
  return {
    id: id || `${type}-${timestamp}`,
    type,
    severity,
    title,
    message,
    action,
    count: 1,
    firstSeen: timestamp,
    lastSeen: timestamp,
    acknowledged: false,
    acknowledgedAt: null,
  };
}

export function groupAlerts(incomingAlerts = [], currentAlerts = []) {
  const alertMap = new Map();

  // Index existing alerts by their signature/type
  for (const a of currentAlerts) {
    const key = `${a.type}:${a.title}`;
    alertMap.set(key, { ...a });
  }

  for (const inc of incomingAlerts) {
    const key = `${inc.type}:${inc.title}`;
    if (alertMap.has(key)) {
      const existing = alertMap.get(key);
      if (!existing.acknowledged) {
        // Increment repetition count and update lastSeen
        existing.count += (inc.count || 1);
        existing.lastSeen = Math.max(existing.lastSeen, inc.lastSeen || inc.timestamp || Date.now());
        existing.message = inc.message || existing.message;
        existing.action = inc.action || existing.action;
      } else {
        // If previously acknowledged and triggered anew after > 30s, reopen or spawn new incident
        const timeSinceAck = (inc.timestamp || Date.now()) - (existing.acknowledgedAt || 0);
        if (timeSinceAck > 30_000 && existing.type !== 'curve_complete') {
          existing.acknowledged = false;
          existing.acknowledgedAt = null;
          existing.count = 1;
          existing.firstSeen = inc.timestamp || Date.now();
          existing.lastSeen = inc.timestamp || Date.now();
        }
      }
    } else {
      alertMap.set(key, {
        id: inc.id || `${inc.type}-${Date.now()}`,
        type: inc.type,
        severity: inc.severity || ALERT_SEVERITIES.WARNING,
        title: inc.title,
        message: inc.message,
        action: inc.action,
        count: inc.count || 1,
        firstSeen: inc.firstSeen || inc.timestamp || Date.now(),
        lastSeen: inc.lastSeen || inc.timestamp || Date.now(),
        acknowledged: false,
        acknowledgedAt: null,
      });
    }
  }

  // Auto-resolve transient operational alerts when condition clears
  const incomingKeys = new Set(incomingAlerts.map(inc => `${inc.type}:${inc.title}`));
  for (const [key, existing] of alertMap.entries()) {
    if (!incomingKeys.has(key)) {
      if (existing.type === 'feed_stale' || existing.type === 'rpc_throttle') {
        existing.acknowledged = true;
        existing.acknowledgedAt = existing.acknowledgedAt || Date.now();
        existing.resolved = true;
      }
    }
  }

  return [...alertMap.values()].sort((a, b) => {
    // Sort critical first, then unacknowledged, then by lastSeen desc
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    const sevScore = { critical: 3, warning: 2, info: 1 };
    if (sevScore[a.severity] !== sevScore[b.severity]) return sevScore[b.severity] - sevScore[a.severity];
    return b.lastSeen - a.lastSeen;
  });
}

export function acknowledgeAlert(alertId, alertState = []) {
  return alertState.map(a => {
    if (a.id === alertId) {
      return {
        ...a,
        acknowledged: true,
        acknowledgedAt: Date.now(),
      };
    }
    return a;
  });
}

export function acknowledgeAllAlerts(alertState = []) {
  const now = Date.now();
  return alertState.map(a => ({
    ...a,
    acknowledged: true,
    acknowledgedAt: a.acknowledgedAt || now,
  }));
}

export function getUnacknowledgedCount(alertState = []) {
  return alertState.filter(a => !a.acknowledged).length;
}

export function readSoakGateEvidence(soakData) {
  // The selected session is a historical report and can remain available while
  // the engine is disconnected. It must not be presented as current gate state.
  const rpcHealth = soakData?.engineRunning === true && soakData?.liveEngine?.connected !== false
    ? soakData?.liveEngine?.rpcHealth
    : null;
  return {
    gatePassed: typeof rpcHealth?.gatePassed === 'boolean' ? rpcHealth.gatePassed : null,
    rpcDropRate: typeof rpcHealth?.rateLimitPct === 'number' && Number.isFinite(rpcHealth.rateLimitPct) && rpcHealth.rateLimitPct >= 0
      ? rpcHealth.rateLimitPct
      : null,
    rpcDropsCount: Number.isSafeInteger(rpcHealth?.failedRpcCount) && rpcHealth.failedRpcCount >= 0
      ? rpcHealth.failedRpcCount
      : null,
  };
}

export function extractSystemAlerts({
  gatePassed = null,
  rpcDropRate = null,
  rpcDropsCount = null,
  halted = false,
  haltReason = null,
  feedFresh = true,
  feedAgeMs = 0,
  creatorSell = false,
  curveComplete = false,
  blockedExits = [],
}) {
  const alerts = [];
  const gateStatus = gatePassed === true ? true : gatePassed === false ? false : null;
  const dropRateText = typeof rpcDropRate === 'number' && Number.isFinite(rpcDropRate) && rpcDropRate >= 0
    ? `${rpcDropRate.toFixed(1)}%`
    : 'Unknown';
  const dropsCountText = Number.isSafeInteger(rpcDropsCount) && rpcDropsCount >= 0
    ? String(rpcDropsCount)
    : 'Unknown';

  // 1. Quality Gate Blocked
  if (gateStatus === false) {
    alerts.push(createAlert({
      id: 'alert-gate-blocked',
      type: 'quality_gate_blocked',
      severity: ALERT_SEVERITIES.CRITICAL,
      title: 'QUALITY GATE BLOCKED — 24H SOAK PAUSED',
      message: `${dropRateText} candidate drop rate; ${dropsCountText} observed RPC-related drops.`,
      action: 'Configure dedicated/private RPC and WSS endpoints in .env, then rerun 5m smoke verification.',
    }));
  } else if (gateStatus === null) {
    alerts.push(createAlert({
      id: 'alert-gate-unverified',
      type: 'quality_gate_unverified',
      severity: ALERT_SEVERITIES.WARNING,
      title: 'QUALITY GATE UNVERIFIED — 24H SOAK NOT CLEARED',
      message: 'No explicit boolean gate result is available. Missing telemetry is not evidence that the gate passed.',
      action: 'Restore session telemetry and rerun the quality gate before treating the 24-hour soak as cleared.',
    }));
  }

  // 2. Engine Safety Halt
  if (halted) {
    alerts.push(createAlert({
      id: 'alert-engine-halted',
      type: 'engine_halted',
      severity: ALERT_SEVERITIES.CRITICAL,
      title: 'ENGINE SAFETY HALT ENGAGED',
      message: haltReason ? `Trigger: ${haltReason}` : 'Safety limit or draw-down ceiling reached. Entries suspended.',
      action: 'Safety halt cannot be cleared by resume; engine restart or session reset required.',
    }));
  }

  // 3. Creator Dump
  if (creatorSell) {
    alerts.push(createAlert({
      id: 'alert-creator-dump',
      type: 'creator_sell',
      severity: ALERT_SEVERITIES.CRITICAL,
      title: 'CREATOR / INSIDER DUMP DETECTED',
      message: 'Creator wallet disposed of concentrated supply on active bonding curve.',
      action: 'Automated entries blocked. Position trailing stop active.',
    }));
  }

  // 4. RPC Throttling
  if (typeof rpcDropRate === 'number' && Number.isFinite(rpcDropRate) && rpcDropRate >= 5 && gateStatus === true) {
    alerts.push(createAlert({
      id: 'alert-rpc-throttling',
      type: 'rpc_throttle',
      severity: ALERT_SEVERITIES.WARNING,
      title: 'CLUSTER RPC RATE LIMITING (HTTP 429)',
      message: `Snapshot requests report 429 throttling (${dropsCountText} observed drops).`,
      action: 'Switch to a private RPC endpoint or increase redundancy in .env.',
    }));
  }

  // 5. Stale Feed
  if (feedAgeMs > 5000) {
    const lagSec = (feedAgeMs / 1000).toFixed(1);
    alerts.push(createAlert({
      id: 'alert-feed-stale',
      type: 'feed_stale',
      severity: ALERT_SEVERITIES.WARNING,
      title: 'MARKET FEED STALE (>5s LAG)',
      message: `Cluster event loop lag is ${lagSec}s (threshold: 5s). Automated orders locked.`,
      action: 'Verify WebSocket cluster connection and check local network bandwidth.',
    }));
  } else if (!feedFresh && feedAgeMs > 0) {
    alerts.push(createAlert({
      id: 'alert-feed-disconnected',
      type: 'feed_stale',
      severity: ALERT_SEVERITIES.WARNING,
      title: 'MARKET FEED DISCONNECTED',
      message: 'Market observation feed disconnected from cluster. Automated orders locked.',
      action: 'Verify WebSocket cluster connection and check local network bandwidth.',
    }));
  }

  // 6. Exit Blocked By In-Flight Order
  if (blockedExits && blockedExits.length > 0) {
    const latestBlocked = blockedExits[blockedExits.length - 1];
    alerts.push(createAlert({
      id: `alert-exit-blocked-${latestBlocked.mint || 'recent'}`,
      type: 'exit_blocked',
      severity: ALERT_SEVERITIES.WARNING,
      title: 'EXIT BLOCKED BY IN-FLIGHT ORDER',
      message: `Exit on ${latestBlocked.mint?.slice(0, 8) || 'position'} blocked while awaiting pending ${latestBlocked.pendingSide || 'order'}.`,
      action: 'Order lane clearing in progress. Engine will execute exit immediately upon settlement.',
    }));
  }

  // 7. Curve Completed
  if (curveComplete) {
    alerts.push(createAlert({
      id: 'alert-curve-completed',
      type: 'curve_completed',
      severity: ALERT_SEVERITIES.INFO,
      title: 'BONDING CURVE COMPLETED / GRADUATED',
      message: 'Active asset completed Pump.fun bonding curve. AMM migration pending.',
      action: 'Entries blocked on completed curve. Trailing stop protects held units.',
    }));
  }

  return alerts;
}
