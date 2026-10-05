/**
 * SYLPH FUSION — LIQUIDITY DEPENDENCY GRAPH & JOINT PORTFOLIO EXITABILITY
 * Specifications: Blueprint Section 55
 *
 * Invariant:
 * 1. Holding exit capacity CANNOT be evaluated in isolation.
 * 2. Positions sharing common liquidity pools, routes, or programs create shared dependencies.
 * 3. Simultaneous exits must be stressed jointly; cumulative price impact must not breach threshold.
 */
export class LiquidityDependencyGraph {
    nodes = new Map();
    edges = [];
    addNode(node) {
        this.nodes.set(node.nodeId, node);
    }
    addEdge(edge) {
        this.edges.push(edge);
    }
    /**
     * Evaluates simultaneous portfolio liquidation across all active positions.
     */
    stressSimultaneousExit(maxAcceptableImpactBps = 300) {
        const nodeDemands = new Map();
        let totalNotionalLamports = 0n;
        for (const edge of this.edges) {
            const current = nodeDemands.get(edge.toDependencyNodeId) ?? 0n;
            nodeDemands.set(edge.toDependencyNodeId, current + edge.requiredLiquidityLamports);
            totalNotionalLamports += edge.requiredLiquidityLamports;
        }
        const bottlenecks = [];
        let maxUtilization = 0;
        let worstNodeImpactBps = 0;
        for (const [nodeId, demand] of nodeDemands) {
            const node = this.nodes.get(nodeId);
            if (!node) {
                bottlenecks.push(`UNKNOWN_NODE:${nodeId}`);
                continue;
            }
            if (node.availableLiquidityLamports <= 0n) {
                bottlenecks.push(`ZERO_LIQUIDITY:${nodeId}`);
                maxUtilization = Math.max(maxUtilization, 1.0);
                worstNodeImpactBps = Math.max(worstNodeImpactBps, 10_000);
                continue;
            }
            const utilization = Number((demand * 10000n) / node.availableLiquidityLamports) / 10_000;
            if (utilization > maxUtilization) {
                maxUtilization = utilization;
            }
            // Nonlinear price impact heuristic: impact ~= (demand / liquidity)^2 * 1000 bps
            const estimatedImpactBps = Math.round(Math.pow(Math.min(utilization, 2.0), 2) * 1000);
            if (estimatedImpactBps > worstNodeImpactBps) {
                worstNodeImpactBps = estimatedImpactBps;
            }
            if (demand > node.maxThroughputPerSlotLamports || utilization > 0.6) {
                bottlenecks.push(nodeId);
            }
        }
        const isFeasible = bottlenecks.length === 0 && worstNodeImpactBps <= maxAcceptableImpactBps;
        return {
            isFeasible,
            totalNotionalLamports,
            sharedBottlenecks: bottlenecks,
            maxContestedNodeUtilization: Number(maxUtilization.toFixed(4)),
            estimatedSimultaneousPriceImpactBps: worstNodeImpactBps,
            evidenceRoot: `ev_liq_dep_${totalNotionalLamports.toString()}_${Date.now()}`,
        };
    }
}
//# sourceMappingURL=liquidity-dependency-graph.js.map