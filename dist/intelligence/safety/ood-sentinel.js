/**
 * SOL-SYLPH Intelligence Fabric - Unknown-Threat & Out-of-Distribution (OOD) Sentinel
 * Specifications: Major Update #11 (Sections 21-23: OOD Sentinel & Confidence Firewall).
 *
 * Epistemic States:
 * - KNOWN: Familiar market structure with validated historical analogues.
 * - KNOWN_BUT_UNCERTAIN: Recognized pattern but elevated signal variance.
 * - NOVEL: Unseen combination of participant sizes or bonding speed.
 * - OUT_OF_DISTRIBUTION: Completely outside validated training envelope.
 * - UNKNOWN: Contradictory or missing core telemetry.
 */
export class OODSentinel {
    /**
     * Evaluate market and candidate features against validated experience boundaries.
     */
    evaluateOod(params) {
        const anomalies = [];
        let noveltyScore = 0.0;
        // 1. Missing or Contradictory Data -> UNKNOWN
        if (params.hasContradictoryData) {
            anomalies.push('Core telemetry sources exhibit irreconcilable contradiction');
            return {
                epistemicState: 'UNKNOWN',
                noveltyScore: 1.0,
                allowedCapitalMultiplier: 0.0,
                requiresObservationMode: true,
                primaryAnomalies: anomalies,
            };
        }
        // 2. Macro Out-of-Distribution Check
        if (params.solVolatilityPct > 20.0 && params.launchFrequencyPerMin > 30) {
            anomalies.push(`Dual macro extreme: Volatility ${params.solVolatilityPct}%, Launches ${params.launchFrequencyPerMin}/min`);
            noveltyScore += 0.8;
        }
        else if (params.solVolatilityPct > 20.0 || params.launchFrequencyPerMin > 30) {
            anomalies.push(`Extreme macro environment: Volatility ${params.solVolatilityPct}%, Launches ${params.launchFrequencyPerMin}/min`);
            noveltyScore += 0.5;
        }
        // 3. Participant Structure Anomaly
        if (params.buyerCount > 100 && params.uniqueFundingClusters <= 2) {
            anomalies.push('Extreme Sybil clustering (>100 buyers from <= 2 ancestors)');
            noveltyScore += 0.4;
        }
        // 4. Model Disagreement Anomaly
        if (params.modelDisagreementSpread >= 0.45) {
            anomalies.push(`Severe model disagreement spread (${params.modelDisagreementSpread.toFixed(2)})`);
            noveltyScore += 0.35;
        }
        noveltyScore = Math.min(1.0, noveltyScore);
        // Derive Epistemic State
        let epistemicState = 'KNOWN';
        let allowedMultiplier = 1.0;
        let requiresObservation = false;
        if (noveltyScore >= 0.75) {
            epistemicState = 'OUT_OF_DISTRIBUTION';
            allowedMultiplier = 0.0;
            requiresObservation = true;
        }
        else if (noveltyScore >= 0.45) {
            epistemicState = 'NOVEL';
            allowedMultiplier = 0.3; // Severely restricted
        }
        else if (noveltyScore >= 0.25 || params.modelDisagreementSpread > 0.25) {
            epistemicState = 'KNOWN_BUT_UNCERTAIN';
            allowedMultiplier = 0.6;
        }
        return {
            epistemicState,
            noveltyScore: Number(noveltyScore.toFixed(3)),
            allowedCapitalMultiplier: allowedMultiplier,
            requiresObservationMode: requiresObservation,
            primaryAnomalies: anomalies,
        };
    }
}
//# sourceMappingURL=ood-sentinel.js.map