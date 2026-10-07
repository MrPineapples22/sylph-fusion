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
function booleanStatus(value) {
    return value === true ? 'PASS' : value === false ? 'FAIL' : 'UNKNOWN';
}
export class LiveReadinessEvaluator {
    /**
     * Aggregates caller-supplied gate observations. Inputs are not independently
     * authenticated here; callers must only report PASS from trusted evidence.
     */
    static evaluate(deps) {
        const now = Date.now();
        // 1. Signing Authority Gate
        const signingStatus = deps.hasIsolatedSigner === false ? 'FAIL'
            : deps.hasIsolatedSigner === undefined ? 'UNKNOWN'
                : deps.signerPublicKeyBase58 ? 'PASS' : 'FAIL';
        const signingPass = signingStatus === 'PASS';
        const signingAuthority = {
            gateName: 'signingAuthority',
            status: signingStatus,
            evidence: signingPass
                ? `IsolatedSignerGateway active with pubkey ${deps.signerPublicKeyBase58}`
                : deps.hasIsolatedSigner === false
                    ? 'IsolatedSignerGateway is known to be unavailable'
                    : deps.hasIsolatedSigner === true
                        ? 'IsolatedSignerGateway is asserted but its public key is missing'
                        : 'IsolatedSignerGateway status is unknown',
            checkedAtMs: now,
        };
        // 2. Protocol Compatibility Gate
        const protoStatus = deps.hasActiveProtocolLease === true && deps.protocolLeaseExpired === false ? 'PASS'
            : deps.hasActiveProtocolLease === false || deps.protocolLeaseExpired === true ? 'FAIL'
                : 'UNKNOWN';
        const protoPass = protoStatus === 'PASS';
        const protocolCompatibility = {
            gateName: 'protocolCompatibility',
            status: protoStatus,
            evidence: protoPass
                ? 'Protocol compatibility lease active and unexpired'
                : deps.protocolLeaseExpired === true
                    ? 'Protocol compatibility lease has expired'
                    : deps.hasActiveProtocolLease === false
                        ? 'No active protocol compatibility lease found'
                        : 'Protocol compatibility lease status is unknown',
            checkedAtMs: now,
        };
        // 3. Exact Bytes Authority Gate
        const exactBytesStatus = booleanStatus(deps.exactBytesAuthorityReady);
        const exactBytesPass = exactBytesStatus === 'PASS';
        const exactBytesAuthority = {
            gateName: 'exactBytesAuthority',
            status: exactBytesStatus,
            evidence: exactBytesPass
                ? 'ExactBytesAuthority 5-stage byte identity verification active'
                : exactBytesStatus === 'FAIL' ? 'ExactBytesAuthority not initialized' : 'ExactBytesAuthority status is unknown',
            checkedAtMs: now,
        };
        // 4. Terminality Authority Gate
        const terminalityStatus = deps.terminalityWitnessCount === undefined ? 'UNKNOWN'
            : Number.isSafeInteger(deps.terminalityWitnessCount) && deps.terminalityWitnessCount >= 2 ? 'PASS' : 'FAIL';
        const terminalityPass = terminalityStatus === 'PASS';
        const terminalityAuthority = {
            gateName: 'terminalityAuthority',
            status: terminalityStatus,
            evidence: terminalityPass
                ? `Multi-provider witness quorum active (${deps.terminalityWitnessCount} independent providers)`
                : deps.terminalityWitnessCount === undefined
                    ? 'Terminality witness count is unknown'
                    : `Insufficient or invalid terminality witnesses (${deps.terminalityWitnessCount} < 2 required)`,
            checkedAtMs: now,
        };
        // 5. NoLand Certification Gate
        const noLandStatus = booleanStatus(deps.noLandSearchEngineReady);
        const noLandPass = noLandStatus === 'PASS';
        const noLandCertification = {
            gateName: 'noLandCertification',
            status: noLandStatus,
            evidence: noLandPass
                ? 'Authoritative history search and slot-bounded NoLand certification active'
                : noLandStatus === 'FAIL' ? 'NoLand search engine unavailable' : 'NoLand search engine status is unknown',
            checkedAtMs: now,
        };
        // 6. Capital Authority Gate
        const capitalStatus = booleanStatus(deps.reservationEngineReady);
        const capitalPass = capitalStatus === 'PASS';
        const capitalAuthority = {
            gateName: 'capitalAuthority',
            status: capitalStatus,
            evidence: capitalPass
                ? 'HierarchicalReservationEngine active with exact worst-case bigint lamports'
                : capitalStatus === 'FAIL' ? 'Reservation engine unavailable' : 'Reservation engine status is unknown',
            checkedAtMs: now,
        };
        // 7. Economic Reconciliation Gate
        const econStatus = booleanStatus(deps.reconciliationLedgerClean);
        const econPass = econStatus === 'PASS';
        const economicReconciliation = {
            gateName: 'economicReconciliation',
            status: econStatus,
            evidence: econPass
                ? 'Economic reconciliation ledger clean with zero unexplained discrepancies'
                : econStatus === 'FAIL' ? 'Reconciliation discrepancies or ledger uninitialized' : 'Reconciliation ledger status is unknown',
            checkedAtMs: now,
        };
        // 8. Execution Calibration Gate
        const execStatus = booleanStatus(deps.executionHurdleCalibrated);
        const execPass = execStatus === 'PASS';
        const executionCalibration = {
            gateName: 'executionCalibration',
            status: execStatus,
            evidence: execPass
                ? 'Execution friction fully calibrated (priority fees, base fees, slippage, and tips)'
                : execStatus === 'FAIL' ? 'Execution calibration incomplete' : 'Execution calibration status is unknown',
            checkedAtMs: now,
        };
        // 9. Canary Certification Gate
        const canaryStatus = booleanStatus(deps.canaryRiskLimitsEnforced);
        const canaryPass = canaryStatus === 'PASS';
        const canaryCertification = {
            gateName: 'canaryCertification',
            status: canaryStatus,
            evidence: canaryPass
                ? 'Canary risk limits enforced (0.05 SOL max, 1 concurrent position, strict daily loss budget)'
                : canaryStatus === 'FAIL' ? 'Canary risk constraints failed' : 'Canary risk constraints are unknown',
            checkedAtMs: now,
        };
        // 10. Release Certification Gate
        const releaseStatus = deps.releaseCertificateVerified === undefined ? 'UNKNOWN'
            : deps.releaseCertificateVerified === false ? 'FAIL'
                : typeof deps.releaseRootDigest === 'string' && /^[a-f0-9]{64}$/.test(deps.releaseRootDigest) ? 'PASS' : 'FAIL';
        const releasePass = releaseStatus === 'PASS';
        const releaseCertification = {
            gateName: 'releaseCertification',
            status: releaseStatus,
            evidence: releasePass
                ? `Release root digest certified: ${deps.releaseRootDigest}`
                : releaseStatus === 'UNKNOWN'
                    ? 'Release certificate verification status is unknown'
                    : 'Release certificate is unverified or its root digest is malformed',
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
        const failedCount = allGates.filter(g => g.status === 'FAIL').length;
        const unknownCount = allGates.filter(g => g.status === 'UNKNOWN').length;
        const liveReady = passedCount === allGates.length;
        // Derived states (NEVER hardcoded):
        const liveSigningUnavailable = !signingPass;
        const productionCapitalAuthorityBlocked = !liveReady;
        return Object.freeze({
            liveReady,
            liveSigningUnavailable,
            productionCapitalAuthorityBlocked,
            passedGatesCount: passedCount,
            failedGatesCount: failedCount,
            unknownGatesCount: unknownCount,
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
//# sourceMappingURL=live-readiness.js.map