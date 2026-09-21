/**
 * SOL-SYLPH Adversarial Search & Failure/Resilience Library
 * Blueprint Parts XXX, LIII
 *
 * Constrained search asking: What plausible sequence breaks the current thesis?
 * Calculates MinimumFailureShock, FailurePath, CascadeSusceptibility, RecoveryHalfLife.
 * Stores recurring failure and resilience mechanisms.
 */
export class AdversarialSearcher {
    failureLibrary = [
        {
            mechanismId: 'fail_drain_sequence',
            mechanismType: 'FAILURE_CASCADE',
            description: 'Fresh capital slows → related capital increases → large cluster distributes → liquidity weakens → collapse',
            triggerCondition: 'freshCapitalVelocity < 0 && topClusterShare > 40%',
            sequenceSteps: [
                'Fresh capital inflow drops below 0.1 SOL/s',
                'Top cluster begins dumping inventory via 3 unlinked addresses',
                'Pool real reserves drop below 50%',
                'Slippage increases past 15%, trapping retail holders',
                'Liquidity exhaustion and thesis invalidation',
            ],
            historicalFrequency: 0.72,
        },
        {
            mechanismId: 'resilience_absorption_sequence',
            mechanismType: 'RESILIENCE_ABSORPTION',
            description: 'Whale sells → independent actors absorb → liquidity persists → concentration improves → recovery',
            triggerCondition: 'sellPressure > 2.0 && actorGrowthVelocity > 0.5',
            sequenceSteps: [
                'Early whale takes profit (-5 SOL)',
                'Incoming stream of 10+ independent retail buyers absorbs sell order',
                'Top 1 holder concentration drops from 30% to 12%',
                'Liquidity deepens and price stabilizes at support',
            ],
            historicalFrequency: 0.28,
        },
    ];
    searchAdversarialScenarios(params) {
        const mint = params.mint;
        const realLiq = Math.max(0.1, params.realLiquiditySol);
        const clusterHoldings = params.topClusterHoldingSol;
        // Minimum shock to cause >35% price collapse or pool exhaustion
        const minShock = realLiq * 0.25;
        const failurePath = [
            `Initial shock: ${minShock.toFixed(2)} SOL sell order submitted`,
            `Reserves drop from ${realLiq.toFixed(2)} SOL to ${(realLiq - minShock).toFixed(2)} SOL`,
            'Price drops by 28% triggering automated stop-losses',
            clusterHoldings > realLiq * 0.5 ? 'Largest cluster panic-dumps remaining inventory' : 'Retail exit cascade',
            'Remaining executable liquidity trapped below minimum slippage tolerance',
        ];
        const cascadeSusceptibility = clusterHoldings > realLiq * 0.4 ? 0.85 : 0.35;
        const recoveryHalfLife = params.actorGrowthVelocity > 0.3 ? 45 : 300;
        const matchedFailures = [];
        const matchedResilience = [];
        if (params.freshCapitalVelocity < 0.1 && clusterHoldings > realLiq * 0.3) {
            matchedFailures.push(this.failureLibrary[0]);
        }
        if (params.actorGrowthVelocity > 0.4) {
            matchedResilience.push(this.failureLibrary[1]);
        }
        const thesisBreached = minShock < 1.0 || cascadeSusceptibility > 0.75;
        return {
            mint,
            minimumFailureShockSol: Number(minShock.toFixed(2)),
            primaryFailurePath: failurePath,
            cascadeSusceptibility,
            recoveryHalfLifeSec: recoveryHalfLife,
            matchedFailureMechanisms: matchedFailures,
            matchedResilienceMechanisms: matchedResilience,
            thesisBreachedUnderStress: thesisBreached,
        };
    }
}
//# sourceMappingURL=adversarial-search.js.map