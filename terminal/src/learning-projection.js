/**
 * Keep observed research P&L and policy-attributed P&L as separate measures.
 * Filtering the headline total can hide losses and misstate recorded outcomes.
 */
export function projectLearningSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Learning snapshot must be an object');
  }

  const rawPnl = Number.isFinite(snapshot.totalRealizedPnlUsd)
    ? snapshot.totalRealizedPnlUsd
    : null;
  const policyPnl = Number.isFinite(snapshot.policyRealizedPnlUsd)
    ? snapshot.policyRealizedPnlUsd
    : null;

  return {
    ...snapshot,
    totalRealizedPnlUsd: rawPnl,
    rawUnfilteredPnlUsd: rawPnl,
    policyFilteredRealizedPnlUsd: policyPnl,
  };
}
