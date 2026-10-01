/**
 * SOL-SYLPH Intelligence Fabric - Temporal Evidence Graph & Provenance Engine
 * Specifications: Parts VIII (Temporal Evidence Graph), IX (Graph Provenance),
 * XI (Behavioral Intelligence), XII (Motif & Cluster Detection), XIII (Graph Heat).
 */

export type GraphNodeType =
  | 'Wallet'
  | 'TokenAccount'
  | 'Mint'
  | 'Token'
  | 'Creator'
  | 'Program'
  | 'Pool'
  | 'Transaction'
  | 'Instruction'
  | 'Authority'
  | 'FundingSource'
  | 'BehaviorCluster'
  | 'Launch'
  | 'Execution'
  | 'Outcome';

export type GraphRelationshipType =
  | 'PAID_FEE_FOR'
  | 'TRANSFERRED_TO'
  | 'TRANSFERRED_FROM'
  | 'AUTHORIZED'
  | 'SIGNED'
  | 'CREATED'
  | 'FUNDED'
  | 'MINTED'
  | 'BURNED'
  | 'SWAPPED'
  | 'PROVIDED_LIQUIDITY'
  | 'REMOVED_LIQUIDITY'
  | 'CALLED_PROGRAM'
  | 'RECEIVED_FROM'
  | 'SHARED_FUNDER_WITH'
  | 'CO_TRADED_WITH'
  | 'ENTERED_WITH'
  | 'EXITED_WITH';

export type EvidenceClass = 'FACT' | 'DERIVED_FACT' | 'INFERENCE' | 'HYPOTHESIS';

export interface GraphNode {
  readonly id: string;
  readonly type: GraphNodeType;
  readonly label?: string;
  readonly firstSeenMs: number;
  lastSeenMs: number;
  activityCount: number;
  heat: number; // 0.0 to 1.0 dynamic focus metric
}

export interface EdgeContribution {
  readonly slot: number;
  readonly amountSol: number;
  readonly timestampMs: number;
  readonly supportingEventId?: string;
}

export interface GraphEdge {
  readonly edgeId: string;
  readonly sourceNode: string;
  readonly targetNode: string;
  readonly relationship: GraphRelationshipType;
  readonly firstSeenMs: number;
  lastSeenMs: number;
  readonly firstSlot: number;
  lastSlot: number;
  observationCount: number;
  transactionCount: number;
  amountTotalSol: number;
  confidence: number; // 0.0 to 1.0
  readonly evidenceClass: EvidenceClass;
  readonly supportingEventIds: string[];
  readonly inferenceRule?: string;
  readonly inferenceVersion?: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
  active: boolean;
  contributions: EdgeContribution[];
}

export interface GraphHeatScore {
  readonly nodeId: string;
  readonly heat: number;
  readonly isHot: boolean;
  readonly recentActivityCount: number;
  readonly capitalFlowSol: number;
}

