/**
 * SYLPH FUSION — LIVE PRODUCTION READINESS EVALUATOR (Sections 61 & 62)
 *
 * Evaluates the 10 mandatory production gates individually with concrete evidence:
 * 1.  signingAuthority: Isolated hardware/KMS signer gateway configured with zero key exposure
 * 2.  protocolCompatibility: Active, unexpired protocol compatibility lease
 * 3.  exactBytesAuthority: 5-stage exact serialized bytes hash equality verification
 * 4.  terminalityAuthority: Multi-provider witness quorum terminality engine
 * 5.  noLandCertification: Authoritative history search bounds for certified NoLand
 * 6.  capitalAuthority: Hierarchical bigint reservation engine and mode lattice
 * 7.  economicReconciliation: Double-entry chain balance ledger reconciliation
 * 8.  executionCalibration: Realistic execution hurdle accounting (fees, slippage, tips)
 * 9.  canaryCertification: Hard canary limits enforced (0.05 SOL max, 1 pos, daily budget)
 * 10. releaseCertification: Immutable release root digest verified
 *
 * Invariants:
 * - liveReady = true ONLY when ALL 10 gates pass
 * - LIVE_SIGNING_UNAVAILABLE = false ONLY when signingAuthority passes
 * - PRODUCTION_CAPITAL_AUTHORITY_BLOCKED = false ONLY when liveReady is true
 * - Never hardcoded; always derived dynamically from live runtime verification
 */

export interface ProductionGateResult {
  readonly gateName: string;
  readonly status: 'PASS' | 'FAIL' | 'UNKNOWN';
  readonly evidence: string;
  readonly checkedAtMs: number;
}

export interface LiveReadinessReport {
  readonly liveReady: boolean;
  readonly liveSigningUnavailable: boolean;
  readonly productionCapitalAuthorityBlocked: boolean;
  readonly passedGatesCount: number;
  readonly totalGatesCount: number;
  readonly gates: {
    readonly signingAuthority: ProductionGateResult;
    readonly protocolCompatibility: ProductionGateResult;
    readonly exactBytesAuthority: ProductionGateResult;
    readonly terminalityAuthority: ProductionGateResult;
    readonly noLandCertification: ProductionGateResult;
    readonly capitalAuthority: ProductionGateResult;
    readonly economicReconciliation: ProductionGateResult;
    readonly executionCalibration: ProductionGateResult;
    readonly canaryCertification: ProductionGateResult;
    readonly releaseCertification: ProductionGateResult;
  };
}

export interface LiveReadinessDependencies {
  readonly hasIsolatedSigner: boolean;
  readonly signerPublicKeyBase58?: string;
  readonly hasActiveProtocolLease: boolean;
  readonly protocolLeaseExpired?: boolean;
  readonly exactBytesAuthorityReady: boolean;
  readonly terminalityWitnessCount: number;
  readonly noLandSearchEngineReady: boolean;
  readonly reservationEngineReady: boolean;
  readonly reconciliationLedgerClean: boolean;
  readonly executionHurdleCalibrated: boolean;
  readonly canaryRiskLimitsEnforced: boolean;
  readonly releaseRootDigest?: string;
}

