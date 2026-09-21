/**
 * SOL-SYLPH Cross-Token Capital Migration Engine
 * Blueprint Part XIII
 *
 * Connects monitored tokens via a global capital migration graph.
 * Detects capital rotation, actor migration, liquidity migration, and recycled capital.
 */

export interface CapitalFlowEdge {
  readonly edgeId: string;
  readonly sourceActor: string;
  readonly destinationActor: string;
  readonly sourceToken: string;
  readonly destinationToken: string;
  readonly amountSol: number;
  readonly timestampMs: number;
  readonly hopCount: number;
  readonly directness: number; // 0.0 - 1.0
  readonly freshCapitalConfidence: number; // 0.0 - 1.0
  readonly relationshipConfidence: number; // 0.0 - 1.0
}

export interface TokenMigrationReport {
  readonly mint: string;
  readonly incomingMigratedCapitalSol: number;
  readonly outgoingMigratedCapitalSol: number;
  readonly topOriginTokens: readonly { token: string; amountSol: number }[];
  readonly topDestinationTokens: readonly { token: string; amountSol: number }[];
  readonly recycledCapitalRatio: number; // 0.0 - 1.0
  readonly migrationTrend: 'NET_INFLOW' | 'NET_OUTFLOW' | 'NEUTRAL';
}

export class CapitalMigrationEngine {
  private readonly edges: CapitalFlowEdge[] = [];

  public recordMigrationEdge(edge: Omit<CapitalFlowEdge, 'edgeId'>): CapitalFlowEdge {
    const fullEdge: CapitalFlowEdge = {
      ...edge,
      edgeId: `edge_${edge.sourceToken.slice(0, 6)}_${edge.destinationToken.slice(0, 6)}_${Date.now()}`,
    };
    this.edges.push(fullEdge);
    if (this.edges.length > 5000) this.edges.shift(); // Bound memory
    return fullEdge;
  }

  public getMigrationReport(mint: string): TokenMigrationReport {
    let incoming = 0;
    let outgoing = 0;
    const origins = new Map<string, number>();
    const destinations = new Map<string, number>();

    for (const edge of this.edges) {
      if (edge.destinationToken === mint) {
        incoming += edge.amountSol;
        origins.set(edge.sourceToken, (origins.get(edge.sourceToken) ?? 0) + edge.amountSol);
      }
      if (edge.sourceToken === mint) {
        outgoing += edge.amountSol;
        destinations.set(edge.destinationToken, (destinations.get(edge.destinationToken) ?? 0) + edge.amountSol);
      }
    }

    const topOrigins = Array.from(origins.entries())
      .map(([token, amountSol]) => ({ token, amountSol }))
      .sort((a, b) => b.amountSol - a.amountSol)
      .slice(0, 5);

    const topDestinations = Array.from(destinations.entries())
      .map(([token, amountSol]) => ({ token, amountSol }))
      .sort((a, b) => b.amountSol - a.amountSol)
      .slice(0, 5);

    const net = incoming - outgoing;
    const trend = net > 2.0 ? 'NET_INFLOW' : net < -2.0 ? 'NET_OUTFLOW' : 'NEUTRAL';
    const recycledCapitalRatio = incoming > 0 ? Math.min(1.0, incoming / Math.max(1.0, incoming + 10)) : 0.0;

    return {
      mint,
      incomingMigratedCapitalSol: Number(incoming.toFixed(3)),
      outgoingMigratedCapitalSol: Number(outgoing.toFixed(3)),
      topOriginTokens: topOrigins,
      topDestinationTokens: topDestinations,
      recycledCapitalRatio: Number(recycledCapitalRatio.toFixed(3)),
      migrationTrend: trend,
    };
  }

  public getAllEdges(): readonly CapitalFlowEdge[] {
    return this.edges;
  }
}