export class TemporalEvidenceGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges = new Map<string, GraphEdge>();
  private readonly outgoingEdges = new Map<string, Set<string>>(); // source -> Set<edgeId>
  private readonly incomingEdges = new Map<string, Set<string>>(); // target -> Set<edgeId>

  public addNode(id: string, type: GraphNodeType, label?: string): GraphNode {
    const existing = this.nodes.get(id);
    if (existing) {
      existing.lastSeenMs = Date.now();
      existing.activityCount++;
      return existing;
    }
    const node: GraphNode = {
      id,
      type,
      label,
      firstSeenMs: Date.now(),
      lastSeenMs: Date.now(),
      activityCount: 1,
      heat: 0.5,
    };
    this.nodes.set(id, node);
    return node;
  }

  public addOrUpdateEdge(params: {
    sourceNode: string;
    targetNode: string;
    relationship: GraphRelationshipType;
    evidenceClass: EvidenceClass;
    slot: number;
    amountSol?: number;
    confidence?: number;
    supportingEventId?: string;
    inferenceRule?: string;
    commitment?: 'processed' | 'confirmed' | 'finalized';
  }): GraphEdge {
    const edgeKey = `${params.sourceNode}->${params.relationship}->${params.targetNode}`;
    const now = Date.now();
    const contribution: EdgeContribution = {
      slot: params.slot,
      amountSol: params.amountSol ?? 0,
      timestampMs: now,
      supportingEventId: params.supportingEventId,
    };
    const existing = this.edges.get(edgeKey);

    if (existing) {
      existing.contributions.push(contribution);
      existing.lastSeenMs = now;
      existing.lastSlot = Math.max(existing.lastSlot, params.slot);
      existing.observationCount++;
      existing.transactionCount++;
      existing.amountTotalSol += params.amountSol ?? 0;
      if (params.supportingEventId && !existing.supportingEventIds.includes(params.supportingEventId)) {
        existing.supportingEventIds.push(params.supportingEventId);
      }
      if (params.commitment) {
        existing.commitment = params.commitment;
      }
      const srcNode = this.nodes.get(params.sourceNode);
      if (srcNode) srcNode.activityCount++;
      const tgtNode = this.nodes.get(params.targetNode);
      if (tgtNode) tgtNode.activityCount++;

      this.decayOrBoostHeat(params.sourceNode, 0.1);
      this.decayOrBoostHeat(params.targetNode, 0.1);
      return existing;
    }

    const srcNode = this.nodes.get(params.sourceNode);
    if (srcNode) srcNode.activityCount++;
    const tgtNode = this.nodes.get(params.targetNode);
    if (tgtNode) tgtNode.activityCount++;

    const edge: GraphEdge = {
      edgeId: edgeKey,
      sourceNode: params.sourceNode,
      targetNode: params.targetNode,
      relationship: params.relationship,
      firstSeenMs: now,
      lastSeenMs: now,
      firstSlot: params.slot,
      lastSlot: params.slot,
      observationCount: 1,
      transactionCount: 1,
      amountTotalSol: params.amountSol ?? 0,
      confidence: params.confidence ?? (params.evidenceClass === 'FACT' ? 1.0 : 0.8),
      evidenceClass: params.evidenceClass,
      supportingEventIds: params.supportingEventId ? [params.supportingEventId] : [],
      inferenceRule: params.inferenceRule,
      commitment: params.commitment ?? 'confirmed',
      active: true,
      contributions: [contribution],
    };

    this.edges.set(edgeKey, edge);

    // Track adjacency
    if (!this.outgoingEdges.has(params.sourceNode)) {
      this.outgoingEdges.set(params.sourceNode, new Set());
    }
    this.outgoingEdges.get(params.sourceNode)!.add(edgeKey);

    if (!this.incomingEdges.has(params.targetNode)) {
      this.incomingEdges.set(params.targetNode, new Set());
    }
    this.incomingEdges.get(params.targetNode)!.add(edgeKey);

    this.decayOrBoostHeat(params.sourceNode, 0.15);
    this.decayOrBoostHeat(params.targetNode, 0.15);

    return edge;
  }

  public rollbackSlotEdges(slot: number): number {
    let rolledBackCount = 0;
    for (const [edgeKey, edge] of this.edges.entries()) {
      if (!edge.active) continue;
      const matchingContribs = edge.contributions.filter(c => c.slot === slot);
      if (matchingContribs.length === 0) continue;

      const removedAmount = matchingContribs.reduce((sum, c) => sum + c.amountSol, 0);
      const removedEventIds = new Set(matchingContribs.map(c => c.supportingEventId).filter(Boolean));

      edge.contributions = edge.contributions.filter(c => c.slot !== slot);
      edge.amountTotalSol = Math.max(0, edge.amountTotalSol - removedAmount);
      edge.observationCount = Math.max(0, edge.observationCount - matchingContribs.length);
      edge.transactionCount = Math.max(0, edge.transactionCount - matchingContribs.length);

      if (removedEventIds.size > 0) {
        for (let i = edge.supportingEventIds.length - 1; i >= 0; i--) {
          if (removedEventIds.has(edge.supportingEventIds[i])) {
            edge.supportingEventIds.splice(i, 1);
          }
        }
      }

      // Decrement node activity
      const srcNode = this.nodes.get(edge.sourceNode);
      if (srcNode) {
        srcNode.activityCount = Math.max(0, srcNode.activityCount - matchingContribs.length);
        this.decayOrBoostHeat(edge.sourceNode, -0.1 * matchingContribs.length);
      }
      const tgtNode = this.nodes.get(edge.targetNode);
      if (tgtNode) {
        tgtNode.activityCount = Math.max(0, tgtNode.activityCount - matchingContribs.length);
        this.decayOrBoostHeat(edge.targetNode, -0.1 * matchingContribs.length);
      }

      if (edge.contributions.length === 0) {
        edge.active = false;
      } else {
        edge.lastSlot = Math.max(...edge.contributions.map(c => c.slot));
        edge.lastSeenMs = Math.max(...edge.contributions.map(c => c.timestampMs));
      }
      rolledBackCount++;
    }
    return rolledBackCount;
  }

  public getNeighbors(nodeId: string): string[] {
    const outKeys = this.outgoingEdges.get(nodeId) ?? new Set();
    const inKeys = this.incomingEdges.get(nodeId) ?? new Set();
    const neighbors = new Set<string>();

    for (const k of outKeys) {
      const e = this.edges.get(k);
      if (e && e.active) neighbors.add(e.targetNode);
    }
    for (const k of inKeys) {
      const e = this.edges.get(k);
      if (e && e.active) neighbors.add(e.sourceNode);
    }
    return Array.from(neighbors);
  }

  public getHeat(nodeId: string): GraphHeatScore {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return { nodeId, heat: 0, isHot: false, recentActivityCount: 0, capitalFlowSol: 0 };
    }
    const outEdges = Array.from(this.outgoingEdges.get(nodeId) ?? [])
      .map((k) => this.edges.get(k))
      .filter((e): e is GraphEdge => !!e && e.active);
    const flow = outEdges.reduce((acc, e) => acc + e.amountTotalSol, 0);

    return {
      nodeId,
      heat: Number(node.heat.toFixed(3)),
      isHot: node.heat >= 0.7,
      recentActivityCount: node.activityCount,
      capitalFlowSol: Number(flow.toFixed(3)),
    };
  }

  public getSummary(): {
    nodeCount: number;
    edgeCount: number;
    activeEdgeCount: number;
    hotNodesCount: number;
  } {
    let activeEdges = 0;
    for (const e of this.edges.values()) {
      if (e.active) activeEdges++;
    }
    let hotNodes = 0;
    for (const n of this.nodes.values()) {
      if (n.heat >= 0.7) hotNodes++;
    }
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      activeEdgeCount: activeEdges,
      hotNodesCount: hotNodes,
    };
  }

  private decayOrBoostHeat(nodeId: string, delta: number): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.heat = Math.min(1.0, Math.max(0.0, node.heat + delta));
    }
  }
}