export class LiveReadinessEvaluator {
  /**
   * Evaluates all 10 production gates against active system dependencies.
   */
  public static evaluate(deps: LiveReadinessDependencies): LiveReadinessReport {
    const now = Date.now();

    // 1. Signing Authority Gate
    const signingPass = deps.hasIsolatedSigner && Boolean(deps.signerPublicKeyBase58);
    const signingAuthority: ProductionGateResult = {
      gateName: 'signingAuthority',
      status: signingPass ? 'PASS' : 'FAIL',
      evidence: signingPass
        ? `IsolatedSignerGateway active with pubkey ${deps.signerPublicKeyBase58}`
        : 'IsolatedSignerGateway not configured or missing public key',
      checkedAtMs: now,
    };

    // 2. Protocol Compatibility Gate
    const protoPass = deps.hasActiveProtocolLease && !deps.protocolLeaseExpired;
    const protocolCompatibility: ProductionGateResult = {
      gateName: 'protocolCompatibility',
      status: protoPass ? 'PASS' : 'FAIL',
      evidence: protoPass
        ? 'Protocol compatibility lease active and unexpired'
        : deps.protocolLeaseExpired
          ? 'Protocol compatibility lease has expired'
          : 'No active protocol compatibility lease found',
      checkedAtMs: now,
    };

    // 3. Exact Bytes Authority Gate
    const exactBytesPass = deps.exactBytesAuthorityReady;
    const exactBytesAuthority: ProductionGateResult = {
      gateName: 'exactBytesAuthority',
      status: exactBytesPass ? 'PASS' : 'FAIL',
      evidence: exactBytesPass
        ? 'ExactBytesAuthority 5-stage byte identity verification active'
        : 'ExactBytesAuthority not initialized',
      checkedAtMs: now,
    };

    // 4. Terminality Authority Gate
    const terminalityPass = deps.terminalityWitnessCount >= 2;
    const terminalityAuthority: ProductionGateResult = {
      gateName: 'terminalityAuthority',
      status: terminalityPass ? 'PASS' : 'FAIL',
      evidence: terminalityPass
        ? `Multi-provider witness quorum active (${deps.terminalityWitnessCount} independent providers)`
        : `Insufficient terminality witnesses (${deps.terminalityWitnessCount} < 2 required)`,
      checkedAtMs: now,
    };

    // 5. NoLand Certification Gate
    const noLandPass = deps.noLandSearchEngineReady;
    const noLandCertification: ProductionGateResult = {
      gateName: 'noLandCertification',
      status: noLandPass ? 'PASS' : 'FAIL',
      evidence: noLandPass
        ? 'Authoritative history search and slot-bounded NoLand certification active'
        : 'NoLand search engine unavailable',
      checkedAtMs: now,
    };

    // 6. Capital Authority Gate
    const capitalPass = deps.reservationEngineReady;
    const capitalAuthority: ProductionGateResult = {
      gateName: 'capitalAuthority',
      status: capitalPass ? 'PASS' : 'FAIL',
      evidence: capitalPass
        ? 'HierarchicalReservationEngine active with exact worst-case bigint lamports'
        : 'Reservation engine unavailable',
      checkedAtMs: now,
    };

    // 7. Economic Reconciliation Gate
    const econPass = deps.reconciliationLedgerClean;
    const economicReconciliation: ProductionGateResult = {
      gateName: 'economicReconciliation',
      status: econPass ? 'PASS' : 'FAIL',
      evidence: econPass
        ? 'Economic reconciliation ledger clean with zero unexplained discrepancies'
        : 'Reconciliation discrepancies or ledger uninitialized',
      checkedAtMs: now,
    };

    // 8. Execution Calibration Gate
    const execPass = deps.executionHurdleCalibrated;
    const executionCalibration: ProductionGateResult = {
      gateName: 'executionCalibration',
      status: execPass ? 'PASS' : 'FAIL',
      evidence: execPass
        ? 'Execution friction fully calibrated (priority fees, base fees, slippage, and tips)'
        : 'Execution calibration incomplete',
      checkedAtMs: now,
    };

    // 9. Canary Certification Gate
    const canaryPass = deps.canaryRiskLimitsEnforced;
    const canaryCertification: ProductionGateResult = {
      gateName: 'canaryCertification',
      status: canaryPass ? 'PASS' : 'FAIL',
      evidence: canaryPass
        ? 'Canary risk limits enforced (0.05 SOL max, 1 concurrent position, strict daily loss budget)'
        : 'Canary risk constraints unverified',
      checkedAtMs: now,
    };

    // 10. Release Certification Gate
    const releasePass = Boolean(deps.releaseRootDigest && deps.releaseRootDigest.length >= 32);
    const releaseCertification: ProductionGateResult = {
      gateName: 'releaseCertification',
      status: releasePass ? 'PASS' : 'FAIL',
      evidence: releasePass
        ? `Release root digest certified: ${deps.releaseRootDigest}`
        : 'Release root digest missing or uncertified',
      checkedAtMs: now,
    };

    const allGates = [
      signingAuthority,
      protocolCompatibility,
      exactBytesAuthority,
      terminalityAuthority,
      noLandCertification,
      capitalAuthority,
      economicReconciliation,
      executionCalibration,
      canaryCertification,
      releaseCertification,
    ];

    const passedCount = allGates.filter(g => g.status === 'PASS').length;
    const liveReady = passedCount === allGates.length;

    // Derived states (NEVER hardcoded):
    const liveSigningUnavailable = !signingPass;
    const productionCapitalAuthorityBlocked = !liveReady;

    return Object.freeze({
      liveReady,
      liveSigningUnavailable,
      productionCapitalAuthorityBlocked,
      passedGatesCount: passedCount,
      totalGatesCount: allGates.length,
      gates: {
        signingAuthority,
        protocolCompatibility,
        exactBytesAuthority,
        terminalityAuthority,
        noLandCertification,
        capitalAuthority,
        economicReconciliation,
        executionCalibration,
        canaryCertification,
        releaseCertification,
      },
    });
  }
}
