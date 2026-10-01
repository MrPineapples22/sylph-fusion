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
        const launchId = record.launchId ?? `${record.slot ?? 0}:${record.mint}:${record.creatorAddress}`;
        const storedRecord = {
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
    recomputeActorProfile(actorId) {
        const pastLaunches = this.launchHistory.filter((l) => l.status === 'ACTIVE' && (l.creatorAddress === actorId || l.fundingAncestor === actorId));
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
        if (rugRate >= 60)
            rep = 10;
        else if (rugRate >= 30)
            rep = 30;
        else if (runnerRate >= 30 && rugRate < 20)
            rep = 85;
        const lastActive = Math.max(...pastLaunches.map(l => l.launchTimestampMs));
        const profile = {
            actorId,
            knownAddresses: Array.from(new Set(pastLaunches.flatMap((l) => [l.creatorAddress, l.fundingAncestor].filter((x) => !!x)))),
            totalLaunchesAssociated: total,
            rugOrDumpRatePct: Number(rugRate.toFixed(1)),
            runnerRatePct: Number(runnerRate.toFixed(1)),
            averageMfePct: Number(avgMfe.toFixed(1)),
            reputationScore: rep,
            lastActiveTimestampMs: lastActive,
        };
        this.actorProfiles.set(actorId, profile);
    }
    rollbackSlot(slot) {
        let rolledBackCount = 0;
        const affectedActors = new Set();
        for (const l of this.launchHistory) {
            if (l.slot === slot && l.status === 'ACTIVE') {
                l.status = 'RETRACTED';
                rolledBackCount++;
                affectedActors.add(l.creatorAddress);
                if (l.fundingAncestor)
                    affectedActors.add(l.fundingAncestor);
            }
        }
        for (const actor of affectedActors) {
            const actorId = this.addressToActorId.get(actor) ?? actor;
            this.recomputeActorProfile(actorId);
        }
        return rolledBackCount;
    }
    retractLaunch(launchId) {
        const l = this.launchHistory.find(rec => rec.launchId === launchId);
        if (!l || l.status !== 'ACTIVE')
            return false;
        l.status = 'RETRACTED';
        const actorId = this.addressToActorId.get(l.creatorAddress) ?? l.creatorAddress;
        this.recomputeActorProfile(actorId);
        return true;
    }
    getActiveLaunchesForActor(actorId) {
        return Object.freeze(this.launchHistory.filter(l => l.status === 'ACTIVE' && (l.creatorAddress === actorId || l.fundingAncestor === actorId)));
    }
    /**
     * Look up actor profile for a creator or funding ancestor address.
     */
    getActorProfileForAddress(address) {
        const actorId = this.addressToActorId.get(address) ?? address;
        return this.actorProfiles.get(actorId);
    }
    getActorProfile(actorId) {
        return this.actorProfiles.get(actorId) ?? this.getActorProfileForAddress(actorId);
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