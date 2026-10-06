/**
 * SYLPH FUSION — LANE-CONDITIONAL LANDING PHYSICS MODEL
 * Study 37: LANE-CONDITIONAL-LANDING-X (Section XVIII)
 *
 * Estimates P(Landed | Lane, Fee, Tip, WritableSet, Leader, Congestion, TradeType).
 *
 * CRITICAL INVARIANT:
 * Provider ACK != landed
 * Bundle ID != landed
 * Signature returned != landed
 * Only Terminality Authority decides terminal state!
 */

export interface LandingParameters {
  readonly laneId: string; // e.g. 'Jito-Bundle', 'Direct-TPU', 'NextBlock', 'Standard-RPC'
  readonly priorityFeeMicroLamports: number;
  readonly tipLamports: bigint;
  readonly writableAccountCount: number;
  readonly isLeaderJitoEnabled: boolean;
  readonly networkCongestionTps: number;
  readonly tradeType: 'ENTRY_BUY' | 'EMERGENCY_SELL' | 'TAKE_PROFIT_SELL';
}

export interface LandingProbabilityReport {
  readonly landingProbability: number; // In [0, 1]
  readonly sameSlotProbability: number;
  readonly nextSlotProbability: number;
  readonly expectedLandingLatencyMs: number;
  readonly expectedImplementationShortfallUsd: number;
  readonly laneRecommendation: string;
}

export class LandingPhysicsModel {
  public static estimateLanding(params: LandingParameters): LandingProbabilityReport {
    const {
      laneId,
      priorityFeeMicroLamports,
      tipLamports,
      writableAccountCount,
      isLeaderJitoEnabled,
      networkCongestionTps,
      tradeType,
    } = params;

    // Base rate conditioned on submission lane
    let baseRate = 0.65;
    let baseLatencyMs = 650;
    if (laneId.includes('Jito')) {
      baseRate = isLeaderJitoEnabled ? 0.94 : 0.40; // If leader doesn't run Jito, bundle drops!
      baseLatencyMs = 400;
    } else if (laneId.includes('TPU')) {
      baseRate = 0.82;
      baseLatencyMs = 450;
    } else {
      baseRate = 0.55;
      baseLatencyMs = 900;
    }

    // Account contention discount: each heavily contested writable account adds lock collisions
    const contentionPenalty = Math.min(0.35, (writableAccountCount - 2) * 0.05);

    // Tip bonus for bundles (Jito auctions)
    const tipSol = Number(tipLamports) / 1e9;
    const tipBonus = Math.min(0.15, tipSol * 5.0);

    // Priority fee bonus
    const feeBonus = Math.min(0.10, (priorityFeeMicroLamports / 1_000_000) * 0.05);

    // Congestion penalty
    const congestionPenalty = networkCongestionTps > 2500 ? 0.15 : 0.0;

    const netRate = Math.max(
      0.05,
      Math.min(0.99, baseRate - contentionPenalty + tipBonus + feeBonus - congestionPenalty)
    );

    const sameSlotProb = Math.max(0.01, netRate * (laneId.includes('Jito') ? 0.85 : 0.45));
    const nextSlotProb = Math.max(0.01, netRate * 0.35);

    // Slippage shortfall induced by landing delay
    const latencyFactor = baseLatencyMs / 400.0;
    const expectedShortfallUsd = tradeType === 'EMERGENCY_SELL' ? 4.5 * latencyFactor : 1.2 * latencyFactor;

    return {
      landingProbability: netRate,
      sameSlotProbability: sameSlotProb,
      nextSlotProbability: nextSlotProb,
      expectedLandingLatencyMs: baseLatencyMs,
      expectedImplementationShortfallUsd: expectedShortfallUsd,
      laneRecommendation: netRate >= 0.85 ? laneId : 'UPGRADE_TIP_OR_SWITCH_LANE',
    };
  }
}
