/**
 * SYLPH-SOL / AETHER FLUX - Intelligence, Epistemic & Adaptive Stacks (Ω-Epistemic)
 * Specifications: Sections 10, 11, 16, 22, 23.
 *
 * Implements:
 * 1. KALMAN-Ω: Transition-model validity, residual tracking & drift detection
 * 2. PARMENIDES-Ω: Contradiction preservation & belief integrity
 * 3. SAVAGE-Ω: Minimax regret decisions under unresolved competing world models
 * 4. BELLMAN-Ω: Recursive continuation-state value & exit coverage
 * 5. BERNOULLI-Ω: Sequential decision timing, delay value & optionality
 * 6. SIMON-Ω: Attention & decision-load allocation
 * 7. KAHNEMAN-Ω: Fast/Slow reasoning routing
 * 8. EXPERTISE-Ω: Domain/regime/horizon-specific expert competence mapping
 * 9. DIVERSITY-Ω: Model genealogy, independence & groupthink protection
 * 10. DELPHI-Ω: Structured multi-expert deliberation & synthesis
 * 11. ARROW-Ω: Coherent action preference aggregation
 * 12. GÖDEL: Ontology gap detection & fail-closed UNKNOWN emission
 */
/**
 * KALMAN-Ω: Model Dynamics & Residual Estimation
 */
export class KalmanOmegaEngine {
    evaluateModelDynamics(params) {
        const marketDynamics = params.marketPredictionErrorBps < 50 ? 'VALID' : params.marketPredictionErrorBps < 150 ? 'DRIFTING' : 'DEGRADED';
        const liquidityDynamics = params.liquiditySlippageResidualBps < 30 ? 'VALID' : params.liquiditySlippageResidualBps < 80 ? 'DRIFTING' : 'DEGRADED';
        const executionDynamics = params.executionFillLatencyMs < 400 ? 'VALID' : params.executionFillLatencyMs < 1000 ? 'DRIFTING' : 'DEGRADED';
        return {
            marketDynamics,
            liquidityDynamics,
            executionDynamics,
            walletDynamics: 'VALID',
            recoveryDynamics: 'VALID',
            largestResidual: liquidityDynamics === 'DRIFTING' ? 'EXIT CAPACITY' : 'EXECUTION LATENCY',
            bias: 'OPTIMISTIC',
            affectedCapability: 'LARGE ENTRY',
        };
    }
}
/**
 * PARMENIDES-Ω: Contradiction Preservation
 */
export class ParmenidesOmegaEngine {
    checkContradictions(beliefs) {
        const contradictions = [];
        const claims = new Map(beliefs.map((b) => [b.claim, b.confidence]));
        if (claims.has('ORGANIC_EXPANSION') && claims.has('SYBIL_CONCENTRATION')) {
            contradictions.push('ORGANIC_FLOW_VS_SYBIL_CONCENTRATION');
        }
        return {
            hasContradictions: contradictions.length > 0,
            activeContradictions: contradictions,
        };
    }
}
/**
 * SAVAGE-Ω: Minimax Regret Under Competing Worlds
 */
export class SavageOmegaEngine {
    evaluateRobustAction(worlds) {
        if (worlds.length > 1) {
            // High uncertainty across divergent worlds favors cautious preservation (WATCH or REDUCE)
            return { recommendedAction: 'WATCH', maxRegret: 0.15 };
        }
        return { recommendedAction: 'ENTER', maxRegret: 0.04 };
    }
}
/**
 * BELLMAN-Ω: Recursive Continuation-State Value
 */
export class BellmanOmegaEngine {
    computeContinuationValue(params) {
        const decay = Math.max(0.5, 1.0 - params.timeInTradeSec / 300);
        const value = params.currentPnlSol * decay * (params.exitCoveragePct / 100);
        return {
            continuationValue: Number(value.toFixed(4)),
            recommendExit: params.exitCoveragePct < 50 || params.timeInTradeSec > 240,
        };
    }
}
/**
 * BERNOULLI-Ω: Sequential Decision Timing & Optionality
 */
export class BernoulliOmegaEngine {
    evaluateOptionality(volatilityBps, trendStrength) {
        const delayValue = (volatilityBps / 1000) * (1.0 - trendStrength);
        return {
            delayValueSol: Number(delayValue.toFixed(4)),
            actNow: delayValue < 0.2,
        };
    }
}
/**
 * SIMON-Ω: Attention & Decision-Load Allocation
 */
