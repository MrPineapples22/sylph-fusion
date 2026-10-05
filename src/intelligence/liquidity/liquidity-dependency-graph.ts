/**
 * SYLPH FUSION — LIQUIDITY DEPENDENCY GRAPH & JOINT PORTFOLIO EXITABILITY
 * Specifications: Blueprint Section 55
 *
 * Invariant:
 * 1. Holding exit capacity CANNOT be evaluated in isolation.
 * 2. Positions sharing common liquidity pools, routes, or programs create shared dependencies.
 * 3. Simultaneous exits must be stressed jointly; cumulative price impact must not breach threshold.
 */

export interface LiquidityNode {
  readonly nodeId: string;
  readonly nodeType: 'POSITION' | 'POOL' | 'ROUTE' | 'PROGRAM' | 'BASE_ASSET' | 'VENUE';
  readonly availableLiquidityLamports: bigint;
  readonly maxThroughputPerSlotLamports: bigint;
}

export interface LiquidityDependencyEdge {
  readonly fromPositionId: string;
  readonly toDependencyNodeId: string;
  readonly requiredLiquidityLamports: bigint;
}

export interface JointExitStressResult {
  readonly isFeasible: boolean;
  readonly totalNotionalLamports: bigint;
  readonly sharedBottlenecks: readonly string[];
  readonly maxContestedNodeUtilization: number;
  readonly estimatedSimultaneousPriceImpactBps: number;
  readonly evidenceRoot: string;
}

export class LiquidityDependencyGraph {
  private readonly nodes = new Map<string, LiquidityNode>();
  private readonly edges: LiquidityDependencyEdge[] = [];

  public addNode(node: LiquidityNode): void {
    this.nodes.set(node.nodeId, node);
  }

  public addEdge(edge: LiquidityDependencyEdge): void {
    this.edges.push(edge);
  }

  /**
   * Evaluates simultaneous portfolio liquidation across all active positions.
   */
  public stressSimultaneousExit(maxAcceptableImpactBps = 300): JointExitStressResult {
    const nodeDemands = new Map<string, bigint>();
    let totalNotionalLamports = 0n;

    for (const edge of this.edges) {
      const current = nodeDemands.get(edge.toDependencyNodeId) ?? 0n;
      nodeDemands.set(edge.toDependencyNodeId, current + edge.requiredLiquidityLamports);
      totalNotionalLamports += edge.requiredLiquidityLamports;
    }

    const bottlenecks: string[] = [];
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

      const utilization = Number((demand * 10_000n) / node.availableLiquidityLamports) / 10_000;
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
