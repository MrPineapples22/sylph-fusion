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
export class ContinuationQualityEngine {
    /**
     * Critical Update (AGENTS.md):
     * Never neutralize or bypass the "< 5 unique buyers" penalty in the CQ formula.
     * Bypassing this penalty completely blinds the bot to illiquid pump-fakes.
     */
    evaluateCQ(input) {
        const { buyerAbsorptionRatio, sellerExhaustionRatio, uniqueBuyers, isDex } = input;
        // Hard penalty for illiquid pump-fakes: < 5 unique buyers on bonding curves
        if (!isDex && uniqueBuyers < 5) {
            return {
                score: Math.min(0.20, uniqueBuyers * 0.04),
                tier: 'POOR',
                isIlliquidBlocked: true,
                reason: `Illiquid pump-fake risk: only ${uniqueBuyers} unique buyers (< 5 required)`,
            };
        }
        // Balanced absorption & exhaustion: geometric mean to prevent overly punitive zeroing
        const abs = Math.max(0.01, Math.min(1.0, buyerAbsorptionRatio));
        const exh = Math.max(0.01, Math.min(1.0, sellerExhaustionRatio));
        const rawScore = Math.sqrt(abs * exh);
        // Apply scale multiplier based on buyer breadth
        const breadthMultiplier = Math.min(1.2, 0.8 + (uniqueBuyers / 50) * 0.4);
        const calibratedScore = Math.min(1.0, rawScore * breadthMultiplier);
        let tier = 'POOR';
        if (calibratedScore >= 0.75)
            tier = 'EXCELLENT';
        else if (calibratedScore >= 0.55)
            tier = 'GOOD';
        else if (calibratedScore >= 0.35)
            tier = 'FAIR';
        return {
            score: Number(calibratedScore.toFixed(4)),
            tier,
            isIlliquidBlocked: false,
            reason: `CQ ${tier} (${(calibratedScore * 100).toFixed(1)}%): absorption ${(abs * 100).toFixed(0)}%, exhaustion ${(exh * 100).toFixed(0)}% across ${uniqueBuyers} buyers`,
        };
    }
}
//# sourceMappingURL=pumpscore.js.map