/**
 * TURING: Meta-Reasoning Orchestrator
 * Blueprint Engine #22
 *
 * Arbitrates consensus and disagreement across multiple intelligence engines:
 * Determines engine trust weights, reasons over contradictions, and controls meta-modes:
 * NORMAL | CAUTION | DEFENSIVE | EMERGENCY.
 * Invariant: "I DON'T KNOW" and "INSUFFICIENT EVIDENCE" are legitimate first-class states.
 */
export class TuringMetaReasoningEngine {
    static VERSION = '1.0.0';
    /**
     * Synthesizes multi-engine recommendations into an authoritative meta-decision.
     */
    static arbitrate(tokenMint, recommendations, uncertaintyMass) {
        if (!recommendations || recommendations.length === 0) {
            return {
                token_mint: tokenMint,
                meta_mode: 'DEFENSIVE',
                synthesized_action: 'ABSTAIN',
                consensus_level: 'DIVIDED',
                epistemic_state: 'INSUFFICIENT_EVIDENCE',
                dissenting_opinions: ['No engine recommendations provided'],
                justification: "I DON'T KNOW: Zero engine signals received. Defaulting to safe abstention.",
                evaluated_at_ms: Date.now()
            };
        }
        // High uncertainty mass (> 0.65) triggers automatic abstention
        if (uncertaintyMass > 0.65) {
            return {
                token_mint: tokenMint,
                meta_mode: 'CAUTION',
                synthesized_action: 'ABSTAIN',
                consensus_level: 'DIVIDED',
                epistemic_state: 'HIGH_UNCERTAINTY_ABSTAIN',
                dissenting_opinions: [`Composite uncertainty mass (${uncertaintyMass.toFixed(2)}) exceeds allowable ceiling.`],
                justification: "INSUFFICIENT EVIDENCE: Epistemic or aleatoric uncertainty too high to authorize capital risk.",
                evaluated_at_ms: Date.now()
            };
        }
        // Tally weighted votes
        const voteWeights = new Map();
        let totalWeight = 0;
        const actions = recommendations.map(r => r.recommended_action);
        for (const rec of recommendations) {
            const w = rec.confidence;
            voteWeights.set(rec.recommended_action, (voteWeights.get(rec.recommended_action) ?? 0) + w);
            totalWeight += w;
        }
        // Find winner
        let maxWeight = -1;
        let winningAction = 'ABSTAIN';
        for (const [act, w] of voteWeights.entries()) {
            if (w > maxWeight) {
                maxWeight = w;
                winningAction = act;
            }
        }
        // Check consensus
        const uniqueActions = new Set(actions);
        let consensus = 'MAJORITY';
        if (uniqueActions.size === 1) {
            consensus = 'UNANIMOUS';
        }
        else if (uniqueActions.has('BUY') && (uniqueActions.has('EXIT') || uniqueActions.has('ABSTAIN'))) {
            consensus = 'CONTRADICTORY';
        }
        else if (maxWeight / totalWeight < 0.55) {
            consensus = 'DIVIDED';
        }
        // Dissenting opinions
        const dissenters = recommendations
            .filter(r => r.recommended_action !== winningAction)
            .map(r => `${r.engine_name} dissents (${r.recommended_action}): ${r.rationale}`);
        // If contradictory and buy is leading without overwhelming majority, fall back to WAIT or ABSTAIN
        if (consensus === 'CONTRADICTORY' && winningAction === 'BUY' && (maxWeight / totalWeight) < 0.75) {
            winningAction = 'WAIT';
        }
        return {
            token_mint: tokenMint,
            meta_mode: consensus === 'CONTRADICTORY' ? 'CAUTION' : 'NORMAL',
            synthesized_action: winningAction,
            consensus_level: consensus,
            epistemic_state: 'KNOWN_OPPORTUNITY',
            dissenting_opinions: dissenters,
            justification: `Arbitrated ${recommendations.length} engines. Winner: ${winningAction} (${((maxWeight / totalWeight) * 100).toFixed(1)}% weight).`,
            evaluated_at_ms: Date.now()
        };
    }
}
//# sourceMappingURL=turing-orchestrator.js.map