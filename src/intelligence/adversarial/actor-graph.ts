/**
 * SOL-SYLPH Intelligence Fabric - Cross-Launch Actor Intelligence & Knowledge Graph
 * Specifications: Major Update #3 (Cross-Launch Actor Intelligence).
 *
 * Rules:
 * 1. Connects Wallets, Creators, Funders, Tokens, Deployments, Pools, Actor Clusters.
 * 2. Probabilistic behavioral grouping (no real-world identity claims).
 * 3. Measures launch recurrence, creator recurrence, and historical launch survival.
 */

export interface HistoricalLaunchRecord {
  readonly launchId?: string;
  readonly slot?: number;
  readonly mint: string;
  readonly creatorAddress: string;
  readonly fundingAncestor?: string;
  readonly launchTimestampMs: number;
  readonly mfePct: number;
  readonly maePct: number;
  readonly survivedMigration: boolean;
  readonly rapidLiquidityLoss: boolean; // Rug / hard dump within 60s
  status?: 'ACTIVE' | 'RETRACTED' | 'SUPERSEDED';
}

export interface ActorProfile {
  readonly actorId: string;
  readonly knownAddresses: readonly string[];
  readonly totalLaunchesAssociated: number;
  readonly rugOrDumpRatePct: number;
  readonly runnerRatePct: number;
  readonly averageMfePct: number;
  readonly reputationScore: number; // 0 (toxic/serial rugger) to 100 (proven builder)
  readonly lastActiveTimestampMs: number;
}

export class ActorKnowledgeGraph {
  private readonly launchHistory: HistoricalLaunchRecord[] = [];
  private readonly actorProfiles = new Map<string, ActorProfile>();
  private readonly addressToActorId = new Map<string, string>();

  /**
   * Register a new or historical token launch into the ecosystem graph.
   */
  public registerLaunch(record: HistoricalLaunchRecord): void {
    const launchId = record.launchId ?? `${record.slot ?? 0}:${record.mint}:${record.creatorAddress}`;
    const storedRecord: HistoricalLaunchRecord = {
      ...record,
      launchId,
      status: record.status ?? 'ACTIVE',
    };
    this.launchHistory.push(storedRecord);

    const actorId = record.fundingAncestor ?? record.creatorAddress;
    this.addressToActorId.set(record.creatorAddress, actorId);
    if (record.fundingAncestor) {
      this.addressToActorId.set(record.fundingAncestor, actorId);
    }

    this.recomputeActorProfile(actorId);
  }

  private recomputeActorProfile(actorId: string): void {
    const pastLaunches = this.launchHistory.filter(
      (l) => l.status === 'ACTIVE' && (l.creatorAddress === actorId || l.fundingAncestor === actorId)
    );

    const total = pastLaunches.length;
    if (total === 0) {
      this.actorProfiles.delete(actorId);
      return;
    }

    const rugs = pastLaunches.filter((l) => l.rapidLiquidityLoss || l.maePct >= 65).length;
    const runners = pastLaunches.filter((l) => l.mfePct >= 100).length;
    const sumMfe = pastLaunches.reduce((acc, l) => acc + l.mfePct, 0);

    const rugRate = (rugs / total) * 100;
    const runnerRate = (runners / total) * 100;
    const avgMfe = sumMfe / total;

    // Reputation score computation: high rug rate severely drops score
    let rep = 50;
    if (rugRate >= 60) rep = 10;
    else if (rugRate >= 30) rep = 30;
    else if (runnerRate >= 30 && rugRate < 20) rep = 85;

    const lastActive = Math.max(...pastLaunches.map(l => l.launchTimestampMs));

    const profile: ActorProfile = {
      actorId,
      knownAddresses: Array.from(new Set(pastLaunches.flatMap((l) => [l.creatorAddress, l.fundingAncestor].filter((x): x is string => !!x)))),
      totalLaunchesAssociated: total,
      rugOrDumpRatePct: Number(rugRate.toFixed(1)),
      runnerRatePct: Number(runnerRate.toFixed(1)),
      averageMfePct: Number(avgMfe.toFixed(1)),
      reputationScore: rep,
      lastActiveTimestampMs: lastActive,
    };

    this.actorProfiles.set(actorId, profile);
  }

  public rollbackSlot(slot: number): number {
    let rolledBackCount = 0;
    const affectedActors = new Set<string>();

    for (const l of this.launchHistory) {
      if (l.slot === slot && l.status === 'ACTIVE') {
        l.status = 'RETRACTED';
        rolledBackCount++;
        affectedActors.add(l.creatorAddress);
        if (l.fundingAncestor) affectedActors.add(l.fundingAncestor);
      }
    }

    for (const actor of affectedActors) {
      const actorId = this.addressToActorId.get(actor) ?? actor;
      this.recomputeActorProfile(actorId);
    }

    return rolledBackCount;
  }

  public retractLaunch(launchId: string): boolean {
    const l = this.launchHistory.find(rec => rec.launchId === launchId);
    if (!l || l.status !== 'ACTIVE') return false;
    l.status = 'RETRACTED';
    const actorId = this.addressToActorId.get(l.creatorAddress) ?? l.creatorAddress;
    this.recomputeActorProfile(actorId);
    return true;
  }

  public getActiveLaunchesForActor(actorId: string): readonly HistoricalLaunchRecord[] {
    return Object.freeze(this.launchHistory.filter(
      l => l.status === 'ACTIVE' && (l.creatorAddress === actorId || l.fundingAncestor === actorId)
    ));
  }

  /**
   * Look up actor profile for a creator or funding ancestor address.
   */
  public getActorProfileForAddress(address: string): ActorProfile | undefined {
    const actorId = this.addressToActorId.get(address) ?? address;
    return this.actorProfiles.get(actorId);
  }

  public getActorProfile(actorId: string): ActorProfile | undefined {
    return this.actorProfiles.get(actorId) ?? this.getActorProfileForAddress(actorId);
  }

  /**
   * Check for creator or actor recurrence across ecosystem launches.
   */
  public evaluateRecurrenceRisk(creatorAddress: string, fundingAncestor?: string): {
    isSerialRugger: boolean;
    launchesCount: number;
    rugRatePct: number;
    reputationScore: number;
  } {
    const profile =
      this.getActorProfileForAddress(creatorAddress) ??
      (fundingAncestor ? this.getActorProfileForAddress(fundingAncestor) : undefined);

    if (!profile) {
      return {
        isSerialRugger: false,
        launchesCount: 0,
        rugRatePct: 0,
        reputationScore: 50, // Neutral unknown
      };
    }

    return {
      isSerialRugger: profile.totalLaunchesAssociated >= 2 && profile.rugOrDumpRatePct >= 50,
      launchesCount: profile.totalLaunchesAssociated,
      rugRatePct: profile.rugOrDumpRatePct,
      reputationScore: profile.reputationScore,
    };
  }
}
