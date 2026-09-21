/**
 * NEWTON: Universal Market Graph Engine
 * Blueprint Engine #4
 * 
 * Models market entities as an interconnected graph:
 * Nodes: Token, Wallet, WalletCluster, Creator, Pool, Program, Transaction, Position, Event.
 * Relationships: FUNDED, BOUGHT, SOLD, CREATED, TRANSFERRED, CO_ENTERED, CO_EXITED, PROVIDED_LIQUIDITY, REMOVED_LIQUIDITY.
 * Computes probabilistic wallet clustering and capital migration.
 */

export type NewtonNodeType = 
  | 'TOKEN'
  | 'WALLET'
  | 'WALLET_CLUSTER'
  | 'CREATOR'
  | 'POOL'
  | 'TRANSACTION';

export type NewtonEdgeType = 
  | 'FUNDED'
  | 'BOUGHT'
  | 'SOLD'
  | 'CREATED'
  | 'TRANSFERRED'
  | 'CO_ENTERED'
  | 'CO_EXITED'
  | 'PROVIDED_LIQUIDITY'
  | 'REMOVED_LIQUIDITY';

export interface NewtonNode {
  readonly id: string;
  readonly type: NewtonNodeType;
  readonly metadata: Record<string, any>;
  readonly created_at_ms: number;
  readonly last_active_ms: number;
}

export interface NewtonEdge {
  readonly source_id: string;
  readonly target_id: string;
  readonly type: NewtonEdgeType;
  readonly weight: number;
  readonly confidence: number; // 0.0 to 1.0 (probabilistic, never assumes certainty)
  readonly timestamp_ms: number;
  readonly volume_sol?: number;
}

export class NewtonMarketGraph {
  public static readonly VERSION = '1.0.0';
  private nodes: Map<string, NewtonNode> = new Map();
  private edges: NewtonEdge[] = [];
  private adjacency: Map<string, number[]> = new Map(); // node_id -> edge indices

  public addNode(id: string, type: NewtonNodeType, metadata: Record<string, any> = {}): NewtonNode {
    const now = Date.now();
    const node: NewtonNode = {
      id,
      type,
      metadata,
      created_at_ms: now,
      last_active_ms: now
    };
    this.nodes.set(id, node);
    if (!this.adjacency.has(id)) {
      this.adjacency.set(id, []);
    }
    return node;
  }

  public addEdge(
    sourceId: string,
    targetId: string,
    type: NewtonEdgeType,
    weight: number = 1.0,
    confidence: number = 1.0,
    volumeSol?: number
  ): NewtonEdge {
    if (!this.nodes.has(sourceId)) {
      this.addNode(sourceId, 'WALLET');
    }
    if (!this.nodes.has(targetId)) {
      this.addNode(targetId, 'TOKEN');
    }

    const edge: NewtonEdge = {
      source_id: sourceId,
      target_id: targetId,
      type,
      weight,
      confidence: Math.max(0, Math.min(1, confidence)),
      timestamp_ms: Date.now(),
      volume_sol: volumeSol
    };

    const idx = this.edges.length;
    this.edges.push(edge);

    this.adjacency.get(sourceId)?.push(idx);
    this.adjacency.get(targetId)?.push(idx);

    return edge;
  }

  /**
   * Computes cluster confidence between two wallets based on shared funding or co-entry.
   * Invariant: Never claim two wallets are definitively the same person without evidence (returns probability).
   */
  public getClusterConfidence(walletA: string, walletB: string): {
    readonly cluster_confidence: number;
    readonly shared_funders: readonly string[];
    readonly co_entered_tokens: readonly string[];
  } {
    if (walletA === walletB) {
      return { cluster_confidence: 1.0, shared_funders: [], co_entered_tokens: [] };
    }

    const fundersA = new Set<string>();
    const tokensA = new Set<string>();

    for (const edgeIdx of this.adjacency.get(walletA) ?? []) {
      const e = this.edges[edgeIdx];
      if (e.target_id === walletA && e.type === 'FUNDED') {
        fundersA.add(e.source_id);
      }
      if (e.source_id === walletA && e.type === 'BOUGHT') {
        tokensA.add(e.target_id);
      }
    }

    const sharedFunders: string[] = [];
    const coEntered: string[] = [];

    for (const edgeIdx of this.adjacency.get(walletB) ?? []) {
      const e = this.edges[edgeIdx];
      if (e.target_id === walletB && e.type === 'FUNDED' && fundersA.has(e.source_id)) {
        sharedFunders.push(e.source_id);
      }
      if (e.source_id === walletB && e.type === 'BOUGHT' && tokensA.has(e.target_id)) {
        coEntered.push(e.target_id);
      }
    }

    // Probabilistic scoring
    let prob = 0.05; // base prior
    if (sharedFunders.length > 0) prob += Math.min(0.60, sharedFunders.length * 0.40);
    if (coEntered.length > 0) prob += Math.min(0.30, coEntered.length * 0.10);

    return {
      cluster_confidence: Math.min(0.95, Number(prob.toFixed(3))), // Caps at 0.95, acknowledging residual uncertainty
      shared_funders: sharedFunders,
      co_entered_tokens: coEntered
    };
  }

  public getNodeCount(): number {
    return this.nodes.size;
  }

  public getEdgeCount(): number {
    return this.edges.length;
  }
}
