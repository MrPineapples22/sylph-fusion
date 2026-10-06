const STATUS_RANK = Object.freeze({
  NOMINAL: 0,
  DEGRADED: 1,
  RESTRICTED: 2,
  CRITICAL: 3,
});

const LIFECYCLE_STATUS = Object.freeze({
  BOOT: 'DEGRADED',
  INITIALIZING: 'DEGRADED',
  CONNECTING: 'DEGRADED',
  SYNCHRONIZING: 'DEGRADED',
  RECONCILING: 'DEGRADED',
  CERTIFYING: 'DEGRADED',
  READY: 'NOMINAL',
  HEALTHY: 'NOMINAL',
  DEGRADED: 'DEGRADED',
  OPEN_LOCKED: 'RESTRICTED',
  REDUCE_ONLY: 'RESTRICTED',
  RECOVERING: 'DEGRADED',
  SAFETY_LOCKED: 'CRITICAL',
  DISCONNECTED: 'CRITICAL',
  SHUTTING_DOWN: 'CRITICAL',
});

/** Combine subsystem health with runtime lifecycle without letting either hide the other. */
export function deriveSystemOverallStatus(providerHealthStatus, operationalState) {
  const providerStatus = typeof providerHealthStatus === 'string' && Object.hasOwn(STATUS_RANK, providerHealthStatus)
    ? providerHealthStatus
    : 'DEGRADED';
  const lifecycleStatus = typeof operationalState === 'string' && Object.hasOwn(LIFECYCLE_STATUS, operationalState)
    ? LIFECYCLE_STATUS[operationalState]
    : 'DEGRADED';
  return STATUS_RANK[providerStatus] >= STATUS_RANK[lifecycleStatus] ? providerStatus : lifecycleStatus;
}
