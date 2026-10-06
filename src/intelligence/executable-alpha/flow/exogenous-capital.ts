/**
 * SYLPH FUSION — EXOGENOUS CAPITAL CLASSIFIER
 * Study 24: EXOGENOUS-CAPITAL-X (Section XIII)
 *
 * Classifies net capital arriving in a token pool into genuine exogenous capital
 * vs recycled/wash/sybil/self-funded volume.
 */

export type CapitalOriginClass =
  | 'NEW_CAPITAL'
  | 'RECYCLED_CAPITAL'
  | 'COORDINATED_CAPITAL'
  | 'SELF_FUNDED_VOLUME'
  | 'UNKNOWN_ORIGIN';

export interface CapitalBreakdownReport {
  readonly dominantOrigin: CapitalOriginClass;
  readonly newCapitalRatio: number; // Genuine outside SOL from distinct funding sources
  readonly recycledCapitalRatio: number; // Same SOL looping across tokens
  readonly coordinatedCapitalRatio: number; // Sybil clusters / same funder
  readonly selfFundedRatio: number; // Deployer / sniper self-swap wash volume
  readonly unknownRatio: number;
  readonly isAuthenticInflow: boolean;
  readonly netExogenousInflowUsd: number;
}

export class ExogenousCapitalClassifier {
  public static classifyFlow(params: {
    totalInflowUsd: number;
    fundingDiversityScore: number; // 0 to 1
    sameFunderClustersCount: number;
    deployerRelatedFlowUsd: number;
    circularTradeVolumeUsd: number;
  }): CapitalBreakdownReport {
    const {
      totalInflowUsd,
      fundingDiversityScore,
      sameFunderClustersCount,
      deployerRelatedFlowUsd,
      circularTradeVolumeUsd,
    } = params;

    if (totalInflowUsd <= 0) {
      return {
        dominantOrigin: 'UNKNOWN_ORIGIN',
        newCapitalRatio: 0,
        recycledCapitalRatio: 0,
        coordinatedCapitalRatio: 0,
        selfFundedRatio: 0,
        unknownRatio: 1.0,
        isAuthenticInflow: false,
        netExogenousInflowUsd: 0,
      };
    }

    const selfFundedRatio = Math.min(1.0, (deployerRelatedFlowUsd + circularTradeVolumeUsd) / totalInflowUsd);
    const coordinatedCapitalRatio = Math.min(1.0 - selfFundedRatio, (sameFunderClustersCount * 0.12));
    const recycledCapitalRatio = Math.min(1.0 - selfFundedRatio - coordinatedCapitalRatio, (1.0 - fundingDiversityScore) * 0.5);
    const newCapitalRatio = Math.max(0, 1.0 - selfFundedRatio - coordinatedCapitalRatio - recycledCapitalRatio);
    const unknownRatio = 0.0;

    let dominantOrigin: CapitalOriginClass = 'NEW_CAPITAL';
    if (selfFundedRatio > 0.40) dominantOrigin = 'SELF_FUNDED_VOLUME';
    else if (coordinatedCapitalRatio > 0.35) dominantOrigin = 'COORDINATED_CAPITAL';
    else if (recycledCapitalRatio > 0.35) dominantOrigin = 'RECYCLED_CAPITAL';
    else if (newCapitalRatio < 0.20) dominantOrigin = 'UNKNOWN_ORIGIN';

    const isAuthenticInflow = newCapitalRatio >= 0.45 && selfFundedRatio < 0.20;
    const netExogenousInflowUsd = totalInflowUsd * newCapitalRatio;

    return {
      dominantOrigin,
      newCapitalRatio,
      recycledCapitalRatio,
      coordinatedCapitalRatio,
      selfFundedRatio,
      unknownRatio,
      isAuthenticInflow,
      netExogenousInflowUsd,
    };
  }
}
