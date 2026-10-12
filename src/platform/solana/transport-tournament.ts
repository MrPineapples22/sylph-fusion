/**
 * SYLPH FUSION — SOLANA TRANSPORT TOURNAMENT & SAME ECONOMIC GENERATION
 * Specification: Solana-Only Integration Blueprint (Sections 25–29)
 *
 * Epistemic Invariants:
 * 1. Multi-lane transport race: Jito, Direct TPU, SWQoS, High-Performance RPC.
 * 2. Section 26: SAME ECONOMIC GENERATION INVARIANT:
 *    Transport racing must NEVER create duplicate economic intent.
 *    Strictly: 1 exact transaction, 1 cryptographic signature, 1 economicFactId,
 *    1 executionGenerationId -> broadcast across multiple delivery lanes.
 * 3. Section 27: Landing-Cost Optimizer:
 *    Maximize expected net realized edge: E[NetEdge] = P(land | fee, lane, congestion) * edge - fee - tip.
 * 4. Section 29: Transport Shadow Universe & RouteRegret calculation.
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export type TransportLane =
  | 'JITO_BUNDLE'
  | 'DIRECT_TPU'
  | 'SWQOS_LANE'
  | 'VALIDATOR_RPC';

export interface TransportLaneTelemetry {
  readonly lane: TransportLane;
  readonly attemptsCount: number;
  readonly landingsCount: number;
  readonly successfulExecutionsCount: number;
  readonly landingRatePct: number | null;
  readonly meanLatencyMs: number | null;
  readonly meanTipLamports: bigint | null;
  readonly meanPriorityFeeLamports: bigint | null;
  readonly instructionFailureRatePct: number | null;
  readonly postLandingSlippageBps: number | null;
  readonly netRealizedEdgeBps: number | null;
}

export interface ResolvedTransportAttempt {
  readonly attemptId: string;
  readonly benchmarkEventId: string;
  readonly targetProgram: string;
  readonly lane: TransportLane;
  readonly benchmarkRegion: string;
  readonly congestionBucket: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly inputNotionalLamports: bigint;
  readonly outcome: 'SUCCESS' | 'INSTRUCTION_FAILURE' | 'NO_LAND';
  readonly landingLatencyMs?: number;
  readonly baseFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly tipLamports: bigint;
  readonly realizedGrossEdgeLamports: bigint;
  readonly postLandingSlippageBps?: number;
}

export interface SameEconomicGenerationPacket {
  readonly economicFactId: string;
  readonly executionGenerationId: string;
  readonly exactTransactionSignature: string;
  readonly transactionPayloadHash: string;
  readonly authorizedLanes: readonly TransportLane[];
  readonly maxAllowedLanes: number;
  readonly dispatchTimestampMs: number;
}

export interface LaneOptimizationDecision {
  readonly status: 'RESEARCH_CANDIDATE' | 'ABSTAIN';
  readonly abstainReason?: 'INSUFFICIENT_MATCHED_BENCHMARKS' | 'NO_POSITIVE_EXPECTED_NET_EDGE';
  readonly selectedLane: TransportLane | null;
  readonly matchedSampleCount: number;
  readonly expectedLandingProbPct: number | null;
  readonly expectedExecutionSuccessPct: number | null;
  readonly observedAverageTipLamports: bigint | null;
  readonly observedAveragePriorityFeeLamports: bigint | null;
  readonly expectedNetEdgeLamports: bigint | null;
  readonly promotionAuthority: 'NONE';
  readonly fallbackLanes: readonly TransportLane[];
}

export interface RouteRegretRecord {
  readonly economicFactId: string;
  readonly actualLane: TransportLane;
  readonly actualOutcomeBps: number;
  readonly counterfactualLane: TransportLane;
  readonly counterfactualEstimatedOutcomeBps: number;
  readonly routeRegretBps: number; // positive means alternative was better
}

export class SolanaTransportTournament {
  public static readonly MINIMUM_MATCHED_BENCHMARK_EVENTS = 30;
  private readonly laneTelemetry = new Map<TransportLane, {
    readonly attempts: ResolvedTransportAttempt[];
  }>();

  private readonly activeGenerations = new Set<string>();
  private readonly regretHistory: RouteRegretRecord[] = [];
  private readonly attemptIds = new Set<string>();
  private readonly matchedEventKeys = new Set<string>();

  constructor() {
    for (const lane of SolanaTransportTournament.CANDIDATE_LANES) this.laneTelemetry.set(lane, { attempts: [] });
  }

  public static readonly CANDIDATE_LANES: readonly TransportLane[] = [
    'JITO_BUNDLE', 'DIRECT_TPU', 'SWQOS_LANE', 'VALIDATOR_RPC',
  ];

  /** Records one resolved, externally measured attempt. This research scorecard
   * never sends transactions and refuses to infer outcomes from provider ACKs. */
  public recordResolvedAttempt(attempt: ResolvedTransportAttempt): void {
    if (!attempt || typeof attempt.attemptId !== 'string' || !attempt.attemptId.trim() ||
        typeof attempt.benchmarkEventId !== 'string' || !attempt.benchmarkEventId.trim() ||
        typeof attempt.targetProgram !== 'string' || !attempt.targetProgram.trim() ||
        typeof attempt.benchmarkRegion !== 'string' || !attempt.benchmarkRegion.trim() ||
        !SolanaTransportTournament.CANDIDATE_LANES.includes(attempt.lane) ||
        !['LOW', 'MEDIUM', 'HIGH'].includes(attempt.congestionBucket) ||
        typeof attempt.inputNotionalLamports !== 'bigint' || attempt.inputNotionalLamports <= 0n ||
        !['SUCCESS', 'INSTRUCTION_FAILURE', 'NO_LAND'].includes(attempt.outcome) ||
        [attempt.baseFeeLamports, attempt.priorityFeeLamports, attempt.tipLamports].some((v) => typeof v !== 'bigint' || v < 0n) ||
        typeof attempt.realizedGrossEdgeLamports !== 'bigint' ||
        (attempt.postLandingSlippageBps !== undefined && !Number.isFinite(attempt.postLandingSlippageBps))) {
      throw new Error('INVALID_RESOLVED_TRANSPORT_ATTEMPT');
    }
    const landed = attempt.outcome !== 'NO_LAND';
    if ((landed && (!Number.isFinite(attempt.landingLatencyMs) || (attempt.landingLatencyMs as number) < 0)) ||
        (!landed && attempt.landingLatencyMs !== undefined) ||
        (attempt.outcome !== 'SUCCESS' && attempt.realizedGrossEdgeLamports !== 0n) ||
        (attempt.outcome === 'SUCCESS' && attempt.postLandingSlippageBps === undefined)) {
      throw new Error('INCONSISTENT_TRANSPORT_OUTCOME');
    }
    const laneEventKey = [attempt.targetProgram, attempt.benchmarkRegion, attempt.congestionBucket, attempt.benchmarkEventId, attempt.lane].join(':');
    if (this.attemptIds.has(attempt.attemptId) || this.matchedEventKeys.has(laneEventKey)) throw new Error('DUPLICATE_TRANSPORT_ATTEMPT');
    this.attemptIds.add(attempt.attemptId);
    this.matchedEventKeys.add(laneEventKey);
    this.laneTelemetry.get(attempt.lane)!.attempts.push(Object.freeze({ ...attempt }));
  }

  /**
   * Section 26: Asserts that transport multiplexing maintains the exact same economic generation.
   * If a second signature or different payload is submitted under the same generation, it is rejected.
   */
  public registerEconomicGeneration(packet: SameEconomicGenerationPacket): {
    readonly permitted: boolean;
    readonly violation?: string;
  } {
    const generationKey = `${packet.economicFactId}:${packet.executionGenerationId}`;
    if (this.activeGenerations.has(generationKey)) {
      return {
        permitted: false,
        violation: `DUPLICATE_ECONOMIC_GENERATION_ERROR: Generation ${generationKey} already dispatched. Independent duplicate orders forbidden.`,
      };
    }

    if (packet.authorizedLanes.length === 0) {
      return {
        permitted: false,
        violation: 'EMPTY_TRANSPORT_LANES_ERROR: At least one transport lane must be authorized',
      };
    }

    this.activeGenerations.add(generationKey);
    return { permitted: true };
  }

  /**
   * Section 27: Landing-Cost Optimizer
   * Ranks lanes by paired, observed net outcomes. No caller-supplied edge forecast
   * is substituted for the realized outcome evidence in the benchmark sample.
   */
  public optimizeLane(params: {
    targetProgram: string;
    benchmarkRegion: string;
    congestionBucket: 'LOW' | 'MEDIUM' | 'HIGH';
  }): LaneOptimizationDecision {
    const lanes = SolanaTransportTournament.CANDIDATE_LANES;
    if (!params.targetProgram || !params.benchmarkRegion || !['LOW', 'MEDIUM', 'HIGH'].includes(params.congestionBucket)) {
      throw new Error('INVALID_LANE_OPTIMIZATION_INPUT');
    }
    const byLane = new Map<TransportLane, Map<string, ResolvedTransportAttempt>>();
    for (const lane of lanes) {
      const matching = new Map<string, ResolvedTransportAttempt>();
      for (const attempt of this.laneTelemetry.get(lane)!.attempts) {
        if (attempt.targetProgram === params.targetProgram && attempt.benchmarkRegion === params.benchmarkRegion &&
            attempt.congestionBucket === params.congestionBucket) matching.set(attempt.benchmarkEventId, attempt);
      }
      byLane.set(lane, matching);
    }
    // A shared event id is only a valid paired benchmark when every lane used
    // the same notional. This prevents unlike-sized attempts from being
    // compared as if they were the same opportunity.
    const commonEvents = [...(byLane.get(lanes[0])?.keys() ?? [])]
      .filter((eventId) => {
        if (!lanes.every((lane) => byLane.get(lane)?.has(eventId))) return false;
        const notionals = lanes.map((lane) => byLane.get(lane)!.get(eventId)!.inputNotionalLamports);
        return notionals.every((notional) => notional === notionals[0]);
      });
    if (commonEvents.length < SolanaTransportTournament.MINIMUM_MATCHED_BENCHMARK_EVENTS) {
      return Object.freeze({
        status: 'ABSTAIN', abstainReason: 'INSUFFICIENT_MATCHED_BENCHMARKS', selectedLane: null,
        matchedSampleCount: commonEvents.length, expectedLandingProbPct: null, expectedExecutionSuccessPct: null,
        observedAverageTipLamports: null, observedAveragePriorityFeeLamports: null,
        expectedNetEdgeLamports: null, promotionAuthority: 'NONE', fallbackLanes: [],
      });
    }

    const scored = lanes.map((lane) => {
      const attempts = commonEvents.map((eventId) => byLane.get(lane)!.get(eventId)!);
      const landings = attempts.filter((a) => a.outcome !== 'NO_LAND').length;
      const successes = attempts.filter((a) => a.outcome === 'SUCCESS').length;
      const totalTip = attempts.reduce((sum, a) => sum + a.tipLamports, 0n);
      const totalPriority = attempts.reduce((sum, a) => sum + a.priorityFeeLamports, 0n);
      const totalNet = attempts.reduce((sum, a) =>
        sum + a.realizedGrossEdgeLamports - a.baseFeeLamports - a.priorityFeeLamports - a.tipLamports, 0n);
      const n = BigInt(attempts.length);
      // Floor negative averages so sub-lamport rounding cannot turn a loss
      // into a positive candidate.
      const averageNet = totalNet >= 0n ? totalNet / n : -((-totalNet + n - 1n) / n);
      return {
        lane,
        landingRate: landings / attempts.length,
        successRate: successes / attempts.length,
        averageTip: (totalTip + n - 1n) / n,
        averagePriority: (totalPriority + n - 1n) / n,
        expectedNet: averageNet,
      };
    }).sort((a, b) => a.expectedNet === b.expectedNet ? 0 : a.expectedNet > b.expectedNet ? -1 : 1);
    const best = scored[0];
    if (best.expectedNet <= 0n) {
      return Object.freeze({
        status: 'ABSTAIN', abstainReason: 'NO_POSITIVE_EXPECTED_NET_EDGE', selectedLane: null,
        matchedSampleCount: commonEvents.length, expectedLandingProbPct: best.landingRate * 100,
        expectedExecutionSuccessPct: best.successRate * 100, observedAverageTipLamports: best.averageTip,
        observedAveragePriorityFeeLamports: best.averagePriority, expectedNetEdgeLamports: best.expectedNet,
        promotionAuthority: 'NONE', fallbackLanes: [],
      });
    }
    return Object.freeze({
      status: 'RESEARCH_CANDIDATE', selectedLane: best.lane, matchedSampleCount: commonEvents.length,
      expectedLandingProbPct: best.landingRate * 100, expectedExecutionSuccessPct: best.successRate * 100,
      observedAverageTipLamports: best.averageTip, observedAveragePriorityFeeLamports: best.averagePriority,
      expectedNetEdgeLamports: best.expectedNet, promotionAuthority: 'NONE',
      fallbackLanes: scored.slice(1).filter((score) => score.expectedNet > 0n).map((score) => score.lane),
    });
  }

  /**
   * Section 29: Records route outcome and computes counterfactual RouteRegret.
   */
  public recordExecutionOutcome(params: {
    economicFactId: string;
    actualLane: TransportLane;
    actualRealizedBps: number;
    counterfactualLane: TransportLane;
    counterfactualEstimatedBps: number;
  }): RouteRegretRecord {
    const routeRegretBps = params.counterfactualEstimatedBps - params.actualRealizedBps;
    const record: RouteRegretRecord = Object.freeze({
      economicFactId: params.economicFactId,
      actualLane: params.actualLane,
      actualOutcomeBps: params.actualRealizedBps,
      counterfactualLane: params.counterfactualLane,
      counterfactualEstimatedOutcomeBps: params.counterfactualEstimatedBps,
      routeRegretBps,
    });

    this.regretHistory.push(record);
    if (this.regretHistory.length > 500) {
      this.regretHistory.shift();
    }

    return record;
  }

  /**
   * Export all aggregated lane telemetry.
   */
  public getTelemetry(): readonly TransportLaneTelemetry[] {
    const res: TransportLaneTelemetry[] = [];
    for (const [lane, st] of this.laneTelemetry) {
      const n = st.attempts.length;
      const landed = st.attempts.filter((a) => a.outcome !== 'NO_LAND');
      const successes = st.attempts.filter((a) => a.outcome === 'SUCCESS');
      const failures = st.attempts.filter((a) => a.outcome === 'INSTRUCTION_FAILURE');
      const totalTip = st.attempts.reduce((sum, a) => sum + a.tipLamports, 0n);
      const totalPriority = st.attempts.reduce((sum, a) => sum + a.priorityFeeLamports, 0n);
      const totalNet = st.attempts.reduce((sum, a) => sum + a.realizedGrossEdgeLamports - a.baseFeeLamports - a.priorityFeeLamports - a.tipLamports, 0n);
      const totalNotional = st.attempts.reduce((sum, a) => sum + a.inputNotionalLamports, 0n);
      const latencySamples = landed.filter((a) => a.landingLatencyMs !== undefined);
      const slippageSamples = successes.filter((a) => a.postLandingSlippageBps !== undefined);

      res.push(Object.freeze({
        lane,
        attemptsCount: n,
        landingsCount: landed.length,
        successfulExecutionsCount: successes.length,
        landingRatePct: n ? (landed.length / n) * 100 : null,
        meanLatencyMs: latencySamples.length ? latencySamples.reduce((sum, a) => sum + (a.landingLatencyMs ?? 0), 0) / latencySamples.length : null,
        meanTipLamports: n ? totalTip / BigInt(n) : null,
        meanPriorityFeeLamports: n ? totalPriority / BigInt(n) : null,
        instructionFailureRatePct: n ? (failures.length / n) * 100 : null,
        postLandingSlippageBps: slippageSamples.length ? slippageSamples.reduce((sum, a) => sum + (a.postLandingSlippageBps ?? 0), 0) / slippageSamples.length : null,
        netRealizedEdgeBps: totalNotional > 0n ? Number(totalNet) / Number(totalNotional) * 10_000 : null,
      }));
    }
    return Object.freeze(res);
  }
}
