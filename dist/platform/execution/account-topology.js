/**
 * SOL-SYLPH Platform - Account-Topology & Scheduler Contention Routing
 * Specifications: 500-Item Roadmap Layer I (#76, #78, #79), Layer II (#152, #153, #161, #164), Layer III (#291, #292, #295).
 *
 * Implements:
 * 1. AccountContentionGraph: Maps localized lock neighborhoods and writable account gravity wells.
 * 2. SchedulerCostEstimator: Models Agave banking scheduler cost, lock drag, and CU padding penalty.
 * 3. ExecutionPathTournamentV2: Competitively evaluates multi-router, direct curve, and RFQ execution routes.
 */
export class AccountContentionGraph {
    // Known high-contention Solana programs and global vaults
    static KNOWN_GRAVITY_WELLS = {
        '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': { name: 'PUMP_FUN_PROGRAM', weight: 4.5 },
        'CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM': { name: 'PUMP_FUN_FEE_ACCOUNT', weight: 5.0 },
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': { name: 'RAYDIUM_AMM_V4', weight: 3.5 },
        '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1': { name: 'RAYDIUM_AUTHORITY', weight: 4.0 },
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': { name: 'JUPITER_V6_PROGRAM', weight: 3.0 },
    };
    /**
     * Analyzes the account lock topology of a transaction and computes its contention gravity.
     */
    static analyzeTopology(accounts) {
        let writableCount = 0;
        let readonlyCount = 0;
        let contentionGravityScore = 0;
        const gravityWells = [];
        for (const acc of accounts) {
            if (acc.isWritable) {
                writableCount++;
                const known = this.KNOWN_GRAVITY_WELLS[acc.pubkey];
                if (known) {
                    contentionGravityScore += known.weight;
                    gravityWells.push(`${known.name} (${acc.pubkey.slice(0, 8)}...)`);
                }
                else if (acc.estimatedContentionTier === 'EXTREME') {
                    contentionGravityScore += 3.5;
                    gravityWells.push(`EXTREME_TIER (${acc.pubkey.slice(0, 8)}...)`);
                }
                else if (acc.estimatedContentionTier === 'HIGH') {
                    contentionGravityScore += 2.0;
                }
                else {
                    contentionGravityScore += 0.25; // baseline writable lock cost
                }
            }
            else {
                readonlyCount++;
                contentionGravityScore += 0.05; // minimal readonly contention
            }
        }
        // Lock drag multiplier scales with writable count and gravity wells
        const lockDragMultiplier = Number((1.0 + (writableCount * 0.12) + (contentionGravityScore * 0.18)).toFixed(3));
        return {
            totalAccounts: accounts.length,
            writableAccountCount: writableCount,
            readonlyAccountCount: readonlyCount,
            contentionGravityScore: Number(contentionGravityScore.toFixed(3)),
            gravityWells: Object.freeze(gravityWells),
            lockDragMultiplier,
        };
    }
}
export class SchedulerCostEstimator {
    /**
     * Models the Agave banking stage scheduler cost and execution aerodynamics.
     */
    static estimateCost(requestedCu, estimatedActualCu, topology) {
        const cuPaddingRatio = Number((requestedCu / Math.max(1, estimatedActualCu)).toFixed(2));
        const recommendations = [];
        // Excessive CU padding penalizes thread assignment under high cluster contention
        let paddingPenalty = 1.0;
        if (cuPaddingRatio > 2.5) {
            paddingPenalty = 1.35;
            recommendations.push(`Excessive CU padding (${cuPaddingRatio}x actual): reduce requested CU from ${requestedCu} closer to ${estimatedActualCu} + 20% margin`);
        }
        if (topology.writableAccountCount > 10) {
            recommendations.push(`High writable lock count (${topology.writableAccountCount}): transaction touches multiple concurrent state locks`);
        }
        if (topology.gravityWells.length > 0) {
            recommendations.push(`Transaction touches ${topology.gravityWells.length} gravity wells (${topology.gravityWells.join(', ')}); expect banking queue delay`);
        }
        // Scheduler Cost Score = RequestedCU * LockDrag * PaddingPenalty
        const schedulerCostScore = Math.round(requestedCu * topology.lockDragMultiplier * paddingPenalty);
        // Landing drag normalized score (0.0 to 1.0)
        const landingDragScore = Number(Math.min(1.0, Math.max(0.0, (schedulerCostScore / 500_000))).toFixed(3));
        const isAerodynamic = landingDragScore < 0.45 && topology.writableAccountCount <= 6;
        return {
            requestedComputeUnits: requestedCu,
            estimatedActualCu,
            cuPaddingRatio,
            schedulerCostScore,
            landingDragScore,
            isAerodynamic,
            recommendations: Object.freeze(recommendations),
        };
    }
}
export class ExecutionPathTournamentV2 {
    /**
     * Conducts an execution path tournament across competing venues and instruction layouts.
     * Selects the path maximizing net output per unit of scheduler contention.
     */
    static conductTournament(candidates) {
        if (candidates.length === 0) {
            throw new Error('TOURNAMENT_EMPTY: At least one candidate execution path is required');
        }
        const scoredPaths = candidates.map(c => {
            const topology = AccountContentionGraph.analyzeTopology(c.accounts);
            const costReport = SchedulerCostEstimator.estimateCost(c.requestedComputeUnits, c.estimatedActualCu, topology);
            // Total fee impact in lamports
            const totalFees = c.priorityFeeLamports + c.jitoTipLamports;
            const netOutput = c.expectedOutputLamports > totalFees
                ? c.expectedOutputLamports - totalFees
                : 0n;
            // Aerodynamics formula:
            // (NetOutput * LandingRate) / (SchedulerCostScore / 1000)
            const landingWeight = Math.max(0.1, c.historicalLandingRate);
            const schedulerWeight = Math.max(1, costReport.schedulerCostScore / 1000);
            const aerodynamicsScore = Number(((Number(netOutput) * landingWeight) / schedulerWeight).toFixed(2));
            return {
                rank: 0,
                pathId: c.pathId,
                venue: c.venue,
                expectedOutputLamports: c.expectedOutputLamports,
                schedulerCostScore: costReport.schedulerCostScore,
                aerodynamicsScore,
                contentionGravityScore: topology.contentionGravityScore,
                isWinner: false,
            };
        });
        // Sort by aerodynamics score descending
        scoredPaths.sort((a, b) => b.aerodynamicsScore - a.aerodynamicsScore);
        const ranked = scoredPaths.map((p, idx) => ({
            ...p,
            rank: idx + 1,
            isWinner: idx === 0,
        }));
        const winner = ranked[0];
        const rationale = `Winner: ${winner.venue} (${winner.pathId}) with score ${winner.aerodynamicsScore} (scheduler cost: ${winner.schedulerCostScore}, gravity: ${winner.contentionGravityScore})`;
        return {
            winner,
            rankings: Object.freeze(ranked),
            totalCandidates: candidates.length,
            rationale,
        };
    }
}
//# sourceMappingURL=account-topology.js.map