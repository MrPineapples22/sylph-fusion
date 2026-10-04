/**
 * SYLPH FUSION — MAINNET REALITY TOURNAMENT ENGINE
 * Specification: Prompt 55, Prompt 48, Prompt 60
 *
 * Requirements:
 * 1. Compare competing RPC providers, stream providers, quote providers,
 *    transport paths, landing models, slippage models, and fee strategies
 *    against actual observed mainnet outcomes.
 * 2. Do NOT optimize against vendor marketing claims.
 * 3. Score strictly against empirical criteria:
 *    - Freshness (mean & p99 latency in ms)
 *    - Slot & transaction coverage (%)
 *    - Calibration Brier score: (p_predicted - outcome_actual)^2
 *    - Semantic correctness & disagreement frequency
 *    - Reconciliation error (lamports)
 *    - Cost & failure modes
 * 4. Invariant: Tournament results are RESEARCH/SHADOW evidence.
 *    No provider or model may self-promote to AUTHORIZE authority based on tournament wins.
 */

import { canonicalJson, hashCanonical } from './canonical-hashing.js';

export type TournamentCompetitorKind =
  | 'RPC_PROVIDER'
  | 'STREAM_PROVIDER'
  | 'QUOTE_PROVIDER'
  | 'LANDING_MODEL'
  | 'SLIPPAGE_MODEL'
  | 'FEE_STRATEGY'
  | 'TRANSPORT_PATH';

export interface CompetitorObservation {
  readonly competitorId: string;
  readonly kind: TournamentCompetitorKind;
  readonly slot: bigint;
  readonly observedAt: string;
  readonly latencyMs: number;
  readonly reportedValue: unknown;
  readonly predictedProbability?: number; // for landing/prediction models [0.0, 1.0]
  readonly predictedLossBps?: number;     // for slippage models
}

export interface GroundTruthOutcome {
  readonly slot: bigint;
  readonly finalizedAt: string;
  readonly groundTruthValue: unknown;
  readonly landed: boolean;
  readonly realizedLossBps?: number;
  readonly realizedDeltaLamports?: bigint;
}

export interface CompetitorScorecard {
  readonly competitorId: string;
  readonly kind: TournamentCompetitorKind;
  readonly sampleCount: number;
  readonly meanLatencyMs: number;
  readonly p99LatencyMs: number;
  readonly coveragePct: number;
  readonly brierScore?: number; // Lower is better (0.0 = perfect calibration)
  readonly meanSlippageErrorBps?: number;
  readonly disagreementCount: number;
  readonly disagreementRatePct: number;
  readonly compositeScore: number; // Normalized 0-100 scale
  readonly rank: number;
}

export interface TournamentReport {
  readonly tournamentId: string;
  readonly kind: TournamentCompetitorKind;
  readonly evaluatedAt: string;
  readonly totalSlotsEvaluated: number;
  readonly competitorCount: number;
  readonly scorecards: readonly CompetitorScorecard[];
  readonly winnerCompetitorId: string;
  readonly reportHash: string;
}

export class MainnetRealityTournament {
  private readonly observations = new Map<string, CompetitorObservation[]>();
  private readonly groundTruths = new Map<string, GroundTruthOutcome>(); // slot key -> outcome

  public recordObservation(observation: CompetitorObservation): void {
    const list = this.observations.get(observation.competitorId) ?? [];
    list.push(Object.freeze({ ...observation }));
    this.observations.set(observation.competitorId, list);
  }

  public recordGroundTruth(outcome: GroundTruthOutcome): void {
    this.groundTruths.set(outcome.slot.toString(), Object.freeze({ ...outcome }));
  }

  /**
   * Evaluates all competitors in a specified category against ground-truth outcomes.
   * Produces a deterministic tournament scorecard and rankings.
   */
  public evaluateTournament(
    tournamentId: string,
    kind: TournamentCompetitorKind,
    evaluatedAt: string
  ): TournamentReport {
    const matchingCompetitors: string[] = [];
    for (const [id, obsList] of this.observations.entries()) {
      if (obsList.length > 0 && obsList[0].kind === kind) {
        matchingCompetitors.push(id);
      }
    }

    if (matchingCompetitors.length === 0) {
      throw new Error(`TOURNAMENT_ERROR: No competitors found for category '${kind}'`);
    }

    const totalSlots = this.groundTruths.size;
    const scorecards: CompetitorScorecard[] = [];

    for (const compId of matchingCompetitors) {
      const obsList = this.observations.get(compId) ?? [];
      const latencies = obsList.map((o) => o.latencyMs).sort((a, b) => a - b);
      const meanLatency =
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 999999;
      const p99Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99));
      const p99Latency = latencies.length > 0 ? latencies[p99Index] : 999999;

