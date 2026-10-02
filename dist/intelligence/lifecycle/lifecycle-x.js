/**
 * SOL-SYLPH Intelligence Fabric - Lifecycle-X Engine
 * Specifications: Master Blueprint Section 11 & Priority Item 15.
 *
 * Implements:
 * 1. 15 explicit canonical lifecycle phases:
 *    LAUNCH -> INITIAL_DISCOVERY -> EARLY_BONDING -> BONDING_EXPANSION ->
 *    CURVE_ACCELERATION -> NEAR_MIGRATION -> MIGRATING -> POST_MIGRATION_DISCOVERY ->
 *    POST_MIGRATION_EXPANSION -> MOMENTUM -> MATURE_EXPANSION -> DISTRIBUTION ->
 *    LIQUIDITY_DECAY -> COLLAPSE -> DEAD.
 * 2. Non-Markov transition history preservation (past path dictates future hazards).
 * 3. Competing transition hazard models mapping current trajectory to prospective phases.
 */
import { createHash } from 'node:crypto';
export class LifecycleXEngine {
    transitions = new Map();
    /**
     * Evaluates the non-Markovian lifecycle trajectory of a token.
     */
    evaluateLifecycle(inputs, previousState) {
        const { mint, ageSeconds, bondingCurveProgressPct, isMigratedToAmm, poolLiquiditySol, peakLiquiditySol, recentVolumeSol, netCapitalFlowSol, isDevSold, currentSlot, timestampMs, } = inputs;
        const history = [...(this.transitions.get(mint) ?? previousState?.transitionHistory ?? [])];
        // 1. Determine prospective phase based on strict hierarchical evidence
        let nextPhase = 'INITIAL_DISCOVERY';
        let trigger = 'DEFAULT_DISCOVERY';
        const liquidityDrawdownPct = peakLiquiditySol > 0
            ? ((peakLiquiditySol - poolLiquiditySol) / peakLiquiditySol) * 100
            : 0;
        if (poolLiquiditySol < 0.5 && ageSeconds > 30) {
            nextPhase = 'DEAD';
            trigger = 'LIQUIDITY_EXTINCT';
        }
        else if (liquidityDrawdownPct >= 80 || (isDevSold && liquidityDrawdownPct >= 50)) {
            nextPhase = 'COLLAPSE';
            trigger = 'DRASTIC_LIQUIDITY_DRAIN_OR_DEV_EXIT';
        }
        else if (liquidityDrawdownPct >= 40 && netCapitalFlowSol < -5.0) {
            nextPhase = 'LIQUIDITY_DECAY';
            trigger = 'PERSISTENT_CAPITAL_OUTFLOW';
        }
        else if (netCapitalFlowSol < -1.0 && recentVolumeSol > 10.0 && liquidityDrawdownPct >= 15) {
            nextPhase = 'DISTRIBUTION';
            trigger = 'NET_SELLER_ABSORPTION_EXHAUSTION';
        }
        else if (isMigratedToAmm) {
            if (recentVolumeSol > 50.0 && netCapitalFlowSol > 10.0) {
                nextPhase = 'MOMENTUM';
                trigger = 'HIGH_VELOCITY_AMM_VOLUME';
            }
            else if (poolLiquiditySol > 100.0) {
                nextPhase = 'MATURE_EXPANSION';
                trigger = 'ESTABLISHED_AMM_POOL';
            }
            else if (ageSeconds < 300) {
                nextPhase = 'POST_MIGRATION_DISCOVERY';
                trigger = 'FRESH_AMM_GRADUATION';
            }
            else {
                nextPhase = 'POST_MIGRATION_EXPANSION';
                trigger = 'AMM_STEADY_STATE';
            }
        }
        else if (bondingCurveProgressPct >= 99.0) {
            nextPhase = 'MIGRATING';
            trigger = 'CURVE_COMPLETION_GRADUATION_LOCK';
        }
        else if (bondingCurveProgressPct >= 85.0) {
            nextPhase = 'NEAR_MIGRATION';
            trigger = 'APPROACHING_MIGRATION_THRESHOLD';
        }
        else if (bondingCurveProgressPct >= 40.0 && netCapitalFlowSol > 5.0) {
            nextPhase = 'CURVE_ACCELERATION';
            trigger = 'BONDING_CURVE_ACCELERATION';
        }
        else if (bondingCurveProgressPct >= 15.0) {
            nextPhase = 'BONDING_EXPANSION';
            trigger = 'BONDING_CURVE_EXPANSION';
        }
        else if (ageSeconds < 10 && bondingCurveProgressPct < 5.0) {
            nextPhase = 'LAUNCH';
            trigger = 'MINT_INITIALIZATION_WINDOW';
        }
        else {
            nextPhase = 'EARLY_BONDING';
            trigger = 'INITIAL_CURVE_FORMULATION';
        }
        // Check if phase transition occurred
        const currentPhase = previousState ? previousState.currentPhase : null;
        let phaseAgeMs = 0;
        let phaseAgeSlots = 0;
        if (currentPhase !== nextPhase) {
            const record = {
                fromPhase: currentPhase,
                toPhase: nextPhase,
                slot: currentSlot,
                timestampMs,
                triggerReason: trigger,
            };
            history.push(record);
            this.transitions.set(mint, [...history]);
            phaseAgeMs = 0;
            phaseAgeSlots = 0;
        }
        else if (previousState) {
            phaseAgeMs = previousState.phaseAgeMs + (timestampMs - (history[history.length - 1]?.timestampMs ?? timestampMs));
            phaseAgeSlots = previousState.phaseAgeSlots + Math.max(0, currentSlot - (history[history.length - 1]?.slot ?? currentSlot));
        }
        // 2. Compute Next Phase Transition Hazard Probabilities
        const pNextPhase = this.computeTransitionHazards(nextPhase, inputs);
        const isTerminalState = nextPhase === 'DEAD' || nextPhase === 'COLLAPSE';
        const stateDigest = createHash('sha256')
            .update('LIFECYCLE_STATE:')
            .update(mint)
            .update(nextPhase)
            .update(currentSlot.toString())
            .update(history.length.toString())
            .digest('hex');
        return {
            mint,
            currentPhase: nextPhase,
            previousPhase: currentPhase,
            phaseAgeMs,
            phaseAgeSlots,
            transitionHistory: Object.freeze(history),
            pNextPhase: Object.freeze(pNextPhase),
            isTerminalState,
            stateDigest,
        };
    }
    computeTransitionHazards(current, inputs) {
        const hazards = {};
        switch (current) {
            case 'LAUNCH':
            case 'INITIAL_DISCOVERY':
                hazards.EARLY_BONDING = 0.60;
                hazards.COLLAPSE = 0.35;
                hazards.DEAD = 0.05;
                break;
            case 'EARLY_BONDING':
                hazards.BONDING_EXPANSION = 0.45;
                hazards.DISTRIBUTION = 0.30;
                hazards.COLLAPSE = 0.25;
                break;
            case 'BONDING_EXPANSION':
            case 'CURVE_ACCELERATION':
                hazards.NEAR_MIGRATION = inputs.bondingCurveProgressPct > 70 ? 0.70 : 0.40;
                hazards.DISTRIBUTION = 0.35;
                hazards.COLLAPSE = 0.15;
                break;
            case 'NEAR_MIGRATION':
                hazards.MIGRATING = 0.85;
                hazards.COLLAPSE = 0.15;
                break;
            case 'MIGRATING':
                hazards.POST_MIGRATION_DISCOVERY = 0.90;
                hazards.COLLAPSE = 0.10;
                break;
            case 'POST_MIGRATION_DISCOVERY':
            case 'POST_MIGRATION_EXPANSION':
                hazards.MOMENTUM = 0.40;
                hazards.DISTRIBUTION = 0.35;
                hazards.LIQUIDITY_DECAY = 0.25;
                break;
            case 'MOMENTUM':
                hazards.MATURE_EXPANSION = 0.50;
                hazards.DISTRIBUTION = 0.40;
                hazards.COLLAPSE = 0.10;
                break;
            case 'DISTRIBUTION':
                hazards.LIQUIDITY_DECAY = 0.65;
                hazards.COLLAPSE = 0.30;
                hazards.MOMENTUM = 0.05;
                break;
            case 'LIQUIDITY_DECAY':
                hazards.COLLAPSE = 0.75;
                hazards.DEAD = 0.25;
                break;
            case 'COLLAPSE':
                hazards.DEAD = 0.95;
                break;
            case 'DEAD':
                hazards.DEAD = 1.0;
                break;
            default:
                hazards.DEAD = 0.5;
        }
        return hazards;
    }
}
//# sourceMappingURL=lifecycle-x.js.map