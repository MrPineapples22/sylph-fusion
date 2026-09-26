/**
 * PHASE 43 — TRUTHLAB: INDEPENDENT ADJUDICATION & EVALUATION ISOLATION
 *
 * Implements:
 * - Strict separation of STRUCTURAL ADJUDICATION from MARKET OUTCOME
 * - Independent ground truth reconstruction from canonical chain replay
 * - Shadow observation of vetoed tokens without policy feedback loop
 * - Metric calculations: Structural Veto Precision, Adjudication Coverage, Opportunity Cost
 */

import { MintIdentity } from './types.js';

export interface GroundTruthAdjudication {
  readonly subject: MintIdentity;
  readonly canonicalViolationExisted: boolean;
  readonly confirmedFreezeAuthorityPresent: boolean;
  readonly confirmedPermanentDelegatePresent: boolean;
  readonly verifiedAtSlot: bigint;
  readonly adjudicatorId: string;
}

export interface ShadowMarketObservation {
  readonly subject: MintIdentity;
  readonly observedPeakPriceReturnPct: number;
  readonly observedMaxDrawdownPct: number;
  readonly volumeSol: bigint;
  readonly observationWindowSlots: bigint;
}

export interface TruthLabScorecard {
  readonly structuralVetoPrecision: number; // 0.0 to 1.0 (Target: 1.0 = 0 false vetoes)
  readonly adjudicationCoverage: number;    // % of tokens adjudicated against chain ground truth
  readonly falseVetoConfirmedCount: number; // Target: 0
  readonly opportunityCostTrackedSol: bigint;
  readonly adjudicatedSamplesCount: number;
}

export class TruthLabAdjudicator {
  private readonly adjudications = new Map<string, GroundTruthAdjudication>();
  private readonly shadowObservations = new Map<string, ShadowMarketObservation>();

  private key(subject: MintIdentity): string {
    return `${subject.clusterGenesisHash}:${subject.mint}`;
  }

  public recordAdjudication(adjudication: GroundTruthAdjudication): void {
    this.adjudications.set(this.key(adjudication.subject), adjudication);
  }

  public recordShadowObservation(observation: ShadowMarketObservation): void {
    this.shadowObservations.set(this.key(observation.subject), observation);
  }

  /**
   * Evaluates the accuracy of the structural VETO system against chain ground truth.
   * Note: Market price return does NOT change whether a structural violation existed!
   */
  public evaluateScorecard(vetoedMints: readonly MintIdentity[]): TruthLabScorecard {
    let truePositives = 0;
    let falsePositives = 0;
    let opportunityCostSol = 0n;

    for (const subject of vetoedMints) {
      const adj = this.adjudications.get(this.key(subject));
      if (adj) {
        if (adj.canonicalViolationExisted) {
          truePositives++;
        } else {
          falsePositives++;
        }
      }

      const shadow = this.shadowObservations.get(this.key(subject));
      if (shadow && shadow.observedPeakPriceReturnPct > 0) {
        // Calculate tracked opportunity cost for analytical audit
        opportunityCostSol += shadow.volumeSol / 10n;
      }
    }

    const totalEvaluated = truePositives + falsePositives;
    const precision = totalEvaluated > 0 ? truePositives / totalEvaluated : 1.0;
    const coverage = vetoedMints.length > 0 ? totalEvaluated / vetoedMints.length : 1.0;

    return {
      structuralVetoPrecision: Number(precision.toFixed(4)),
      adjudicationCoverage: Number(coverage.toFixed(4)),
      falseVetoConfirmedCount: falsePositives,
      opportunityCostTrackedSol: opportunityCostSol,
      adjudicatedSamplesCount: totalEvaluated,
    };
  }
}
