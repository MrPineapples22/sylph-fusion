/**
 * SYLPH FUSION — INDEPENDENT CAPITAL ORIGIN ACCELERATION (ICOA)
 * Specification: Master Blueprint Section XXX (Independent Capital Origin Acceleration)
 *
 * Priority Research Hypothesis:
 * Extreme winners show unusual acceleration in independent funding ancestry before price acceleration.
 *
 * ICOA(t) = d^2 / dt^2 [ N(IndependentFundingClusters) ]
 */

export interface WalletFundingNode {
  readonly walletAddress: string;
  readonly fundingRootAddress: string;
  readonly firstActiveTimestampMs: number;
}

export interface IcoaSnapshot {
  readonly timestampMs: number;
  readonly independentClusterCount: number;
  readonly clusterVelocity: number;      // d/dt N(Clusters)
  readonly icoaAcceleration: number;     // d^2/dt^2 N(Clusters)
  readonly organicExpansionScore: number;
}

export class FundingClusterEngine {
  private readonly clusterHistory: { timestampMs: number; count: number }[] = [];
  private readonly walletToRootMap = new Map<string, string>();
  private readonly activeClusters = new Set<string>();

  public registerWallet(node: WalletFundingNode): void {
    this.walletToRootMap.set(node.walletAddress, node.fundingRootAddress);
    this.activeClusters.add(node.fundingRootAddress);
  }

  public evaluateIcoa(timestampMs: number): IcoaSnapshot {
    const clusterCount = this.activeClusters.size;
    const prev = this.clusterHistory[this.clusterHistory.length - 1];
    const prev2 = this.clusterHistory[this.clusterHistory.length - 2];

    const dt = prev ? Math.max(1, (timestampMs - prev.timestampMs) / 1000) : 1;
    const clusterVelocity = prev ? (clusterCount - prev.count) / dt : 0;

    let icoaAcceleration = 0;
    if (prev && prev2) {
      const dtPrev = Math.max(1, (prev.timestampMs - prev2.timestampMs) / 1000);
      const prevVelocity = (prev.count - prev2.count) / dtPrev;
      icoaAcceleration = (clusterVelocity - prevVelocity) / dt;
    }

    this.clusterHistory.push({ timestampMs, count: clusterCount });
    if (this.clusterHistory.length > 200) this.clusterHistory.shift();

    // Organic expansion score: high velocity and positive acceleration indicates fresh independent capital
    const organicExpansionScore = Math.min(1.0, Math.max(0.0,
      (clusterVelocity > 0 ? 0.3 : 0.0) +
      (icoaAcceleration > 0 ? 0.4 : 0.0) +
      (clusterCount > 10 ? 0.3 : (clusterCount / 10) * 0.3)
    ));

    return {
      timestampMs,
      independentClusterCount: clusterCount,
      clusterVelocity: Number(clusterVelocity.toFixed(3)),
      icoaAcceleration: Number(icoaAcceleration.toFixed(3)),
      organicExpansionScore: Number(organicExpansionScore.toFixed(3)),
    };
  }
}
