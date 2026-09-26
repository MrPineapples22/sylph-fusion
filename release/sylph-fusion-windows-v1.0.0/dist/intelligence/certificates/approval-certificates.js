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
        if (params.hasFreezeAuthority)
            failureReasons.push('ACTIVE_FREEZE_AUTHORITY');
        if (params.hasPermanentDelegate)
            failureReasons.push('PERMANENT_DELEGATE_BACKDOOR');
        if (params.isNonTransferable)
            failureReasons.push('NON_TRANSFERABLE_TOKEN');
        if ((params.transferFeeBps ?? 0) > 500)
            failureReasons.push(`EXCESSIVE_TRANSFER_FEE_${params.transferFeeBps}BPS`);
        if ((params.unverifiedExtensionsCount ?? 0) > 0)
            failureReasons.push('UNVERIFIED_EXTENSIONS');
        return {
            mint: params.mint,
            valid: failureReasons.length === 0,
            evaluatedAtMs: Date.now(),
            programOwner: params.programOwner ?? 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
            hasFreezeAuthority: Boolean(params.hasFreezeAuthority),
            hasMintAuthority: Boolean(params.hasMintAuthority),
            hasPermanentDelegate: Boolean(params.hasPermanentDelegate),
            isNonTransferable: Boolean(params.isNonTransferable),
            transferFeeBps: params.transferFeeBps ?? 0,
            unverifiedExtensionsCount: params.unverifiedExtensionsCount ?? 0,
            failureReasons,
        };
    }
    issueMarketCertificate(params) {
        const failureReasons = [];
        const actors = params.independentActorsCount ?? 1;
        const authScore = params.marketAuthenticityScore ?? 0.8;
        const washRatio = params.washVolumeRatio ?? 0.0;
        const conc = params.topClusterConcentrationPct ?? 15;
        if (actors < 3)
            failureReasons.push('INSUFFICIENT_INDEPENDENT_ACTORS');
        if (authScore < 0.4)
            failureReasons.push('LOW_MARKET_AUTHENTICITY');
        if (washRatio > 0.4)
            failureReasons.push('HIGH_WASH_TRADING_VOLUME');
        if (conc > 50)
            failureReasons.push('EXTREME_CLUSTER_CONCENTRATION');
        return {
            mint: params.mint,
            valid: failureReasons.length === 0,
            evaluatedAtMs: Date.now(),
            independentActorsCount: actors,
            marketAuthenticityScore: authScore,
            capitalNoveltyRatio: params.capitalNoveltyRatio ?? 0.7,
            washVolumeRatio: washRatio,
            topClusterConcentrationPct: conc,
            failureReasons,
        };
    }
    issueExecutionCertificate(params) {
        const failureReasons = [];
        const buyValid = params.buyPathValid ?? true;
        const sellValid = params.sellPathValid ?? true;
        const impact = params.roundTripImpactBps ?? 80;
        const capacity = params.robustExitCapacitySol ?? 5.0;
        const age = params.quoteAgeMs ?? 100;
        if (!buyValid)
            failureReasons.push('BUY_ROUTE_UNAVAILABLE');
        if (!sellValid)
            failureReasons.push('SELL_ROUTE_UNAVAILABLE_HONEYPOT_RISK');
        if (impact > 500)
            failureReasons.push('EXCESSIVE_ROUND_TRIP_IMPACT');
        if (capacity < 0.5)
            failureReasons.push('INSUFFICIENT_ROBUST_EXIT_CAPACITY');
        if (age > 10000)
            failureReasons.push('QUOTE_CRITICALLY_STALE');
        return {
            mint: params.mint,
            valid: failureReasons.length === 0,
            evaluatedAtMs: Date.now(),
            buyPathValid: buyValid,
            sellPathValid: sellValid,
            roundTripImpactBps: impact,
            robustExitCapacitySol: capacity,
            routeRedundancyCount: params.routeRedundancyCount ?? 1,
            quoteAgeMs: age,
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
        let proofState = '3/3';
        if (validCount === 3) {
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