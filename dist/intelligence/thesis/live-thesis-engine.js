/**
 * SOL-SYLPH Live Thesis Engine & Assumption Graph
 * Blueprint Parts XLIV, XLV, XLVI, XLVII, XLIX, L
 *
 * Maintains machine-readable OpportunityThesis and AssumptionGraph:
 * Structural, Actor, Capital, Liquidity, Execution, and Market assumptions.
 * Evaluates thesis state: STRENGTHENING, INTACT, WEAKENING, CONTRADICTED, INVALIDATED.
 * Computes ThesisVelocity and triggers automatic revalidation.
 */
export class LiveThesisEngine {
    activeTheses = new Map();
    stateHistory = new Map();
    createInitialThesis(params) {
        const now = Date.now();
        const mint = params.mint;
        const assumptions = [
            {
                assumptionId: `asm_struct_${mint.slice(0, 6)}`,
                category: 'STRUCTURAL',
                statement: 'Token program authorities are safe and no backdoor extensions exist.',
                evidenceDependencyFields: ['freezeAuthority', 'mintAuthority', 'hasPermanentDelegate'],
                status: params.structuralValid ? 'VERIFIED' : 'FAILED',
                confidence: params.structuralValid ? 0.95 : 0.0,
            },
            {
                assumptionId: `asm_actor_${mint.slice(0, 6)}`,
                category: 'ACTOR',
                statement: 'Independent economic actors are expanding and Sybil clustering is bounded.',
                evidenceDependencyFields: ['rawWallets', 'independentActors', 'washTradingRatio'],
                status: params.actorsGrowing ? 'VERIFIED' : 'DEGRADED',
                confidence: params.actorsGrowing ? 0.85 : 0.4,
            },
            {
                assumptionId: `asm_capital_${mint.slice(0, 6)}`,
                category: 'CAPITAL',
                statement: 'Fresh capital novelty is positive and net independent inflow continues.',
                evidenceDependencyFields: ['freshCapitalRatio', 'netIndependentFlow'],
                status: params.freshCapitalPositive ? 'HOLDING' : 'DEGRADED',
                confidence: params.freshCapitalPositive ? 0.8 : 0.35,
            },
            {
                assumptionId: `asm_liq_${mint.slice(0, 6)}`,
                category: 'LIQUIDITY',
                statement: 'Executable liquidity and robust exit capacity remain sufficient for sizing.',
                evidenceDependencyFields: ['executableLiquidity', 'robustExitCapacity'],
                status: params.exitCapacitySufficient ? 'VERIFIED' : 'FAILED',
                confidence: params.exitCapacitySufficient ? 0.9 : 0.2,
            },
            {
                assumptionId: `asm_market_${mint.slice(0, 6)}`,
                category: 'MARKET',
                statement: 'Market phase is expansionary or early accumulation without severe divergence.',
                evidenceDependencyFields: ['marketPhase', 'divergenceCount'],
                status: params.phaseSupportive ? 'HOLDING' : 'DEGRADED',
                confidence: params.phaseSupportive ? 0.8 : 0.4,
            },
        ];
        const failedCount = assumptions.filter(a => a.status === 'FAILED').length;
        const degradedCount = assumptions.filter(a => a.status === 'DEGRADED').length;
        let state = 'INTACT';
        if (failedCount > 0)
            state = 'INVALIDATED';
        else if (degradedCount > 1)
            state = 'WEAKENING';
        else if (assumptions.every(a => a.status === 'VERIFIED'))
            state = 'STRENGTHENING';
        const thesis = {
            thesisId: `th_${mint.slice(0, 8)}_${now}`,
            mint,
            createdAtMs: now,
            lastEvaluatedAtMs: now,
            state,
            assumptions,
            thesisVelocity: 0.0,
            invalidationConditionsMet: failedCount > 0 ? ['FAILED_PRIMARY_ASSUMPTIONS'] : [],
            requiresAutomaticRevalidation: degradedCount > 0,
            summary: `Thesis ${state}: ${assumptions.filter(a => a.status === 'VERIFIED' || a.status === 'HOLDING').length}/${assumptions.length} assumptions verified.`,
        };
        this.activeTheses.set(mint, thesis);
        this.stateHistory.set(mint, [{ timeMs: now, score: this.calculateThesisScore(thesis) }]);
        return thesis;
    }
    reevaluateThesis(mint, currentEvidence) {
        const existing = this.activeTheses.get(mint);
        if (!existing)
            return undefined;
        const now = Date.now();
        const updatedAssumptions = existing.assumptions.map(a => {
            let status = a.status;
            let conf = a.confidence;
            if (a.category === 'STRUCTURAL') {
                if (currentEvidence.hasFreezeAuthority || currentEvidence.hasPermanentDelegate) {
                    status = 'FAILED';
                    conf = 0.0;
                }
            }
            else if (a.category === 'CAPITAL') {
                if (typeof currentEvidence.netIndependentFlowSol === 'number') {
                    if (currentEvidence.netIndependentFlowSol < -1.0) {
                        status = 'FAILED';
                        conf = 0.1;
                    }
                    else if (currentEvidence.netIndependentFlowSol > 1.0) {
                        status = 'VERIFIED';
                        conf = 0.9;
                    }
                }
            }
            else if (a.category === 'LIQUIDITY') {
                if (typeof currentEvidence.robustExitCapacitySol === 'number' && currentEvidence.robustExitCapacitySol < 0.5) {
                    status = 'FAILED';
                    conf = 0.1;
                }
            }
            return { ...a, status, confidence: conf };
        });
        const failed = updatedAssumptions.filter(a => a.status === 'FAILED');
        const degraded = updatedAssumptions.filter(a => a.status === 'DEGRADED');
        let state = 'INTACT';
        if (failed.length > 0) {
            state = 'INVALIDATED';
        }
        else if (updatedAssumptions.some(a => a.status === 'DEGRADED' && a.confidence < 0.3)) {
            state = 'CONTRADICTED';
        }
        else if (degraded.length > 1) {
            state = 'WEAKENING';
        }
        else if (updatedAssumptions.every(a => a.status === 'VERIFIED')) {
            state = 'STRENGTHENING';
        }
        // Calculate ThesisVelocity (Part XLIX)
        const score = this.calculateThesisScore({ ...existing, assumptions: updatedAssumptions });
        const hist = this.stateHistory.get(mint) ?? [];
        hist.push({ timeMs: now, score });
        if (hist.length > 10)
            hist.shift();
        this.stateHistory.set(mint, hist);
        let velocity = 0;
        if (hist.length >= 2) {
            const prev = hist[hist.length - 2];
            if (prev) {
                const dt = Math.max(0.5, (now - prev.timeMs) / 1000);
                velocity = (score - prev.score) / dt;
            }
        }
        const invalidationConditionsMet = [];
        if (failed.some(f => f.category === 'STRUCTURAL'))
            invalidationConditionsMet.push('STRUCTURAL_CERTIFICATE_FAIL');
        if (failed.some(f => f.category === 'LIQUIDITY'))
            invalidationConditionsMet.push('EXIT_CAPACITY_INSUFFICIENT');
        if (failed.some(f => f.category === 'CAPITAL'))
            invalidationConditionsMet.push('FRESH_CAPITAL_REVERSAL');
        const updated = {
            ...existing,
            lastEvaluatedAtMs: now,
            state,
            assumptions: updatedAssumptions,
            thesisVelocity: Number(velocity.toFixed(3)),
            invalidationConditionsMet,
            requiresAutomaticRevalidation: state === 'WEAKENING' || state === 'CONTRADICTED',
            summary: `Thesis ${state} (v=${velocity.toFixed(2)}): ${updatedAssumptions.filter(a => a.status === 'VERIFIED').length} verified, ${degraded.length} degraded, ${failed.length} failed.`,
        };
        this.activeTheses.set(mint, updated);
        return updated;
    }
    getThesis(mint) {
        return this.activeTheses.get(mint);
    }
    invalidateThesis(mint, reason) {
        const existing = this.activeTheses.get(mint);
        if (!existing)
            return;
        this.activeTheses.set(mint, {
            ...existing,
            lastEvaluatedAtMs: Date.now(),
            state: 'INVALIDATED',
            invalidationConditionsMet: [...existing.invalidationConditionsMet, reason],
            summary: `Thesis INVALIDATED: ${reason}`,
        });
    }
    calculateThesisScore(thesis) {
        return thesis.assumptions.reduce((acc, a) => {
            const weight = a.status === 'VERIFIED' ? 1.0 : a.status === 'HOLDING' ? 0.7 : a.status === 'DEGRADED' ? 0.3 : 0.0;
            return acc + weight * a.confidence;
        }, 0);
    }
}
//# sourceMappingURL=live-thesis-engine.js.map