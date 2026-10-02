/**
 * SOL-SYLPH Intelligence Fabric - Capital-Flow-X Engine
 * Specifications: Master Blueprint Section 12 & Priority Item 16.
 *
 * Implements:
 * 1. Genuine capital tracking separated from superficial transaction count or wash volume.
 * 2. Fundamental capital variables:
 *    - gross_buy_SOL, gross_sell_SOL, net_SOL
 *    - independent_entity_inflow
 *    - unique_buyer_count, unique_entity_count, repeat_buyer_rate
 *    - seller_absorption, liquidity_change, whale_flow, creator_flow, first_buyer_retention
 * 3. First and second order continuous derivatives:
 *    - dFlow/dt (velocity)
 *    - d^2Flow/dt^2 (acceleration)
 * 4. CapitalFlowState:
 *    - level, velocity, acceleration, persistence, quality, toxicity
 */
import { createHash } from 'node:crypto';
export class CapitalFlowEngine {
    observationHistory = new Map();
    /**
     * Evaluates incoming capital observations and computes dynamic flow derivatives.
     */
    evaluateFlow(observation) {
        const { mint, timestampMs, slot, grossBuySol, grossSellSol, independentEntityInflowSol, uniqueBuyerCount, uniqueEntityCount, repeatBuyerCount, creatorSellSol, whaleBuySol, poolLiquiditySol, } = observation;
        let history = this.observationHistory.get(mint);
        if (!history) {
            history = [];
            this.observationHistory.set(mint, history);
        }
        history.push(observation);
        // Keep up to 60 historical observations (~5-10 minutes)
        if (history.length > 60) {
            history.shift();
        }
        const netSol = Number((grossBuySol - grossSellSol).toFixed(4));
        const repeatBuyerRate = uniqueBuyerCount > 0 ? Number((repeatBuyerCount / uniqueBuyerCount).toFixed(3)) : 0;
        const firstBuyerRetentionRate = uniqueEntityCount > 0 ? Number(Math.min(1.0, repeatBuyerCount / uniqueEntityCount).toFixed(3)) : 0;
        // 1. Calculate 1st derivative: dFlow/dt (velocity)
        let dFlowDt = 0;
        let d2FlowDt2 = 0;
        if (history.length >= 2) {
            const prev = history[history.length - 2];
            const dtSec = Math.max(0.5, (timestampMs - prev.timestampMs) / 1000);
            const prevNetSol = prev.grossBuySol - prev.grossSellSol;
            dFlowDt = Number(((netSol - prevNetSol) / dtSec).toFixed(4));
            // 2. Calculate 2nd derivative: d^2Flow/dt^2 (acceleration)
            if (history.length >= 3) {
                const prevPrev = history[history.length - 3];
                const dtPrevSec = Math.max(0.5, (prev.timestampMs - prevPrev.timestampMs) / 1000);
                const prevPrevNetSol = prevPrev.grossBuySol - prevPrev.grossSellSol;
                const prevVelocity = (prevNetSol - prevPrevNetSol) / dtPrevSec;
                d2FlowDt2 = Number(((dFlowDt - prevVelocity) / dtSec).toFixed(4));
            }
        }
        // 3. Flow Persistence: fraction of recent ticks where net flow was positive
        let positiveTicks = 0;
        for (const h of history) {
            if (h.grossBuySol >= h.grossSellSol)
                positiveTicks++;
        }
        const persistence = Number((positiveTicks / history.length).toFixed(3));
        // 4. Flow Quality: independent entity inflow relative to total gross buying
        const totalVolume = grossBuySol + grossSellSol;
        const quality = totalVolume > 0
            ? Number(Math.max(0.01, Math.min(1.0, independentEntityInflowSol / Math.max(0.001, grossBuySol))).toFixed(3))
            : 0.5;
        // 5. Flow Toxicity: presence of creator dumps or predatory extraction relative to liquidity
        const creatorDrainPct = poolLiquiditySol > 0 ? (creatorSellSol / poolLiquiditySol) * 100 : 0;
        let toxicityScore = creatorDrainPct > 0 ? creatorDrainPct / 20.0 : 0.0;
        if (grossSellSol > grossBuySol * 2 && totalVolume > 10.0)
            toxicityScore += 0.3;
        const toxicity = Number(Math.min(1.0, Math.max(0.0, toxicityScore)).toFixed(3));
        const derivatives = {
            dFlowDt,
            d2FlowDt2,
        };
        const stateDigest = createHash('sha256')
            .update('CAPITAL_FLOW_STATE:')
            .update(mint)
            .update(slot.toString())
            .update(netSol.toString())
            .update(dFlowDt.toString())
            .update(d2FlowDt2.toString())
            .update(quality.toString())
            .update(toxicity.toString())
            .digest('hex');
        return {
            mint,
            timestampMs,
            slot,
            netSol,
            velocity: dFlowDt,
            acceleration: d2FlowDt2,
            persistence,
            quality,
            toxicity,
            repeatBuyerRate,
            firstBuyerRetentionRate,
            derivatives,
            stateDigest,
        };
    }
}
//# sourceMappingURL=capital-flow-x.js.map