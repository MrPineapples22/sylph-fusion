export const PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON =
  'PAPER_ACCOUNT_RECOVERY_UNAVAILABLE: durable paper-account recovery and reconciliation are not implemented; certification was not performed. New or uncertain paper accounts remain degraded with entries disabled and protective exits available.';

/** Keep a fresh terminal fail-closed until durable paper-account recovery exists. */
export function enterPaperStartupDegraded(lifecycle) {
  if (lifecycle.getState() !== 'BOOT') {
    throw new Error('PAPER_STARTUP_GATE_REQUIRES_BOOT');
  }

  lifecycle.transition('INITIALIZING', 'Terminal startup');
  lifecycle.transition('CONNECTING', 'Market adapters starting');
  lifecycle.transition('SYNCHRONIZING', 'Feeds syncing');
  lifecycle.transition('RECONCILING', 'Paper-account recovery evidence unavailable');
  lifecycle.transition('DEGRADED', PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON);

  return Object.freeze({
    recoveryStatus: 'UNAVAILABLE',
    reconciliationStatus: 'UNAVAILABLE',
    certificationStatus: 'NOT_PERFORMED',
    reason: PAPER_ACCOUNT_RECOVERY_UNAVAILABLE_REASON,
    operationalState: lifecycle.getState(),
  });
}
