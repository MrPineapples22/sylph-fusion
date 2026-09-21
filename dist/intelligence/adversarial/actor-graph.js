/**
 * SOL-SYLPH Intelligence Fabric - Cross-Launch Actor Intelligence & Knowledge Graph
 * Specifications: Major Update #3 (Cross-Launch Actor Intelligence).
 *
 * Rules:
 * 1. Connects Wallets, Creators, Funders, Tokens, Deployments, Pools, Actor Clusters.
 * 2. Probabilistic behavioral grouping (no real-world identity claims).
 * 3. Measures launch recurrence, creator recurrence, and historical launch survival.
 */
export class ActorKnowledgeGraph {
    launchHistory = [];
    actorProfiles = new Map();
    addressToActorId = new Map();
    /**
     * Register a new or historical token launch into the ecosystem graph.
     */
    registerLaunch(record) {
        this.launchHistory.push(record);
        const actorId = record.fundingAncestor ?? record.creatorAddress;
        this.addressToActorId.set(record.creatorAddress, actorId);
        if (record.fundingAncestor) {
            this.addressToActorId.set(record.fundingAncestor, actorId);
        }
        const pastLaunches = this.launchHistory.filter((l) => l.creatorAddress === record.creatorAddress || (record.fundingAncestor && l.fundingAncestor === record.fundingAncestor));
        const total = pastLaunches.length;
        const rugs = pastLaunches.filter((l) => l.rapidLiquidityLoss || l.maePct >= 65).length;
        const runners = pastLaunches.filter((l) => l.mfePct >= 100).length;
        const sumMfe = pastLaunches.reduce((acc, l) => acc + l.mfePct, 0);
        const rugRate = total > 0 ? (rugs / total) * 100 : 0;
        const runnerRate = total > 0 ? (runners / total) * 100 : 0;
        const avgMfe = total > 0 ? sumMfe / total : 0;
        // Reputation score computation: high rug rate severely drops score
        let rep = 50;
        if (rugRate >= 60)
            rep = 10;
        else if (rugRate >= 30)
            rep = 30;
        else if (runnerRate >= 30 && rugRate < 20)
            rep = 85;
        const profile = {
            actorId,
            knownAddresses: Array.from(new Set(pastLaunches.flatMap((l) => [l.creatorAddress, l.fundingAncestor].filter((x) => !!x)))),
            totalLaunchesAssociated: total,
            rugOrDumpRatePct: Number(rugRate.toFixed(1)),
            runnerRatePct: Number(runnerRate.toFixed(1)),
            averageMfePct: Number(avgMfe.toFixed(1)),
            reputationScore: rep,
            lastActiveTimestampMs: record.launchTimestampMs,
        };
        this.actorProfiles.set(actorId, profile);
    }
    /**
     * Look up actor profile for a creator or funding ancestor address.
     */
    getActorProfileForAddress(address) {
        const actorId = this.addressToActorId.get(address) ?? address;
        return this.actorProfiles.get(actorId);
    }
    /**
     * Check for creator or actor recurrence across ecosystem launches.
     */
    evaluateRecurrenceRisk(creatorAddress, fundingAncestor) {
        const profile = this.getActorProfileForAddress(creatorAddress) ??
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
//# sourceMappingURL=actor-graph.js.map