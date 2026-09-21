/**
 * SOL-SYLPH Market Intent & Phase Engine
 * Blueprint Part XVIII
 *
 * Models token market lifecycle into 9 bidirectional states:
 * DISCOVERY, EARLY_ACCUMULATION, CONFIRMED_ACCUMULATION,
 * EXPANSION, MOMENTUM, SATURATION, DISTRIBUTION,
 * LIQUIDITY_STRESS, CAPITULATION_COLLAPSE.
 */
export class MarketPhaseEngine {
    evaluatePhase(mint, inputs) {
        let phase = 'DISCOVERY';
        let compact = 'DISCOVERY';
        let rationale = '';
        // Multi-directional state evaluation
        if (inputs.distanceToFailure < 0.2 || (inputs.sellPressureVelocity > 3.0 && inputs.priceChangePct1h < -40)) {
            phase = 'CAPITULATION_COLLAPSE';
            compact = 'COLLAPSE';
            rationale = 'Distance to failure breached; severe uncontrolled liquidation cascade.';
        }
        else if (inputs.exitCapacitySol < 1.0 || inputs.sellPressureVelocity > 2.0 || inputs.topClusterConcentrationPct > 65) {
            phase = 'LIQUIDITY_STRESS';
            compact = 'STRESS';
            rationale = 'Exit capacity severely constrained; sell pressure overwhelming liquidity depth.';
        }
        else if (inputs.topClusterConcentrationPct > 45 && inputs.freshCapitalVelocity < 0 && inputs.priceChangePct1h < -10) {
            phase = 'DISTRIBUTION';
            compact = 'DISTRIB';
            rationale = 'Top holder clusters distributing inventory while net fresh capital reverses.';
        }
        else if (inputs.priceChangePct1h > 20 && inputs.actorGrowthVelocity < 0.1 && inputs.freshCapitalVelocity < 0.1) {
            phase = 'SATURATION';
            compact = 'SATURATION';
            rationale = 'Price elevated but new actor growth stalling; market approaching saturation.';
        }
        else if (inputs.priceChangePct1h > 30 && inputs.actorGrowthVelocity > 0.5 && inputs.economicVolumeSol > 50) {
            phase = 'MOMENTUM';
            compact = 'MOMENTUM';
            rationale = 'High price velocity supported by rapid independent actor expansion and economic volume.';
        }
        else if (inputs.freshCapitalVelocity > 0.5 && inputs.actorGrowthVelocity > 0.3 && inputs.liquiditySol > 15) {
            phase = 'EXPANSION';
            compact = 'EXPANSION';
            rationale = 'Net fresh capital expanding liquidity and broadening economic ownership.';
        }
        else if (inputs.actorGrowthVelocity > 0.1 && inputs.topClusterConcentrationPct < 35 && inputs.marketAuthenticityScore > 0.7) {
            phase = 'CONFIRMED_ACCUMULATION';
            compact = 'ACCUM';
            rationale = 'Decentralized accumulation by authentic independent actors.';
        }
        else if (inputs.liquiditySol > 5 && inputs.economicVolumeSol > 2) {
            phase = 'EARLY_ACCUMULATION';
            compact = 'ACCUM';
            rationale = 'Initial accumulation phase post-genesis.';
        }
        else {
            phase = 'DISCOVERY';
            compact = 'DISCOVERY';
            rationale = 'New launch in initial discovery stage; awaiting formation confirmation.';
        }
        const transitions = {
            DISCOVERY: ['EARLY_ACCUMULATION', 'LIQUIDITY_STRESS', 'CAPITULATION_COLLAPSE'],
            EARLY_ACCUMULATION: ['CONFIRMED_ACCUMULATION', 'EXPANSION', 'DISTRIBUTION', 'LIQUIDITY_STRESS'],
            CONFIRMED_ACCUMULATION: ['EXPANSION', 'MOMENTUM', 'DISTRIBUTION', 'LIQUIDITY_STRESS'],
            EXPANSION: ['MOMENTUM', 'SATURATION', 'DISTRIBUTION', 'LIQUIDITY_STRESS'],
            MOMENTUM: ['SATURATION', 'DISTRIBUTION', 'LIQUIDITY_STRESS', 'CAPITULATION_COLLAPSE'],
            SATURATION: ['DISTRIBUTION', 'LIQUIDITY_STRESS', 'CAPITULATION_COLLAPSE', 'EXPANSION'],
            DISTRIBUTION: ['LIQUIDITY_STRESS', 'CAPITULATION_COLLAPSE', 'EARLY_ACCUMULATION'],
            LIQUIDITY_STRESS: ['CAPITULATION_COLLAPSE', 'DISTRIBUTION', 'CONFIRMED_ACCUMULATION'],
            CAPITULATION_COLLAPSE: ['EARLY_ACCUMULATION', 'DISCOVERY'],
        };
        return {
            mint,
            currentPhase: phase,
            compactPhaseCode: compact,
            confidence: 0.85,
            rationale,
            allowableTransitions: transitions[phase],
            evaluatedAtMs: Date.now(),
        };
    }
}
//# sourceMappingURL=market-phase-engine.js.map