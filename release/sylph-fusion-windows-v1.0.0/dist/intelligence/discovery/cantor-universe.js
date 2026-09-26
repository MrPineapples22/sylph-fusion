/**
 * CANTOR: Global Opportunity Search Universe Engine
 * Blueprint Engine #8
 *
 * Manages candidate universes through progressive filtering:
 * Universes: BREAKOUT | ACCUMULATION | REVIVAL | WHALE | SMART_WALLET | LIQUIDITY_EXPANSION | NOVELTY | RESEARCH | EXIT_RISK.
 * Architecture:
 * GLOBAL UNIVERSE -> CHEAP SCREENING -> STRUCTURAL SCREENING -> WALLET/INFO -> BOHR ATTENTION -> TESLA INVESTIGATION.
 * Invariant: Tokens can be resurrected when new evidence arrives.
 */
export class CantorSearchUniverseEngine {
    static VERSION = '1.0.0';
    candidates = new Map();
    registerOrUpdateCandidate(tokenMint, symbol, initialUniverses = ['NOVELTY']) {
        const existing = this.candidates.get(tokenMint);
        const wasFilteredOut = existing && existing.current_stage === 'GLOBAL' && existing.filtering_reason;
        const candidate = {
            token_mint: tokenMint,
            symbol,
            assigned_universes: Array.from(new Set([...(existing?.assigned_universes ?? []), ...initialUniverses])),
            current_stage: wasFilteredOut ? 'CHEAP_SCREEN' : (existing?.current_stage ?? 'GLOBAL'),
            score: existing?.score ?? 50,
            last_updated_ms: Date.now(),
            is_resurrected: Boolean(wasFilteredOut)
        };
        this.candidates.set(tokenMint, candidate);
        return candidate;
    }
    /**
     * Evaluates a candidate through progressive screening stages.
     */
    evaluateCandidate(tokenMint, metrics) {
        const candidate = this.candidates.get(tokenMint);
        if (!candidate) {
            throw new Error(`[CANTOR] Candidate ${tokenMint} not registered.`);
        }
        // STAGE 1: Cheap screening (Active pool and minimum non-zero reserves)
        if (!metrics.has_active_pool || metrics.liquidity_sol < 0.5) {
            const updated = {
                ...candidate,
                current_stage: 'GLOBAL',
                filtering_reason: 'Failed cheap screen: No active pool or liquidity < 0.5 SOL',
                last_updated_ms: Date.now()
            };
            this.candidates.set(tokenMint, updated);
            return updated;
        }
        // STAGE 2: Structural screening (Noether score)
        if (metrics.structural_integrity_score < 40) {
            const updated = {
                ...candidate,
                current_stage: 'CHEAP_SCREEN',
                filtering_reason: 'Failed structural screen: Noether integrity < 40',
                last_updated_ms: Date.now()
            };
            this.candidates.set(tokenMint, updated);
            return updated;
        }
        // STAGE 3: Wallet/Info Analysis
        const assigned = [...candidate.assigned_universes];
        if (metrics.whale_inflow_sol > 15)
            assigned.push('WHALE');
        if (metrics.unique_buyers_count > 30)
            assigned.push('BREAKOUT');
        let nextStage = 'STRUCTURAL_SCREEN';
        if (metrics.unique_buyers_count >= 10 || metrics.whale_inflow_sol >= 5) {
            nextStage = 'BOHR_ATTENTION';
        }
        if (metrics.unique_buyers_count >= 25 && metrics.structural_integrity_score >= 80) {
            nextStage = 'DEEP_INVESTIGATION';
        }
        const updated = {
            ...candidate,
            assigned_universes: Array.from(new Set(assigned)),
            current_stage: nextStage,
            filtering_reason: undefined,
            last_updated_ms: Date.now()
        };
        this.candidates.set(tokenMint, updated);
        return updated;
    }
    getCandidate(tokenMint) {
        return this.candidates.get(tokenMint);
    }
    getCandidatesByStage(stage) {
        return Array.from(this.candidates.values()).filter(c => c.current_stage === stage);
    }
    getTotalTracked() {
        return this.candidates.size;
    }
}
//# sourceMappingURL=cantor-universe.js.map