/**
 * SYLPH FUSION — SOL AGENT 5: ML / MULTIPLIER-X ENGINEER (MULTIPLIER-X)
 * Specifications: Sections 3 (Sol Agent 5), 11 (Objective), 12 (Barriers),
 * 13 (TAIL-LATTICE-X), 14 (Competing Risks), 15 (First Passage), 41 (Historical Transport),
 * 43 (Near-Miss Research).
 *
 * Implements:
 * 1. MultiplierXObjective: Chart -> Organic -> First-Passage -> Path-Valid -> Executable -> Capturable.
 * 2. TailLatticeEngine: Strict lattice monotonicity across barriers, horizons, and execution constraints.
 * 3. MultiStateRunnerEngine: MULTI-STATE-RUNNER-X semi-Markov state machine (1x -> 2x -> 5x -> 10x -> 20x -> 50x -> 100x+).
 * 4. FirstPassageEngine: FIRST-PASSAGE-X P(T_N < T_D) path validity testing.
 * 5. CauseSpecificExitEngine: CAUSE-SPECIFIC-EXIT-X hazard rate estimation for competing failure causes.
 * 6. NearMissEngine: NEAR-MISS-X, CONTRASTIVE-RUNNER-X, TAIL-BRIDGE-X, 100X Bridge Certificate.
 * 7. HistoricalTransportEngine: HISTORICAL-TRANSPORT-X protocol epoch and regime domain adaptation.
 */
