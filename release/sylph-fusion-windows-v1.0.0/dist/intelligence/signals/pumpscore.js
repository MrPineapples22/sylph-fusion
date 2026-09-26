/**
 * SOL-SYLPH Master Production Intelligence - PumpScore & PoD (Point of Dumping)
 * Specifications: Section 12 (Preserve PumpScore and PoD).
 */
export class PumpScoreEngine {
    calculatePumpScore(input) {
        const curveFactor = Math.min(100, input.curveCompletionPct * 1.5);
        const volumeFactor = Math.min(100, Math.max(0, input.netBuyVolumeSol * 10));
        const accelFactor = Math.min(100, Math.max(0, input.buyerAcceleration * 20));
        const score = curveFactor * 0.4 + volumeFactor * 0.35 + accelFactor * 0.25;
        return Math.max(0, Math.min(100, Math.round(score)));
    }
}
export class PoDEngine {
    /**
     * Estimates Point of Dumping risk (0 = safe, 100 = imminent dump).
     */
    calculateDumpRisk(input) {
        let risk = 0;
        // Snipers sitting on 5x+ gains
        if (input.earlySnipersUnrealizedGainPct >= 400) {
            risk += 45;
        }
        else if (input.earlySnipersUnrealizedGainPct >= 200) {
            risk += 25;
        }
        // Heavy insider concentration
        if (input.top10HoldersPct > 40) {
            risk += 35;
        }
        else if (input.top10HoldersPct > 25) {
            risk += 15;
        }
        // Dev holding large bag near migration (75%+ curve)
        if (input.creatorHoldingPct > 5 && input.curveProgressPct > 70) {
            risk += 30;
        }
        risk = Math.min(100, risk);
        const imminent = risk >= 75;
        let trigger = 'Low dump probability';
        if (input.earlySnipersUnrealizedGainPct >= 400)
            trigger = 'Snipers sitting on >400% unrealized profit';
        else if (input.top10HoldersPct > 40)
            trigger = 'High top-10 holder concentration overhang';
        return {
            dumpRiskScore: risk,
            imminentDumpWarning: imminent,
            primaryTrigger: trigger,
        };
    }
}
//# sourceMappingURL=pumpscore.js.map