      let matchedGroundTruths = 0;
      let disagreementCount = 0;
      let brierSum = 0;
      let brierSamples = 0;
      let slippageErrSum = 0;
      let slippageSamples = 0;

      for (const obs of obsList) {
        const gt = this.groundTruths.get(obs.slot.toString());
        if (gt) {
          matchedGroundTruths++;
          // Semantic disagreement check (using BigInt-safe canonicalJson)
          if (canonicalJson(obs.reportedValue) !== canonicalJson(gt.groundTruthValue)) {
            disagreementCount++;
          }
          // Landing model Brier score: (p - y)^2 where y in {0, 1}
          if (obs.predictedProbability !== undefined) {
            const actualY = gt.landed ? 1.0 : 0.0;
            const diff = obs.predictedProbability - actualY;
            brierSum += diff * diff;
            brierSamples++;
          }
          // Slippage model error
          if (obs.predictedLossBps !== undefined && gt.realizedLossBps !== undefined) {
            slippageErrSum += Math.abs(obs.predictedLossBps - gt.realizedLossBps);
            slippageSamples++;
          }
        }
      }

      const coveragePct = totalSlots > 0 ? (matchedGroundTruths / totalSlots) * 100 : 0;
      const disagreementRatePct =
        matchedGroundTruths > 0 ? (disagreementCount / matchedGroundTruths) * 100 : 0;
      const brierScore = brierSamples > 0 ? brierSum / brierSamples : undefined;
      const meanSlippageErrorBps = slippageSamples > 0 ? slippageErrSum / slippageSamples : undefined;

      // Composite score formula:
      // Weight coverage heavily (40%), low latency (30%), low disagreement (30%)
      const latencyScore = Math.max(0, 100 - meanLatency / 5); // 0ms = 100, 500ms = 0
      const disagreementScore = Math.max(0, 100 - disagreementRatePct * 5);
      const brierBonus = brierScore !== undefined ? Math.max(0, (1.0 - brierScore) * 100) : 100;

      const compositeScore = Math.round(
        (coveragePct * 0.35 + latencyScore * 0.25 + disagreementScore * 0.25 + brierBonus * 0.15) *
          100
      ) / 100;

      scorecards.push({
        competitorId: compId,
        kind,
        sampleCount: obsList.length,
        meanLatencyMs: Math.round(meanLatency * 100) / 100,
        p99LatencyMs: Math.round(p99Latency * 100) / 100,
        coveragePct: Math.round(coveragePct * 100) / 100,
        brierScore: brierScore !== undefined ? Math.round(brierScore * 10000) / 10000 : undefined,
        meanSlippageErrorBps:
          meanSlippageErrorBps !== undefined
            ? Math.round(meanSlippageErrorBps * 100) / 100
            : undefined,
        disagreementCount,
        disagreementRatePct: Math.round(disagreementRatePct * 100) / 100,
        compositeScore,
        rank: 0, // Assigned below
      });
    }

    // Sort descending by compositeScore
    scorecards.sort((a, b) => b.compositeScore - a.compositeScore);
    const rankedScorecards = scorecards.map((sc, index) =>
      Object.freeze({
        ...sc,
        rank: index + 1,
      })
    );

    const winnerCompetitorId = rankedScorecards[0].competitorId;
    const reportPreimage = {
      tournamentId,
      kind,
      evaluatedAt,
      totalSlotsEvaluated: totalSlots,
      competitorCount: rankedScorecards.length,
      scorecards: rankedScorecards,
      winnerCompetitorId,
    };

    const reportHash = hashCanonical(reportPreimage);

    return Object.freeze({
      ...reportPreimage,
      reportHash,
    });
  }
}
