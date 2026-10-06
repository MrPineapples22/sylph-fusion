/**
 * SYLPH FUSION — VALUE OF SENSOR ENGINE
 * Study: VALUE-OF-SENSOR-X (Section IX)
 *
 * Information-Per-Cost formulation:
 * IPC = Delta I / SensorCost
 * Determines whether escalating sensor tiers (Tier 0 local RPC -> Tier 4 Jito mempool)
 * produces positive information ROI given expected trade capacity.
 */

export interface SensorTierProfile {
  readonly tier: number;
  readonly name: string;
  readonly queryCostUsd: number;
  readonly expectedInformationGainNats: number;
  readonly expectedLatencyReductionMs: number;
}

export interface SensorEscalationDecision {
  readonly recommendedTier: number;
  readonly informationPerCost: number;
  readonly escalate: boolean;
  readonly rationale: string;
}

export class SensorValueEngine {
  private static readonly TIERS: readonly SensorTierProfile[] = [
    { tier: 0, name: 'LOCAL_RPC_CACHE', queryCostUsd: 0.0, expectedInformationGainNats: 0.05, expectedLatencyReductionMs: 0 },
    { tier: 1, name: 'WS_PUBLIC_STREAM', queryCostUsd: 0.0001, expectedInformationGainNats: 0.15, expectedLatencyReductionMs: 150 },
    { tier: 2, name: 'DEDICATED_GEYSER_FEED', queryCostUsd: 0.001, expectedInformationGainNats: 0.25, expectedLatencyReductionMs: 300 },
    { tier: 3, name: 'HISTORICAL_WALLET_GRAPH', queryCostUsd: 0.005, expectedInformationGainNats: 0.35, expectedLatencyReductionMs: 0 },
    { tier: 4, name: 'JITO_MEMPOOL_AUCTION_STREAM', queryCostUsd: 0.015, expectedInformationGainNats: 0.45, expectedLatencyReductionMs: 400 },
  ];

  public static evaluateTier(
    currentInformationNats: number,
    requiredInformationNats: number,
    tradeSizeUsd = 250.0
  ): SensorEscalationDecision {
    const deficit = Math.max(0, requiredInformationNats - currentInformationNats);

    if (deficit <= 0) {
      return {
        recommendedTier: 0,
        informationPerCost: Infinity,
        escalate: false,
        rationale: 'Information already sufficient; zero escalation needed',
      };
    }

    // Find minimal cost tier that closes at least 60% of the deficit
    for (const profile of this.TIERS) {
      if (profile.expectedInformationGainNats >= deficit * 0.60) {
        const ipc = profile.queryCostUsd > 0
          ? profile.expectedInformationGainNats / profile.queryCostUsd
          : Infinity;

        // Check if cost is <= 0.05% of trade size
        const isCostAcceptable = profile.queryCostUsd <= tradeSizeUsd * 0.0005;

        return {
          recommendedTier: profile.tier,
          informationPerCost: Number(ipc.toFixed(2)),
          escalate: isCostAcceptable,
          rationale: isCostAcceptable
            ? `Escalate to Tier ${profile.tier} (${profile.name}): closes ${profile.expectedInformationGainNats} nats for $${profile.queryCostUsd}`
            : `Cost of Tier ${profile.tier} ($${profile.queryCostUsd}) exceeds 0.05% trade capacity; escalate rejected`,
        };
      }
    }

    return {
      recommendedTier: 2,
      informationPerCost: 250.0,
      escalate: true,
      rationale: 'Defaulting to Tier 2 Geyser feed for moderate deficit',
    };
  }
}
