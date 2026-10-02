/**
 * SOL-SYLPH Intelligence Fabric - Opportunity Contract & Execution Intelligence
 * Specifications: Parts XXVIII (Edge Estimator), XXIX (Edge Half-Life),
 * XXX (Adverse Selection), XXXI (Edge Verification Engine), XXXII (Edge Certificate),
 * XXXIII (Minimum Evidence Requirements), XLIV (Opportunity Contract),
 * XLV (Execution Intelligence), XLVI (Opportunity Half-Life), XLVII (Execution State Machine).
 */
export class ExecutionIntelligenceEngine {
    journal = [];
    /**
     * Computes edge half life profile across discrete latency steps
     */
    computeHalfLifeProfile(halfLifeMs) {
        const decay = (tMs) => Number(Math.exp((-Math.LN2 * tMs) / Math.max(50, halfLifeMs)).toFixed(3));
        return {
            halfLifeMs,
            decayMap: {
                '0ms': 1.0,
                '100ms': decay(100),
                '250ms': decay(250),
                '500ms': decay(500),
                '1000ms': decay(1000),
                '2000ms': decay(2000),
                '5000ms': decay(5000),
            },
        };
    }
    /**
     * Legacy certificate-shaped estimate report, not a signed or tamper-evident proof.
     * Scalar claims are retained only for call compatibility and are never evidence.
     * Promotion requires a future integration with a trusted validation authority;
     * this engine currently has no path to SUPPORTED or VERIFIED.
     */
    generateEdgeCertificate(params) {
        return {
            certificateId: `cert_${params.mint.slice(0, 8)}_${Date.now()}`,
            mint: params.mint,
            timestampMs: Date.now(),
            predictionQuality: null,
            calibrationBrier: null,
            sampleSufficiency: null,
            modelAgreementScore: null,
            historicalSimilarity: null,
            oodStatus: 'UNKNOWN',
            walkForwardStatus: 'UNKNOWN',
            purgedValidationStatus: 'UNKNOWN',
            shadowStatus: 'UNKNOWN',
            executionQualityScore: null,
            edgeHalfLifeMs: null,
            liquidityCapacitySol: null,
            dataHealthConfidence: null,
            manipulationRobustness: 'UNKNOWN',
            netExecutableEdgeBps: params.netExecutableEdgeBps,
            evidenceState: 'PROVISIONAL',
            evidenceStatus: 'MISSING',
            validationSource: null,
            authority: 'ESTIMATE_ONLY',
            reason: 'NO_TRUSTED_VALIDATION_EVIDENCE',
        };
    }
    /**
     * Computes heuristic opportunity economics, without asserting validation or authority.
     */
    evaluateOpportunity(params) {
        const { mint, positionSizeSol, targetPct, stopPct, horizonSec, pTargetFirst, pStopFirst, pNeither, expectedGrossEdgePct, poolLiquiditySol, priorityFeeLamports, jitoTipLamports, quoteAgeMs, adverseSelectionPct = 0.35, networkCongestionFactor = 1.0, oodScore = null, regime = 'UNKNOWN', } = params;
        // Non-linear price impact: impact ~= (size / (liquidity + size)) * 100
        const priceImpactPct = poolLiquiditySol > 0
            ? (positionSizeSol / (poolLiquiditySol + positionSizeSol)) * 100
            : 5.0;
        const slippagePct = Math.min(10.0, priceImpactPct * 1.5 + 0.3);
        const prioritySol = Number(priorityFeeLamports) / 1e9;
        const tipSol = Number(jitoTipLamports) / 1e9;
        const feeImpactPct = positionSizeSol > 0 ? ((prioritySol + tipSol) / positionSizeSol) * 100 : 0.5;
        // Latency decay: rapid alpha half-life in meme markets
        const opportunityHalfLifeMs = Math.max(1000, Math.min(30000, horizonSec * 100));
        const expectedLandingTimeMs = Math.round(400 * networkCongestionFactor + quoteAgeMs);
        const latencyDecayRatio = Math.min(1.0, expectedLandingTimeMs / opportunityHalfLifeMs);
        const latencyDecayPct = expectedGrossEdgePct * latencyDecayRatio * 0.4;
        const mevRiskPct = 0.5 * networkCongestionFactor;
        const failureCostPct = 0.2;
        // Expected Executable Edge calculation (Part XXVIII):
        // Net Edge = Gross Edge - Price Impact - Slippage - Fees - Adverse Selection - Latency Decay - MEV - Failure Cost
        const expectedExecutableEdgePct = expectedGrossEdgePct -
            priceImpactPct -
            slippagePct -
            feeImpactPct -
            adverseSelectionPct -
            latencyDecayPct -
            mevRiskPct -
            failureCostPct;
        const expectedShortfallPct = Math.abs(stopPct) * 1.2 + slippagePct;
        const isExpiredBeforeLanding = expectedLandingTimeMs > opportunityHalfLifeMs;
        const contractId = `opp_${mint.slice(0, 8)}_${Date.now()}`;
        const halfLifeProfile = this.computeHalfLifeProfile(opportunityHalfLifeMs);
        const netEdgeBps = Math.round(expectedExecutableEdgePct * 100);
        const certificate = this.generateEdgeCertificate({
            mint,
            netExecutableEdgeBps: netEdgeBps,
        });
        return {
            contractId,
            mint,
            entryTimeMs: Date.now(),
            positionSizeSol,
            targetPct,
            stopPct,
            horizonSec,
            executionPolicy: 'ADAPTIVE_MOMENTUM',
            pTargetFirst,
            pStopFirst,
            pExpire: pNeither,
            expectedGrossEdgePct: Number(expectedGrossEdgePct.toFixed(2)),
            priceImpactPct: Number(priceImpactPct.toFixed(2)),
            slippagePct: Number(slippagePct.toFixed(2)),
            priorityFeeSol: prioritySol,
            jitoTipSol: tipSol,
            adverseSelectionPct: Number(adverseSelectionPct.toFixed(2)),
            latencyDecayPct: Number(latencyDecayPct.toFixed(2)),
            mevExecutionRiskPct: Number(mevRiskPct.toFixed(2)),
            failureCostPct: Number(failureCostPct.toFixed(2)),
            expectedExecutableEdgePct: Number(expectedExecutableEdgePct.toFixed(2)),
            expectedShortfallPct: Number(expectedShortfallPct.toFixed(2)),
            expectedMfePct: targetPct * 1.2,
            expectedMaePct: -expectedShortfallPct,
            executionConfidence: null,
            modelConfidence: null,
            dataConfidence: null,
            opportunityHalfLifeMs,
            expectedLandingTimeMs,
            isExpiredBeforeLanding,
            halfLifeProfile,
            evidenceState: certificate.evidenceState,
            evidenceStatus: certificate.evidenceStatus,
            validationSource: certificate.validationSource,
            authority: certificate.authority,
            reason: certificate.reason,
            estimateMethod: 'OPPORTUNITY_HEURISTIC_V1',
            certificate,
            oodScore,
            regime,
        };
    }
    recordJournalEntry(entry) {
        this.journal.push(entry);
        if (this.journal.length > 500) {
            this.journal.shift();
        }
    }
    updateJournalEntry(executionId, update) {
        const entry = this.journal.find((e) => e.executionId === executionId);
        if (entry) {
            Object.assign(entry, update);
        }
        return entry;
    }
    getJournal() {
        return this.journal;
    }
}
//# sourceMappingURL=opportunity-contract.js.map