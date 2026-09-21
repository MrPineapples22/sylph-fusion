/**
 * SOL-SYLPH Machine-Readable Dependency & Impact Graph
 * Specifications: Parts XIII, LXXVII, LXXVIII
 *
 * Enforces:
 * 1. Explicit bidirectional dependency tracking between fields, signals, models, and UI surfaces.
 * 2. Incremental recomputation triggers.
 * 3. Freshness degradation propagation.
 * 4. Health failure impact propagation (e.g. DexScreener 429 -> liquidity aging -> HSI degraded -> protection review).
 */

export interface GraphNode {
  readonly nodeId: string;
  readonly name: string;
  readonly category: 'SOURCE' | 'FACT' | 'SIGNAL' | 'MODEL' | 'POLICY' | 'PROTECTION' | 'UI';
  readonly upstreamDependencies: readonly string[];
  readonly downstreamDependents: readonly string[];
  status: 'HEALTHY' | 'AGING' | 'STALE' | 'DEGRADED' | 'FAILED';
  lastEvaluatedMs: number;
}

export class DependencyImpactGraph {
  private readonly nodes = new Map<string, GraphNode>();

  constructor() {
    this.initializeStandardTopology();
  }

  public registerNode(params: {
    nodeId: string;
    name: string;
    category: GraphNode['category'];
    upstreamDependencies?: readonly string[];
  }): GraphNode {
    const upstream = params.upstreamDependencies ?? [];
    const node: GraphNode = {
      nodeId: params.nodeId,
      name: params.name,
      category: params.category,
      upstreamDependencies: upstream,
      downstreamDependents: [],
      status: 'HEALTHY',
      lastEvaluatedMs: Date.now(),
    };

    this.nodes.set(params.nodeId, node);

    // Register reverse link
    for (const depId of upstream) {
      const parent = this.nodes.get(depId);
      if (parent) {
        if (!parent.downstreamDependents.includes(params.nodeId)) {
          (parent.downstreamDependents as string[]).push(params.nodeId);
        }
      }
    }

    return node;
  }

  public getNode(nodeId: string): GraphNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Part XIII & LXXVIII: Propagates a source degradation or failure through all downstream nodes.
   * Returns list of affected node IDs.
   */
  public propagateFailure(startNodeId: string, status: GraphNode['status']): readonly string[] {
    const startNode = this.nodes.get(startNodeId);
    if (!startNode) return [];

    const affected: string[] = [];
    const queue: string[] = [startNodeId];
    const visited = new Set<string>();

    startNode.status = status;
    startNode.lastEvaluatedMs = Date.now();
    affected.push(startNodeId);
    visited.add(startNodeId);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = this.nodes.get(currentId);
      if (!current) continue;

      for (const childId of current.downstreamDependents) {
        if (!visited.has(childId)) {
          visited.add(childId);
          const child = this.nodes.get(childId);
          if (child) {
            // Degrade child proportionally
            if (status === 'FAILED') {
              child.status = child.category === 'UI' ? 'DEGRADED' : 'DEGRADED';
            } else if (status === 'STALE') {
              child.status = child.status === 'HEALTHY' ? 'AGING' : child.status;
            }
            child.lastEvaluatedMs = Date.now();
            affected.push(childId);
            queue.push(childId);
          }
        }
      }
    }

    return affected;
  }

  /**
   * Calculates what downstream systems will be impacted if a given node fails.
   */
  public getImpactSurface(nodeId: string): {
    affectedSignals: readonly string[];
    affectedPolicies: readonly string[];
    affectedUI: readonly string[];
  } {
    const affectedSignals: string[] = [];
    const affectedPolicies: string[] = [];
    const affectedUI: string[] = [];

    const queue: string[] = [nodeId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = this.nodes.get(currentId);
      if (!current) continue;

      for (const childId of current.downstreamDependents) {
        if (!visited.has(childId)) {
          visited.add(childId);
          const child = this.nodes.get(childId);
          if (child) {
            if (child.category === 'SIGNAL') affectedSignals.push(child.nodeId);
            if (child.category === 'POLICY' || child.category === 'PROTECTION') affectedPolicies.push(child.nodeId);
            if (child.category === 'UI') affectedUI.push(child.nodeId);
            queue.push(childId);
          }
        }
      }
    }

    return { affectedSignals, affectedPolicies, affectedUI };
  }

  private initializeStandardTopology(): void {
    // Sources
    this.registerNode({ nodeId: 'src_pumpportal', name: 'PumpPortal WS', category: 'SOURCE' });
    this.registerNode({ nodeId: 'src_solana_rpc', name: 'Solana RPC', category: 'SOURCE' });
    this.registerNode({ nodeId: 'src_rugcheck', name: 'RugCheck API', category: 'SOURCE' });
    this.registerNode({ nodeId: 'src_dexscreener', name: 'DexScreener API', category: 'SOURCE' });
    this.registerNode({ nodeId: 'src_jupiter', name: 'Jupiter Quote API', category: 'SOURCE' });

    // Facts
    this.registerNode({ nodeId: 'fact_price', name: 'Price Authority', category: 'FACT', upstreamDependencies: ['src_pumpportal', 'src_dexscreener'] });
    this.registerNode({ nodeId: 'fact_liquidity', name: 'Liquidity Reserves', category: 'FACT', upstreamDependencies: ['src_pumpportal', 'src_dexscreener'] });
    this.registerNode({ nodeId: 'fact_wallets', name: 'Wallet Events', category: 'FACT', upstreamDependencies: ['src_pumpportal', 'src_solana_rpc'] });
    this.registerNode({ nodeId: 'fact_security', name: 'Token Capabilities', category: 'FACT', upstreamDependencies: ['src_solana_rpc', 'src_rugcheck'] });

    // Signals
    this.registerNode({ nodeId: 'sig_hsi', name: 'HSI Signal', category: 'SIGNAL', upstreamDependencies: ['fact_price', 'fact_liquidity', 'fact_wallets'] });
    this.registerNode({ nodeId: 'sig_pump', name: 'PumpScore', category: 'SIGNAL', upstreamDependencies: ['fact_price', 'fact_liquidity'] });
    this.registerNode({ nodeId: 'sig_pod', name: 'PoD Overhang', category: 'SIGNAL', upstreamDependencies: ['fact_wallets', 'fact_liquidity'] });
    this.registerNode({ nodeId: 'sig_clean_room', name: 'Clean-Room Decontamination', category: 'SIGNAL', upstreamDependencies: ['fact_wallets'] });

    // Models & Policies
    this.registerNode({ nodeId: 'mod_world', name: 'World Model', category: 'MODEL', upstreamDependencies: ['sig_hsi', 'sig_pump', 'sig_clean_room'] });
    this.registerNode({ nodeId: 'pol_protection', name: 'Protection Lease', category: 'PROTECTION', upstreamDependencies: ['fact_security', 'sig_hsi', 'sig_pod'] });
    this.registerNode({ nodeId: 'pol_execution', name: 'Execution Authorization', category: 'POLICY', upstreamDependencies: ['pol_protection', 'mod_world', 'src_jupiter'] });

    // UI Projections
    this.registerNode({ nodeId: 'ui_aether_flux', name: 'Aether Flux Table', category: 'UI', upstreamDependencies: ['fact_price', 'sig_hsi', 'sig_pump', 'pol_protection'] });
    this.registerNode({ nodeId: 'ui_inspector', name: 'Token Intelligence Inspector', category: 'UI', upstreamDependencies: ['mod_world', 'sig_clean_room', 'pol_execution'] });
  }
}