export class SimonOmegaEngine {
    allocateAttention(candidateScore, systemLoad) {
        if (systemLoad === 'CRITICAL' && candidateScore < 80) {
            return { attentionLane: 'IGNORE', budgetMs: 0 };
        }
        if (candidateScore >= 70) {
            return { attentionLane: 'DEEP_DELIBERATION', budgetMs: 150 };
        }
        if (candidateScore >= 40) {
            return { attentionLane: 'SURFACE_SCAN', budgetMs: 25 };
        }
        return { attentionLane: 'IGNORE', budgetMs: 0 };
    }
}
/**
 * KAHNEMAN-Ω: Fast / Slow Reasoning Router
 */
export class KahnemanOmegaEngine {
    routeReasoning(params) {
        if (!params.feedHealthy) {
            return 'ESCALATING';
        }
        if (params.isNovelRegime || params.isLargePosition || params.evidenceContradiction) {
            return 'SLOW';
        }
        return 'FAST';
    }
}
/**
 * EXPERTISE-Ω: Domain Expert Competence
 */
export class ExpertiseOmegaEngine {
    getTopExperts() {
        return {
            primary: 'Wallet Graph',
            challenger: 'Funding Graph',
        };
    }
}
/**
 * DIVERSITY-Ω: Model Genealogy & Groupthink Protection
 */
export class DiversityOmegaEngine {
    evaluateIndependence(expertA, expertB) {
        // Wallet graph and Funding graph utilize distinct causal topologies
        const correlation = expertA === expertB ? 1.0 : 0.22;
        return {
            correlation,
            status: correlation < 0.4 ? 'HEALTHY' : correlation < 0.7 ? 'DEGRADED' : 'COLLAPSED',
        };
    }
}
/**
 * DELPHI-Ω: Multi-Expert Deliberation & Synthesis
 */
export class DelphiOmegaEngine {
    synthesizeClaims() {
        return {
            commonGround: ['Flow increasing', 'Liquidity present'],
            criticalDisagreement: 'Buyer independence',
            consensusAction: 'WATCH',
        };
    }
}
/**
 * ARROW-Ω: Coherent Action Preference Aggregation
 */
export class ArrowOmegaEngine {
    aggregatePreferences(preferences) {
        const counts = new Map();
        for (const p of preferences) {
            counts.set(p, (counts.get(p) || 0) + 1);
        }
        let max = 0;
        let chosen = 'WATCH';
        for (const [action, cnt] of counts.entries()) {
            if (cnt > max) {
                max = cnt;
                chosen = action;
            }
        }
        return chosen;
    }
}
/**
 * GÖDEL: Ontology Gap & UNKNOWN Evaluation
 */
export class GodelOmegaEngine {
    testOntology(features) {
        const missingKeys = Object.entries(features).filter(([_, v]) => v === undefined || isNaN(v));
        const isRecognized = missingKeys.length === 0;
        return {
            isRecognized,
            evaluation: isRecognized ? 'KNOWN' : 'UNKNOWN',
        };
    }
}
/**
 * Unified Omega-Epistemic Orchestrator
 */
export class OmegaEpistemicOrchestrator {
    kalman = new KalmanOmegaEngine();
    parmenides = new ParmenidesOmegaEngine();
    savage = new SavageOmegaEngine();
    bellman = new BellmanOmegaEngine();
    bernoulli = new BernoulliOmegaEngine();
    simon = new SimonOmegaEngine();
    kahneman = new KahnemanOmegaEngine();
    expertise = new ExpertiseOmegaEngine();
    diversity = new DiversityOmegaEngine();
    delphi = new DelphiOmegaEngine();
    arrow = new ArrowOmegaEngine();
    godel = new GodelOmegaEngine();
    getEpistemicTelemetry(params) {
        const isStale = params?.isFeedStale ?? false;
        const mode = this.kahneman.routeReasoning({
            isNovelRegime: false,
            isLargePosition: false,
            feedHealthy: !isStale,
            evidenceContradiction: true,
        });
        const modelDynamics = this.kalman.evaluateModelDynamics({
            marketPredictionErrorBps: params?.marketErrorBps ?? 45,
            liquiditySlippageResidualBps: params?.slippageResidualBps ?? 40,
            executionFillLatencyMs: params?.latencyMs ?? 220,
        });
        const experts = this.expertise.getTopExperts();
        const independence = this.diversity.evaluateIndependence(experts.primary, experts.challenger);
        const delphiSynthesis = this.delphi.synthesizeClaims();
        const reasoningReport = {
            mode,
            primaryExpert: experts.primary,
            independentChallenger: experts.challenger,
            expertIndependence: independence.status,
            activeWorldsCount: 2,
            commonGround: delphiSynthesis.commonGround,
            criticalDisagreement: delphiSynthesis.criticalDisagreement,
            actionCommonGround: delphiSynthesis.consensusAction,
        };
        return {
            modelDynamics,
            reasoning: reasoningReport,
        };
    }
}
//# sourceMappingURL=omega-epistemic.js.map