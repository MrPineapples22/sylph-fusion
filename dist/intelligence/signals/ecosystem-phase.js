/**
 * SOL-SYLPH Ecosystem Phase Engine
 * Blueprint Part XXII
 *
 * Determines broader macro ecosystem state:
 * CAPITAL_EXPANSION, ROTATION, CONCENTRATION, FRAGMENTATION, LIQUIDITY_CONTRACTION, RISK_OFF.
 * Informs individual token analysis with global context.
 */
export class EcosystemPhaseEngine {
    evaluatePhase(telemetry) {
        let phase = 'ROTATION';
        let riskMultiplier = 1.0;
        let confidence = 0.85;
        if (telemetry.riskSentimentIndex < 0.25 || telemetry.netCapitalFlowSol < -500) {
            phase = 'RISK_OFF';
            riskMultiplier = 0.3;
            confidence = 0.9;
        }
        else if (telemetry.netCapitalFlowSol < -100) {
            phase = 'LIQUIDITY_CONTRACTION';
            riskMultiplier = 0.6;
        }
        else if (telemetry.top3McapSharePct > 60) {
            phase = 'CONCENTRATION';
            riskMultiplier = 0.8;
        }
        else if (telemetry.netCapitalFlowSol > 200 && telemetry.riskSentimentIndex > 0.6) {
            phase = 'CAPITAL_EXPANSION';
            riskMultiplier = 1.2;
        }
        else if (telemetry.totalActiveTokens > 100 && telemetry.top3McapSharePct < 25) {
            phase = 'FRAGMENTATION';
            riskMultiplier = 0.7;
        }
        else {
            phase = 'ROTATION';
            riskMultiplier = 1.0;
        }
        const summaries = {
            CAPITAL_EXPANSION: 'Aggressive net new capital inflow across ecosystem with buoyant liquidity.',
            ROTATION: 'Capital rotating rapidly between established and newly discovered tokens.',
            CONCENTRATION: 'Capital concentrating into Top-3 mega-tokens; small caps starved of liquidity.',
            FRAGMENTATION: 'Attention heavily fragmented across large count of low-liquidity launches.',
            LIQUIDITY_CONTRACTION: 'Net capital exiting liquidity pools; slippage increasing across pairs.',
            RISK_OFF: 'Macro risk-off flight to safety; capital preservation mode active.',
        };
        return {
            phase,
            confidence,
            telemetry,
            riskMultiplier,
            summary: summaries[phase],
        };
    }
}
//# sourceMappingURL=ecosystem-phase.js.map