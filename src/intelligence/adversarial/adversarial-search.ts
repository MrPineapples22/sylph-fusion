/**
 * SOL-SYLPH Adversarial Search & Failure/Resilience Library
 * Blueprint Parts XXX, LIII
 *
 * Constrained search asking: What plausible sequence breaks the current thesis?
 * Calculates MinimumFailureShock, FailurePath, CascadeSusceptibility, RecoveryHalfLife.
 * Stores recurring failure and resilience mechanisms.
 */

export interface AdversarialFailureScenario {
  readonly shockType: 'WHALE_EXIT' | 'LP_PULL' | 'CAPITAL_MIGRATION' | 'ROUTE_COLLAPSE';
  readonly minShockRequiredSol: number;
  readonly failurePath: readonly string[];
  readonly cascadeSusceptibility: number; // 0.0 - 1.0
  readonly recoveryHalfLifeSec: number;
  readonly isCatastrophic: boolean;
}

export interface FailureResilienceMechanism {
  readonly mechanismId: string;
  readonly mechanismType: 'FAILURE_CASCADE' | 'RESILIENCE_ABSORPTION';
  readonly description: string;
  readonly triggerCondition: string;
  readonly sequenceSteps: readonly string[];
  readonly historicalFrequency: number;
}

export interface AdversarialSearchReport {
  readonly mint: string;
  readonly minimumFailureShockSol: number;
  readonly primaryFailurePath: readonly string[];
  readonly cascadeSusceptibility: number;
  readonly recoveryHalfLifeSec: number;
  readonly matchedFailureMechanisms: readonly FailureResilienceMechanism[];
  readonly matchedResilienceMechanisms: readonly FailureResilienceMechanism[];
  readonly thesisBreachedUnderStress: boolean;
}

export class AdversarialSearcher {
  private readonly failureLibrary: FailureResilienceMechanism[] = [
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

  public searchAdversarialScenarios(params: {
    mint: string;
    realLiquiditySol: number;
    topClusterHoldingSol: number;
    freshCapitalVelocity: number;
    actorGrowthVelocity: number;
    isLpLocked: boolean;
  }): AdversarialSearchReport {
    const mint = params.mint;
    const realLiq = Math.max(0.1, params.realLiquiditySol);
    const clusterHoldings = params.topClusterHoldingSol;

    // Minimum shock to cause >35% price collapse or pool exhaustion
    const minShock = realLiq * 0.25;

    const failurePath: string[] = [
      `Initial shock: ${minShock.toFixed(2)} SOL sell order submitted`,
      `Reserves drop from ${realLiq.toFixed(2)} SOL to ${(realLiq - minShock).toFixed(2)} SOL`,
      'Price drops by 28% triggering automated stop-losses',
      clusterHoldings > realLiq * 0.5 ? 'Largest cluster panic-dumps remaining inventory' : 'Retail exit cascade',
      'Remaining executable liquidity trapped below minimum slippage tolerance',
    ];

    const cascadeSusceptibility = clusterHoldings > realLiq * 0.4 ? 0.85 : 0.35;
    const recoveryHalfLife = params.actorGrowthVelocity > 0.3 ? 45 : 300;

    const matchedFailures: FailureResilienceMechanism[] = [];
    const matchedResilience: FailureResilienceMechanism[] = [];

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
