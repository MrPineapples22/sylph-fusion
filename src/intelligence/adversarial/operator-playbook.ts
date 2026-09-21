/**
 * SOL-SYLPH Operator Playbook Engine
 * Blueprint Part XIV
 *
 * Fingerprints launches based on structural execution and funding patterns.
 * Computes PlaybookSimilarity, PlaybookNovelty, and PlaybookMutationDistance.
 */

export interface LaunchFingerprint {
  readonly mint: string;
  readonly fundingTopology: 'SINGLE_FUNDER' | 'DISPERSED' | 'CEX_DIRECT' | 'STAGING_CHAIN';
  readonly walletCreationSpreadSec: number;
  readonly priorityFeeMicrolamports: number;
  readonly hasBundle: boolean;
  readonly lpTimingDelaySec: number;
  readonly top10SupplyPct: number;
  readonly first10BuyerVelocityMs: number;
}

export interface PlaybookMatchResult {
  readonly playbookId: string;
  readonly playbookName: string;
  readonly similarityScore: number;     // 0.0 - 1.0
  readonly mutationDistance: number;    // Distance from canonical playbook archetype
  readonly historicalOutcome: 'SERIAL_RUG' | 'SLOW_DRAIN' | 'PUMP_AND_DUMP' | 'ORGANIC_LAUNCH';
}

export interface PlaybookEvaluationReport {
  readonly mint: string;
  readonly fingerprint: LaunchFingerprint;
  readonly closestPlaybook?: PlaybookMatchResult;
  readonly playbookNovelty: number;     // 1.0 = completely unprecedented, 0.0 = exact copycat
  readonly isKnownMaliciousPlaybook: boolean;
  readonly similarityConfidence: number;
}

export class OperatorPlaybookEngine {
  private readonly historicalPlaybooks: {
    id: string;
    name: string;
    canonical: Partial<LaunchFingerprint>;
    archetypeOutcome: 'SERIAL_RUG' | 'SLOW_DRAIN' | 'PUMP_AND_DUMP' | 'ORGANIC_LAUNCH';
  }[] = [
    {
      id: 'pb_sol_drain_bundle',
      name: 'Single-Funder Jito Sniper Drain',
      canonical: {
        fundingTopology: 'SINGLE_FUNDER',
        hasBundle: true,
        top10SupplyPct: 65,
        priorityFeeMicrolamports: 50000,
      },
      archetypeOutcome: 'SERIAL_RUG',
    },
    {
      id: 'pb_slow_wash_creep',
      name: 'Slow Wash Staging Creep',
      canonical: {
        fundingTopology: 'STAGING_CHAIN',
        hasBundle: false,
        top10SupplyPct: 40,
        walletCreationSpreadSec: 300,
      },
      archetypeOutcome: 'SLOW_DRAIN',
    },
    {
      id: 'pb_organic_community',
      name: 'Organic Dispersed Launch',
      canonical: {
        fundingTopology: 'DISPERSED',
        hasBundle: false,
        top10SupplyPct: 15,
        walletCreationSpreadSec: 3600,
      },
      archetypeOutcome: 'ORGANIC_LAUNCH',
    },
  ];

  public evaluateLaunch(fingerprint: LaunchFingerprint): PlaybookEvaluationReport {
    let closest: PlaybookMatchResult | undefined;
    let highestSim = -1;

    for (const pb of this.historicalPlaybooks) {
      let matches = 0;
      let totalTests = 0;

      if (pb.canonical.fundingTopology) {
        totalTests++;
        if (pb.canonical.fundingTopology === fingerprint.fundingTopology) matches++;
      }
      if (pb.canonical.hasBundle !== undefined) {
        totalTests++;
        if (pb.canonical.hasBundle === fingerprint.hasBundle) matches++;
      }
      if (pb.canonical.top10SupplyPct !== undefined) {
        totalTests++;
        const diff = Math.abs(pb.canonical.top10SupplyPct - fingerprint.top10SupplyPct);
        matches += Math.max(0, 1.0 - diff / 50);
      }

      const sim = matches / Math.max(1, totalTests);
      const mutation = 1.0 - sim;

      if (sim > highestSim) {
        highestSim = sim;
        closest = {
          playbookId: pb.id,
          playbookName: pb.name,
          similarityScore: Number(sim.toFixed(3)),
          mutationDistance: Number(mutation.toFixed(3)),
          historicalOutcome: pb.archetypeOutcome,
        };
      }
    }

    const novelty = Number(Math.max(0.0, 1.0 - highestSim).toFixed(3));
    const isMalicious = Boolean(
      closest &&
      closest.similarityScore > 0.75 &&
      (closest.historicalOutcome === 'SERIAL_RUG' || closest.historicalOutcome === 'PUMP_AND_DUMP')
    );

    return {
      mint: fingerprint.mint,
      fingerprint,
      closestPlaybook: closest,
      playbookNovelty: novelty,
      isKnownMaliciousPlaybook: isMalicious,
      similarityConfidence: highestSim,
    };
  }
}
