// The terminal has no reconciled connection to the live wallet ledger.
// Absence of incidents in its in-memory research engines is not verification.
export function capitalEvidence(now = Date.now()) {
  return {
    evidenceStatus: 'UNAVAILABLE',
    reason: 'No reconciled live-wallet evidence is connected to this terminal.',
    authorityMode: 'OBSERVE_ONLY', capitalStatus: 'UNVERIFIED',
    survivalHealth: 'UNKNOWN', exitCoveragePct: null, stressedCoveragePct: null,
    proofsStatus: 'UNVERIFIED', proofLevel: 'UNKNOWN', revocationPriority: 'UNKNOWN',
    vaultArmed: false, chainCoherence: 'UNKNOWN',
    signingGate: {gateReady: false, reservationPass: false, stateCurrent: false,
      proofCurrent: false, controlEpoch: null, revocationEpoch: null, vaultStatus: 'LOCKED'},
    positionSurvival: {exitProofLevel: 'UNKNOWN', timeToEvacuateSec: null,
      proofAgeSec: null, partialExitTested: [], sharedBottlenecks: []},
    assuranceDeep: {capitalStateRoot: null, confirmedCapitalSol: null,
      reservedCapitalSol: null, possibleExposureSol: null, unknownCapitalSol: null,
      emergencyReserveSol: null, maxBlastRadiusSol: null, maxCompromiseLossSol: null,
      proofDebtScore: null, ledgerSeq: null, vaultJournalCount: null, activeInvariantsTripped: []},
    timestampMs: now,
  };
}

export function marketContextEvidence(strip) {
  return {sol_price_usd: null, meme_regime: 'UNKNOWN', opportunity_density: null,
    system_load: 'UNMEASURED', data_health: strip.data, execution_health: strip.execution,
    guardian_status: 'UNVERIFIED', sentinel_status: 'UNVERIFIED'};
}

export function tokenEvidence(mint, token, risk, now = Date.now()) {
  return {mint, evidenceStatus: 'PARTIAL',
    explanation: 'Market and risk observations are available below. Confirmed transaction history, independent buyer provenance, and calibrated forecasts are not connected to this inspector.',
    token: token ?? null, riskReport: risk ?? null,
    distributionProvenance: {evidenceStatus: 'UNAVAILABLE', buyerQuality: null, holderQuality: null},
    capitalRegime: {evidenceStatus: 'UNAVAILABLE', yieldQuotes: []}, timestampMs: now};
}
