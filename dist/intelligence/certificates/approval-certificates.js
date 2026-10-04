/**
 * SOL-SYLPH Three Independent Approval Certificates
 * Blueprint Parts XXXII, LXXIX
 *
 * Maintains independent certificates:
 * 1. StructuralCertificate
 * 2. MarketCertificate
 * 3. ExecutionCertificate
 *
 * Only when all policy requirements are satisfied can the candidate reach 3/3 Proof state.
 * Never hide partial failures behind one average score!
 */
export class ApprovalCertificateEngine {
    issueStructuralCertificate(params) {
        const failureReasons = [];
        // Invariant 1: Missing evidence must never become favorable evidence
        if (params.hasFreezeAuthority === undefined)
            failureReasons.push('UNKNOWN_FREEZE_AUTHORITY');
        else if (params.hasFreezeAuthority)
            failureReasons.push('ACTIVE_FREEZE_AUTHORITY');
        if (params.hasPermanentDelegate === undefined)
            failureReasons.push('UNKNOWN_PERMANENT_DELEGATE');
        else if (params.hasPermanentDelegate)
            failureReasons.push('PERMANENT_DELEGATE_BACKDOOR');
        if (params.isNonTransferable === undefined)
            failureReasons.push('UNKNOWN_TRANSFERABILITY');
        else if (params.isNonTransferable)
            failureReasons.push('NON_TRANSFERABLE_TOKEN');
        const fee = params.transferFeeBps ?? 0;
        if (fee > 500)
            failureReasons.push(`EXCESSIVE_TRANSFER_FEE_${fee}BPS`);
        const unverifiedExt = params.unverifiedExtensionsCount ?? 0;
        if (unverifiedExt > 0)
            failureReasons.push('UNVERIFIED_EXTENSIONS');
        const hasUnknown = failureReasons.some(r => r.startsWith('UNKNOWN_'));
        const evidenceState = hasUnknown
            ? 'UNKNOWN'
            : failureReasons.length === 0
                ? 'PROVEN_TRUE'
                : 'PROVEN_FALSE';
        return {
            mint: params.mint,
            valid: failureReasons.length === 0,
            evidenceState,
            evaluatedAtMs: Date.now(),
            programOwner: params.programOwner ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            hasFreezeAuthority: Boolean(params.hasFreezeAuthority),
            hasMintAuthority: Boolean(params.hasMintAuthority),
            hasPermanentDelegate: Boolean(params.hasPermanentDelegate),
            isNonTransferable: Boolean(params.isNonTransferable),
            transferFeeBps: fee,
            unverifiedExtensionsCount: unverifiedExt,
            failureReasons,
        };
    }
    issueMarketCertificate(params) {
        const failureReasons = [];
        // Invariant 1 & Section XI: No favorable defaults (never washRatio ?? 0 or actors ?? 1)
        if (params.independentActorsCount === undefined) {
            failureReasons.push('INSUFFICIENT_EVIDENCE_INDEPENDENT_ACTORS');
        }
        else if (params.independentActorsCount < 3) {
            failureReasons.push('INSUFFICIENT_INDEPENDENT_ACTORS');
        }
        if (params.marketAuthenticityScore === undefined) {
            failureReasons.push('INSUFFICIENT_EVIDENCE_MARKET_AUTHENTICITY');
        }
        else if (params.marketAuthenticityScore < 0.4) {
            failureReasons.push('LOW_MARKET_AUTHENTICITY');
        }
        if (params.washVolumeRatio === undefined) {
            failureReasons.push('INSUFFICIENT_EVIDENCE_WASH_VOLUME');
        }
        else if (params.washVolumeRatio > 0.4) {
            failureReasons.push('HIGH_WASH_TRADING_VOLUME');
        }
        if (params.topClusterConcentrationPct === undefined) {
            failureReasons.push('INSUFFICIENT_EVIDENCE_CLUSTER_CONCENTRATION');
        }
        else if (params.topClusterConcentrationPct > 50) {
            failureReasons.push('EXTREME_CLUSTER_CONCENTRATION');
        }
        const hasMissing = failureReasons.some(r => r.startsWith('INSUFFICIENT_EVIDENCE_'));
        const evidenceState = hasMissing
            ? 'INSUFFICIENT_EVIDENCE'
            : failureReasons.length === 0
                ? 'PROVEN_TRUE'
                : 'PROVEN_FALSE';
        return {
            mint: params.mint,
            valid: failureReasons.length === 0,
            evidenceState,
            evaluatedAtMs: Date.now(),
            independentActorsCount: params.independentActorsCount ?? null,
            marketAuthenticityScore: params.marketAuthenticityScore ?? null,
            capitalNoveltyRatio: params.capitalNoveltyRatio ?? null,
            washVolumeRatio: params.washVolumeRatio ?? null,
            topClusterConcentrationPct: params.topClusterConcentrationPct ?? null,
            failureReasons,
        };
    }
    issueExecutionCertificate(params) {
        const failureReasons = [];
        // Invariant 1 & Section XI: Never default buyPathValid ?? true or sellPathValid ?? true
        if (params.buyPathValid === undefined) {
            failureReasons.push('BUY_ROUTE_UNKNOWN');
        }
        else if (!params.buyPathValid) {
            failureReasons.push('BUY_ROUTE_UNAVAILABLE');
        }
        if (params.sellPathValid === undefined) {
            failureReasons.push('SELL_ROUTE_UNKNOWN_HONEYPOT_RISK');
        }
        else if (!params.sellPathValid) {
            failureReasons.push('SELL_ROUTE_UNAVAILABLE_HONEYPOT_RISK');
        }
        if (params.roundTripImpactBps === undefined) {
            failureReasons.push('ROUND_TRIP_IMPACT_UNKNOWN');
        }
        else if (params.roundTripImpactBps > 500) {
            failureReasons.push('EXCESSIVE_ROUND_TRIP_IMPACT');
        }
        if (params.robustExitCapacitySol === undefined) {
            failureReasons.push('ROBUST_EXIT_CAPACITY_UNKNOWN');
        }
        else if (params.robustExitCapacitySol < 0.5) {
            failureReasons.push('INSUFFICIENT_ROBUST_EXIT_CAPACITY');
        }
        if (params.quoteAgeMs === undefined) {
            failureReasons.push('QUOTE_AGE_UNKNOWN');
        }
        else if (params.quoteAgeMs > 10000) {
            failureReasons.push('QUOTE_CRITICALLY_STALE');
        }
        const hasUnknown = failureReasons.some(r => r.includes('_UNKNOWN'));
        const evidenceState = hasUnknown
            ? 'UNKNOWN'
            : failureReasons.length === 0
                ? 'PROVEN_TRUE'
                : 'PROVEN_FALSE';
        return {
            mint: params.mint,
            valid: failureReasons.length === 0,
            evidenceState,
            evaluatedAtMs: Date.now(),
            buyPathValid: params.buyPathValid ?? null,
            sellPathValid: params.sellPathValid ?? null,
            roundTripImpactBps: params.roundTripImpactBps ?? null,
            robustExitCapacitySol: params.robustExitCapacitySol ?? null,
            routeRedundancyCount: params.routeRedundancyCount ?? null,
            quoteAgeMs: params.quoteAgeMs ?? null,
            failureReasons,
        };
    }
    evaluateProof(structural, market, execution) {
        let validCount = 0;
        if (structural.valid)
            validCount++;
        if (market.valid)
            validCount++;
        if (execution.valid)
            validCount++;
        const anyUnknown = structural.evidenceState === 'UNKNOWN' ||
            market.evidenceState === 'UNKNOWN' ||
            market.evidenceState === 'INSUFFICIENT_EVIDENCE' ||
            execution.evidenceState === 'UNKNOWN';
        let proofState = 'FAIL';
        if (anyUnknown) {
            // Missing mandatory evidence prevents 3/3 approval (Section XI)
            proofState = 'UNKNOWN';
        }
        else if (validCount === 3) {
            proofState = '3/3';
        }
        else if (validCount === 2) {
            proofState = '2/3';
        }
        else if (validCount === 1) {
            proofState = 'REVIEW';
        }
        else {
            proofState = 'FAIL';
        }
        const mint = structural.mint;
        const isExecutionReady = proofState === '3/3';
        let summary = `Proof State ${proofState}: `;
        if (proofState === '3/3') {
            summary += 'All 3 certificates validated (Structural + Market + Execution).';
        }
        else if (proofState === 'UNKNOWN') {
            summary += 'Approval blocked due to missing/unobserved mandatory evidence.';
        }
        else {
            const fails = [];
            if (!structural.valid)
                fails.push(`Structural: ${structural.failureReasons.join(', ')}`);
            if (!market.valid)
                fails.push(`Market: ${market.failureReasons.join(', ')}`);
            if (!execution.valid)
                fails.push(`Execution: ${execution.failureReasons.join(', ')}`);
            summary += fails.join(' | ');
        }
        return {
            mint,
            proofState,
            validCertificatesCount: validCount,
            totalCertificatesCount: 3,
            structural,
            market,
            execution,
            isExecutionReady,
            summary,
        };
    }
}
//# sourceMappingURL=approval-certificates.js.map