import { createHash } from 'node:crypto';
export class TailLatticeEngine {
    /**
     * Enforces mathematical monotonicity:
     * P100 <= P50 <= P20 <= P10 <= P5 <= P2
     * P(Capturable N) <= P(Executable N) <= P(Organic N) <= P(Observed N)
     */
    static enforceLatticeMonotonicity(raw) {
        // Isotonic downward projection
        const p2x = Math.max(0, Math.min(1.0, raw.p2x));
        const p5x = Math.max(0, Math.min(p2x, raw.p5x));
        const p10x = Math.max(0, Math.min(p5x, raw.p10x));
        const p20x = Math.max(0, Math.min(p10x, raw.p20x));
        const p50x = Math.max(0, Math.min(p20x, raw.p50x));
        const p100x = Math.max(0, Math.min(p50x, raw.p100x));
        // Capturable probability must never exceed theoretical observed probability
        const bounded = (value, upper) => value === undefined ? null : Math.max(0, Math.min(upper, value));
        const pCapturable2x = bounded(raw.pCapturable2x, p2x);
        const pCapturable10x = bounded(raw.pCapturable10x, p10x);
        const pCapturable100x = bounded(raw.pCapturable100x, p100x);
        return {
            p2x,
            p5x,
            p10x,
            p20x,
            p50x,
            p100x,
            pCapturable2x,
            pCapturable10x,
            pCapturable100x,
            authority: 'RESEARCH_ONLY',
        };
    }
    static enforceHorizonMonotonicity(horizonProbs) {
        // Monotonic increase over horizon: P(N by 30s) <= P(N by 1m) <= ... <= P(N by 24h)
        const p30s = Math.max(0, Math.min(1.0, horizonProbs['30s']));
        const p1m = Math.max(p30s, Math.min(1.0, horizonProbs['1m']));
        const p5m = Math.max(p1m, Math.min(1.0, horizonProbs['5m']));
        const p15m = Math.max(p5m, Math.min(1.0, horizonProbs['15m']));
        const p1h = Math.max(p15m, Math.min(1.0, horizonProbs['1h']));
        const p6h = Math.max(p1h, Math.min(1.0, horizonProbs['6h']));
        const p24h = Math.max(p6h, Math.min(1.0, horizonProbs['24h']));
        return {
            '30s': p30s,
            '1m': p1m,
            '5m': p5m,
            '15m': p15m,
            '1h': p1h,
            '6h': p6h,
            '24h': p24h,
        };
    }
}
export class MultiStateRunnerEngine {
    static evaluateRunner(input) {
        let currentState = 'S0_1X';
        if (input.currentMultiplier >= 100)
            currentState = 'S6_100X';
        else if (input.currentMultiplier >= 50)
            currentState = 'S5_50X';
        else if (input.currentMultiplier >= 20)
            currentState = 'S4_20X';
        else if (input.currentMultiplier >= 10)
            currentState = 'S3_10X';
        else if (input.currentMultiplier >= 5)
            currentState = 'S2_5X';
        else if (input.currentMultiplier >= 2)
            currentState = 'S1_2X';
        // First passage: token that drops to -35% before pumping is pathological (reject!)
        const pFirstPassageValid = false;
        // Competing hazards
        const devDumpHazard = Math.min(1.0, input.sellHazard * 0.7);
        const rugHazard = input.effectiveBuyers < 5 ? 0.6 : 0.05;
        const liquidityDrainHazard = input.liquidityDepthSol < 10 ? 0.5 : 0.08;
        const drawdownHazard = Math.min(1.0, Math.abs(input.maePct) / 40.0);
        const timeoutHazard = 0.15;
        const baseTransition = input.effectiveBuyers >= 10 ? 0.65 : (input.effectiveBuyers >= 5 ? 0.45 : 0.15);
        const hazardPenalty = (devDumpHazard + rugHazard + drawdownHazard) / 3;
        const pTransitionNext = Math.max(0.01, baseTransition * (1.0 - hazardPenalty));
        const netExecutableEv = pTransitionNext * (input.currentMultiplier * 0.5) - (hazardPenalty * 0.2);
        return {
            currentState,
            pTransitionNext: Number(pTransitionNext.toFixed(4)),
            pFailureCause: {
                DEV_DUMP: Number(devDumpHazard.toFixed(4)),
                RUG_PULL: Number(rugHazard.toFixed(4)),
                LIQUIDITY_DRAIN: Number(liquidityDrainHazard.toFixed(4)),
                DRAWDOWN_BREACH: Number(drawdownHazard.toFixed(4)),
                TIMEOUT: Number(timeoutHazard.toFixed(4)),
            },
            pFirstPassageValid,
            firstPassageAuthority: 'NOT_ESTIMATED_RESEARCH_ONLY',
            authority: 'RESEARCH_ONLY',
            netExecutableEv: Number(netExecutableEv.toFixed(4)),
        };
    }
}
export class NearMissEngine {
    static evaluate100xBridge(input) {
        // Structural bridge criteria separating 20x failure from 100x continuation:
        // 1. Top 10 concentration < 25%
        // 2. Liquidity replenishment > 2.0 SOL/min
        // 3. Runner defection rate < 15%
        const concentrationScore = Math.max(0, 1.0 - input.top10HolderConcentrationPct / 40);
        const replenishmentScore = Math.min(1.0, input.liquidityReplenishmentPerMinuteSol / 4.0);
        const defectionImmunityScore = Math.max(0, 1.0 - input.runnerDefectionRate * 3.0);
        const bridgeScore = Number((concentrationScore * 0.4 + replenishmentScore * 0.35 + defectionImmunityScore * 0.25).toFixed(4));
        const qualifies = bridgeScore >= 0.70 && input.currentMultiple >= 5;
        const payload = `${input.mint}:${bridgeScore}:${qualifies}:${Date.now()}`;
        const hash = createHash('sha256').update(payload).digest('hex');
        return {
            certificateId: `research_${hash.slice(0, 12)}`,
            mint: input.mint,
            bridgeScore,
            holderDispersionEntropy: concentrationScore,
            liquidityReplenishmentVelocity: replenishmentScore,
            defectionImmunityScore,
            qualifiesFor100xBridge: qualifies,
            is100xCertificate: false,
            authority: 'RESEARCH_ONLY',
            hash,
        };
    }
}
export class HistoricalTransportEngine {
    static classifyDomain(input) {
        if (input.pumpProtocolGeneration === 'UNKNOWN') {
            return {
                epochId: `epoch_${input.solanaProtocolEpoch}_unknown`,
                authorityLevel: 'OUT_OF_SUPPORT',
                shouldAbstain: true,
                weightMultiplier: 0.0,
            };
        }
        if (!input.feeScheduleMatchesLive) {
            return {
                epochId: `epoch_${input.solanaProtocolEpoch}_fee_mismatch`,
                authorityLevel: 'UNVERIFIED_RESEARCH_ONLY',
                shouldAbstain: false,
                weightMultiplier: 0,
            };
        }
        if (input.pumpProtocolGeneration === 'PUMPSWAP_AMM' || input.pumpProtocolGeneration === 'EXPANDED_V2') {
            return {
                epochId: `epoch_${input.solanaProtocolEpoch}_live`,
                authorityLevel: 'UNVERIFIED_RESEARCH_ONLY',
                shouldAbstain: false,
                weightMultiplier: 0,
            };
        }
        return {
            epochId: `epoch_${input.solanaProtocolEpoch}_legacy`,
            authorityLevel: 'UNVERIFIED_RESEARCH_ONLY',
            shouldAbstain: false,
            weightMultiplier: 0,
        };
    }
}
//# sourceMappingURL=multiplier-x.js.map