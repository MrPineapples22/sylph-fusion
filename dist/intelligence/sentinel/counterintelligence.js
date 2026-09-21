/**
 * SOL-SYLPH Master Implementation Blueprint - SENTINEL-X
 * Market Counterintelligence & Adversarial Adaptation
 * Specifications: Parts 46-51.
 */
export class SentinelXCounterintelligence {
    saturationHistory = new Map();
    /**
     * Part 47: Effective Participation
     * Disambiguates raw wallet counts into truly independent economic actors.
     */
    evaluateParticipation(mint, rawWallets) {
        const rawCount = rawWallets.length;
        if (rawCount === 0) {
            return {
                mint,
                raw_wallet_count: 0,
                effective_independent_participants: 0,
                participant_diversity_ratio: 0,
                signal_saturation: 'RARE',
                competing_hypotheses: {
                    primary_hypothesis: 'DATA_ARTIFACT',
                    confidence_pct: 90,
                    competing_alternatives: [],
                },
                red_team_risk_score: 0,
                timestamp_ms: Date.now(),
            };
        }
        // Cluster by shared funding tree
        const funderClusters = new Map();
        for (const w of rawWallets) {
            const funder = w.funder || 'independent_unlinked';
            const list = funderClusters.get(funder) || [];
            list.push(w.address);
            funderClusters.set(funder, list);
        }
        // Effective participant estimate: count of unique funding roots + independent wallets
        let effectiveCount = 0;
        for (const [funder, addrs] of funderClusters.entries()) {
            if (funder === 'independent_unlinked') {
                effectiveCount += addrs.length;
            }
            else {
                // Shared funder cluster counts as 1.0 effective actor regardless of wallet split
                effectiveCount += 1.0;
            }
        }
        const diversityRatio = Math.max(0.05, Math.min(1.0, effectiveCount / Math.max(1, rawCount)));
        // Part 49: Signal Saturation Detection
        let saturation = 'EMERGING';
        if (rawCount > 100 && diversityRatio < 0.25) {
            saturation = 'COMPROMISED'; // Heavy Sybil spoofing
        }
        else if (rawCount > 80 && diversityRatio < 0.4) {
            saturation = 'SATURATED';
        }
        else if (rawCount > 50) {
            saturation = 'CROWDED';
        }
        else if (rawCount > 20) {
            saturation = 'KNOWN';
        }
        else if (rawCount > 5) {
            saturation = 'EMERGING';
        }
        else {
            saturation = 'RARE';
        }
        // Part 50: Competing Explanations
        let primaryHypothesis = 'ORGANIC_DEMAND';
        let primaryConfidence = 65;
        const alternatives = [];
        if (diversityRatio < 0.3) {
            primaryHypothesis = 'COORDINATED_MANIPULATION';
            primaryConfidence = 78;
            alternatives.push({
                explanation: 'Bot market-making adaptation',
                probability: 0.15,
                supporting_evidence: 'High frequency of small uniform orders',
            });
            alternatives.push({
                explanation: 'Organic enthusiast group buying simultaneously',
                probability: 0.07,
                supporting_evidence: 'External social call co-occurrence',
            });
        }
        else if (saturation === 'CROWDED') {
            primaryHypothesis = 'STRATEGY_CROWDING';
            primaryConfidence = 70;
            alternatives.push({
                explanation: 'Broad retail viral discovery',
                probability: 0.3,
                supporting_evidence: 'Diverse funding sources and dispersed timing',
            });
        }
        else {
            alternatives.push({
                explanation: 'Pre-planned insider sniper cluster',
                probability: 0.15,
                supporting_evidence: 'Early block co-entry',
            });
        }
        // Red-team bait score: high if high volume but extremely low diversity
        const redTeamRisk = diversityRatio <= 0.25 ? 0.85 : diversityRatio < 0.4 ? 0.45 : 0.1;
        return {
            mint,
            raw_wallet_count: rawCount,
            effective_independent_participants: Number(effectiveCount.toFixed(1)),
            participant_diversity_ratio: Number(diversityRatio.toFixed(3)),
            signal_saturation: saturation,
            competing_hypotheses: {
                primary_hypothesis: primaryHypothesis,
                confidence_pct: primaryConfidence,
                competing_alternatives: alternatives,
            },
            red_team_risk_score: Number(redTeamRisk.toFixed(2)),
            timestamp_ms: Date.now(),
        };
    }
    /**
     * Part 51: Red-Team Simulation Generator (Research Only)
     * Strictly barred from entering canonical truth; tests candidate filters against synthetic traps
     */
    generateSyntheticAdversarialTrap(mint, trapType) {
        return {
            synthetic_mint: `synthetic_${mint.slice(0, 6)}`,
            trap_type: trapType,
            simulated_wallets: 25,
            apparent_volume_sol: 150.0,
            true_effective_actors: 1, // All funded from 1 master wallet
            detection_target: 'Must be flagged as COORDINATED_MANIPULATION with diversity < 0.1',
        };
    }
}
//# sourceMappingURL=counterintelligence.js.map