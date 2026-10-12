/**
 * SYLPH FUSION — SOLANA ARBITRAGE GRAPH & COMPLETION-RISK ENGINE
 * Specification: Solana-Only Integration Blueprint (Sections 19 & 20)
 *
 * Epistemic Invariants:
 * 1. In-memory routing graph across SOL, USDC, USDT, and active pools on Raydium, Meteora,
 *    Orca, PumpSwap, Jupiter, and CLOBs.
 * 2. Multi-leg cycle detection: 2-leg, 3-leg, and 4-leg arbitrage cycles.
 * 3. RobustArbProfit = grossSpread - fees - priorityTip - impact - slippage - completionRisk.
 * 4. AtomicityPremium: Multi-instruction atomic transactions earn an execution risk bonus over
 *    split transactions, penalizing intermediate completion hazards.
 */
import { hashCanonical } from '../pipeline/canonical-hashing.js';
export class SolanaArbitrageGraph {
    // Directed adjacency list: fromToken -> ArbGraphEdge[]
    edges = new Map();
    /**
     * Add or update an edge in the routing graph.
     */
    updateEdge(edge) {
        const fromList = this.edges.get(edge.baseToken) || [];
        const filtered = fromList.filter(e => e.edgeId !== edge.edgeId);
        filtered.push(Object.freeze({ ...edge }));
        this.edges.set(edge.baseToken, filtered);
    }
    /**
     * Remove an edge (e.g. pool depleted or paused).
     */
    removeEdge(edgeId) {
        for (const [fromToken, list] of this.edges) {
            this.edges.set(fromToken, list.filter(e => e.edgeId !== edgeId));
        }
    }
    /**
     * Searches for 2-leg, 3-leg, and 4-leg arbitrage cycles starting and ending at rootToken (e.g. SOL).
     */
    findProfitableCycles(params) {
        const tipFee = params.estimatedTipFeeLamports ?? 250000n;
        const minBps = params.minProfitBps ?? 10; // Minimum 10 bps profit
        const maxLegs = params.maxLegs ?? 4;
        const cycles = [];
        const seenHashes = new Set();
        const root = params.rootToken;
        const notional = params.notionalLamports;
        // 1. Search 2-Leg Cycles: root -> B -> root
        const rootEdges = this.edges.get(root) || [];
        for (const e1 of rootEdges) {
            const bEdges = this.edges.get(e1.quoteToken) || [];
            for (const e2 of bEdges) {
                if (e2.quoteToken === root && e2.poolId !== e1.poolId) {
                    const cycle = this.evaluateCycle([e1, e2], notional, tipFee);
                    if (cycle.profitBps >= minBps && cycle.robustArbProfitLamports > 0n && !seenHashes.has(cycle.cycleHash)) {
                        seenHashes.add(cycle.cycleHash);
                        cycles.push(cycle);
                    }
                }
            }
        }
        // 2. Search 3-Leg Cycles: root -> B -> C -> root
        if (maxLegs >= 3) {
            for (const e1 of rootEdges) {
                const bEdges = this.edges.get(e1.quoteToken) || [];
                for (const e2 of bEdges) {
                    if (e2.quoteToken !== root && e2.poolId !== e1.poolId) {
                        const cEdges = this.edges.get(e2.quoteToken) || [];
                        for (const e3 of cEdges) {
                            if (e3.quoteToken === root &&
                                e3.poolId !== e1.poolId &&
                                e3.poolId !== e2.poolId) {
                                const cycle = this.evaluateCycle([e1, e2, e3], notional, tipFee);
                                if (cycle.profitBps >= minBps && cycle.robustArbProfitLamports > 0n && !seenHashes.has(cycle.cycleHash)) {
                                    seenHashes.add(cycle.cycleHash);
                                    cycles.push(cycle);
                                }
                            }
                        }
                    }
                }
            }
        }
        // 3. Search 4-Leg Cycles: root -> B -> C -> D -> root
        if (maxLegs >= 4) {
            for (const e1 of rootEdges) {
                const bEdges = this.edges.get(e1.quoteToken) || [];
                for (const e2 of bEdges) {
                    if (e2.quoteToken !== root && e2.poolId !== e1.poolId) {
                        const cEdges = this.edges.get(e2.quoteToken) || [];
                        for (const e3 of cEdges) {
                            if (e3.quoteToken !== root &&
                                e3.quoteToken !== e1.quoteToken &&
                                e3.poolId !== e1.poolId &&
                                e3.poolId !== e2.poolId) {
                                const dEdges = this.edges.get(e3.quoteToken) || [];
                                for (const e4 of dEdges) {
                                    if (e4.quoteToken === root &&
                                        e4.poolId !== e1.poolId &&
                                        e4.poolId !== e2.poolId &&
                                        e4.poolId !== e3.poolId) {
                                        const cycle = this.evaluateCycle([e1, e2, e3, e4], notional, tipFee);
                                        if (cycle.profitBps >= minBps && cycle.robustArbProfitLamports > 0n && !seenHashes.has(cycle.cycleHash)) {
                                            seenHashes.add(cycle.cycleHash);
                                            cycles.push(cycle);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        // Sort by robust net profit descending
        return Object.freeze(cycles.sort((a, b) => Number(b.robustArbProfitLamports - a.robustArbProfitLamports)));
    }
    /**
     * Section 20: Completion-Risk Arbitrage Evaluation & Exact Profit Math
     */
    evaluateCycle(legs, notionalInputLamports, tipFeeLamports) {
        let currentMultiplier = 1.0;
        let totalFeeBps = 0;
        let totalImpactBps = 0;
        let totalCompletionRiskBps = 0;
        for (const leg of legs) {
            currentMultiplier *= leg.rate;
            totalFeeBps += leg.feeBps;
            totalImpactBps += leg.impactBps;
            // Penalize low execution probability
            totalCompletionRiskBps += Math.floor((1.0 - leg.executionProbability) * 100);
        }
        const notionalNum = Number(notionalInputLamports);
        const grossSpreadRatio = currentMultiplier - 1.0;
        const grossSpreadLamports = BigInt(Math.floor(notionalNum * grossSpreadRatio));
        const totalFeesLamports = BigInt(Math.floor(notionalNum * (totalFeeBps / 10_000)));
        const slippageAndImpactLamports = BigInt(Math.floor(notionalNum * (totalImpactBps / 10_000)));
        const completionRiskLamports = BigInt(Math.floor(notionalNum * (totalCompletionRiskBps / 10_000)));
        // On Solana, multi-instruction transactions within a single atomic payload carry an AtomicityPremium.
        // Invariant: Atomicity premium is an execution risk bonus only awarded when the cycle has an intrinsically
        // positive gross spread; negative spread cycles can never be made artificially profitable by an atomicity bonus.
        const isSingleAtomicTransaction = legs.length <= 4;
        const atomicityPremiumLamports = (isSingleAtomicTransaction && grossSpreadRatio > 0)
            ? BigInt(Math.floor(notionalNum * 0.0015)) // 15 bps premium
            : 0n;
        // RobustArbProfit = grossSpread - fees - priorityTip - impact - slippage - completionRisk + atomicityPremium
        const totalDeductions = totalFeesLamports + tipFeeLamports + slippageAndImpactLamports + completionRiskLamports;
        const robustArbProfitLamports = grossSpreadLamports + atomicityPremiumLamports - totalDeductions;
        const profitBps = notionalNum > 0 ? (Number(robustArbProfitLamports) / notionalNum) * 10_000 : 0;
        const minLegCapacityLamports = legs.reduce((min, leg) => leg.availableCapacityLamports < min ? leg.availableCapacityLamports : min, legs[0]?.availableCapacityLamports ?? notionalInputLamports);
        const optimalNotionalLamports = notionalInputLamports < minLegCapacityLamports
            ? notionalInputLamports
            : minLegCapacityLamports;
        const payload = {
            legs: legs.map(l => l.edgeId),
            inputToken: legs[0].baseToken,
            outputToken: legs[legs.length - 1].quoteToken,
            notionalInputLamports,
            robustArbProfitLamports,
        };
        const cycleHash = hashCanonical(payload);
        const cycleId = `cycle_${legs.length}leg_${cycleHash.slice(0, 12)}`;
        return Object.freeze({
            cycleId,
            legs: Object.freeze([...legs]),
            inputToken: legs[0].baseToken,
            outputToken: legs[legs.length - 1].quoteToken,
            notionalInputLamports,
            grossSpreadLamports,
            totalFeesLamports,
            estimatedTipAndPriorityFeeLamports: tipFeeLamports,
            slippageAndImpactLamports,
            completionRiskLamports,
            isSingleAtomicTransaction,
            atomicityPremiumLamports,
            robustArbProfitLamports,
            profitBps,
            cycleHash,
            minLegCapacityLamports,
            optimalNotionalLamports,
        });
    }
}
//# sourceMappingURL=arbitrage-graph.js.map