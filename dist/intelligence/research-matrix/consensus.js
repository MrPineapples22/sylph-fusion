/**
 * SYLPH FUSION — MULTI-FAMILY CONSENSUS (Section 26)
 * Requires independent evidence across 10 orthogonal evidence families:
 * A. Authenticity (wash, bundler, sybil, manipulation check)
 * B. Information (Bayes error, frontier crossed, information velocity)
 * C. Reachability (P_target, R_target, C_target(q), backward reachability)
 * D. Viability (slack score, capital deficit surface CD(m), boundary distance)
 * E. Inventory (activated sell liability A(m), profit reservoir, inventory cliff)
 * F. Capital Renewal (flow reproduction R_buy > 1, R_sell < 1, independent arrivals)
 * G. Rare-Transition State (committor q_target, pathway class, QSD accumulation)
 * H. Execution (fees, price impact, slippage, route capacity, landing cost)
 * I. Exitability (exit reachability, stressed exit capacity, liquidation hypergraph)
 * J. Regime (domain shift distance, fee regime, phase transition status)
 *
 * Core Principle:
 * Do not average blindly. Use strict orthogonal vetoes:
 * - Excellent alpha + zero exitability = NO TRADE (REJECT)
 * - Excellent momentum + manipulation evidence = NO TRADE (REJECT)
 * - High reachability + insufficient information = ABSTAIN
 */
export class MultiFamilyConsensusEngine {
    /**
     * Evaluates consensus across all 10 independent families.
     */
    static evaluate(inputs) {
        const families = {
            Authenticity: inputs.authenticity,
            Information: inputs.information,
            Reachability: inputs.reachability,
            Viability: inputs.viability,
            Inventory: inputs.inventory,
            CapitalRenewal: inputs.capitalRenewal,
            RareTransition: inputs.rareTransition,
            Execution: inputs.execution,
            Exitability: inputs.exitability,
            Regime: inputs.regime,
        };
        const triggeredVetoes = [];
        const abstentionReasons = [];
        let weightedScoreSum = 0;
        let confidenceSum = 0;
        let passingCount = 0;
        // Weights reflecting risk dominance
        const weights = {
            Authenticity: 0.15,
            Information: 0.15,
            Reachability: 0.12,
            Viability: 0.12,
            Inventory: 0.10,
            CapitalRenewal: 0.08,
            RareTransition: 0.08,
            Execution: 0.08,
            Exitability: 0.08,
            Regime: 0.04,
        };
        for (const [name, fam] of Object.entries(families)) {
            if (fam.hasVeto) {
                triggeredVetoes.push(`${name}: ${fam.vetoReason ?? 'Hard veto violated'}`);
            }
            if (fam.score >= 0.55 && !fam.hasVeto) {
                passingCount++;
            }
            const w = weights[name] ?? 0.1;
            weightedScoreSum += fam.score * w;
            confidenceSum += fam.confidence * w;
        }
        // Check Information Abstention specifically
        if (inputs.information.score < 0.45 || inputs.information.hasVeto) {
            abstentionReasons.push(`INFORMATION_DEFICIT: Information family score ${inputs.information.score.toFixed(2)} insufficient for decision authority`);
        }
        if (inputs.reachability.score >= 0.65 && inputs.information.score < 0.50) {
            abstentionReasons.push('HIGH_REACHABILITY_LOW_INFORMATION: Potential runner but state cannot be statistically certified. Must ABSTAIN.');
        }
        // Determine Action:
        let decision;
        if (triggeredVetoes.length > 0) {
            // Any veto from Authenticity, Inventory, Execution, Exitability, or Regime = REJECT
            const hasHardRejectionVeto = (inputs.authenticity.hasVeto ||
                inputs.exitability.hasVeto ||
                inputs.execution.hasVeto ||
                inputs.inventory.hasVeto ||
                inputs.regime.hasVeto);
            decision = hasHardRejectionVeto ? 'REJECT' : 'ABSTAIN';
        }
        else if (abstentionReasons.length > 0 || inputs.information.score < 0.50) {
            decision = 'ABSTAIN';
        }
        else if (passingCount >= 7 && weightedScoreSum >= 0.62 && confidenceSum >= 0.58) {
            decision = 'ENTER';
        }
        else if (weightedScoreSum < 0.40) {
            decision = 'REJECT';
        }
        else {
            decision = 'ABSTAIN';
        }
        return {
            decision,
            compositeScore: weightedScoreSum,
            aggregateConfidence: confidenceSum,
            triggeredVetoes,
            abstentionReasons,
            passingFamiliesCount: passingCount,
            totalFamiliesCount: Object.keys(families).length,
            consensusDetails: families,
        };
    }
}
//# sourceMappingURL=consensus.js.map