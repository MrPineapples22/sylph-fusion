/**
 * SYLPH FUSION — FLOW REPRODUCTION INTELLIGENCE (Section 17)
 * Epidemic-style branching process modeling of trade flow reproduction:
 * R_buy: effective reproductive number of buy orders (new independent buyers spawned per existing buyer)
 * R_sell: effective reproductive number of sell orders (cascading sellers triggered per sale)
 *
 * Core Principle:
 * R_buy > 1.0 AND R_sell < 1.0 indicates constructive self-sustaining organic capital arrival.
 * Differentiates existing capital recycling (churn) from new independent capital arrival.
 */
export class FlowReproductionAnalyzer {
    /**
     * Computes flow reproduction metrics over an ordered sequence of trade events.
     */
    static analyze(trades, windowDurationSeconds) {
        if (trades.length < 5 || windowDurationSeconds <= 0) {
            return {
                rBuy: 0.5,
                rSell: 1.5,
                capitalRenewalRatio: 0.1,
                capitalRecyclingRatio: 0.9,
                independentBuyerArrivalRate: 0,
                independentSellerArrivalRate: 0,
                isFlowConstructive: false,
                flowRegime: 'STAGNANT_DIFFUSION',
            };
        }
        let totalBuySol = 0;
        let totalSellSol = 0;
        let newActorBuySol = 0;
        let recycledBuySol = 0;
        const uniqueBuyers = new Set();
        const uniqueSellers = new Set();
        const newBuyers = new Set();
        const newSellers = new Set();
        for (const t of trades) {
            if (t.isBuy) {
                totalBuySol += t.solAmount;
                uniqueBuyers.add(t.actorAddress);
                if (t.isFirstTimeActor) {
                    newActorBuySol += t.solAmount;
                    newBuyers.add(t.actorAddress);
                }
                else {
                    recycledBuySol += t.solAmount;
                }
            }
            else {
                totalSellSol += t.solAmount;
                uniqueSellers.add(t.actorAddress);
                if (t.isFirstTimeActor) {
                    newSellers.add(t.actorAddress);
                }
            }
        }
        const totalSol = Math.max(0.001, totalBuySol + totalSellSol);
        const capitalRenewalRatio = Math.min(1.0, Math.max(0.0, newActorBuySol / totalSol));
        const capitalRecyclingRatio = Math.min(1.0, Math.max(0.0, recycledBuySol / totalSol));
        const minutes = Math.max(0.1, windowDurationSeconds / 60);
        const independentBuyerArrivalRate = newBuyers.size / minutes;
        const independentSellerArrivalRate = newSellers.size / minutes;
        // Estimate branching parameter R_buy and R_sell:
        // Split trades into two halves to measure propagation:
        const midIdx = Math.floor(trades.length / 2);
        const firstHalfBuys = trades.slice(0, midIdx).filter(t => t.isBuy);
        const secondHalfBuys = trades.slice(midIdx).filter(t => t.isBuy);
        const firstHalfSells = trades.slice(0, midIdx).filter(t => !t.isBuy);
        const secondHalfSells = trades.slice(midIdx).filter(t => !t.isBuy);
        const baseRBuy = firstHalfBuys.length > 0
            ? secondHalfBuys.length / firstHalfBuys.length
            : 0.8;
        // Scale by fraction of independent capital arrival
        const rBuy = Math.min(5.0, Math.max(0.1, baseRBuy * (0.5 + 0.5 * capitalRenewalRatio)));
        const baseRSell = firstHalfSells.length > 0
            ? secondHalfSells.length / firstHalfSells.length
            : 0.8;
        const rSell = Math.min(5.0, Math.max(0.1, baseRSell));
        const isFlowConstructive = rBuy > 1.0 && rSell < 1.0 && capitalRenewalRatio >= 0.35;
        let flowRegime;
        if (rBuy > 1.2 && rSell < 0.9 && capitalRenewalRatio >= 0.4) {
            flowRegime = 'REPRODUCTIVE_EXPANSION';
        }
        else if (rSell > 1.2) {
            flowRegime = 'LIQUIDATION_CASCADE';
        }
        else if (capitalRecyclingRatio > 0.65) {
            flowRegime = 'CHURN_RECYCLING';
        }
        else {
            flowRegime = 'STAGNANT_DIFFUSION';
        }
        return {
            rBuy,
            rSell,
            capitalRenewalRatio,
            capitalRecyclingRatio,
            independentBuyerArrivalRate,
            independentSellerArrivalRate,
            isFlowConstructive,
            flowRegime,
        };
    }
}
//# sourceMappingURL=flow-reproduction.js.map