/**
 * SYLPH FUSION — CAPITAL-TIME ECONOMICS & VELOCITY OBSERVABILITY
 * Specifications: Blueprint Section 50
 *
 * Status: RESEARCH_ONLY (Velocity metric for high-throughput discovery; not direct authorization)
 *
 * Invariant:
 * 1. Tracks exact capital-time occupancy:
 *    - lamportSecondsReserved
 *    - lamportSecondsUnknown
 *    - lamportSecondsInvested
 * 2. Measures timeToCashMs and timeToFinalSettlementMs.
 * 3. Derives RealizedExecutableNetEdge / CapitalTimeOccupied.
 */

export interface CapitalTimeObservation {
  readonly tradeId: string;
  readonly economicFactId: string;
  readonly reservedAtMs: number;
  readonly signedAtMs?: number;
  readonly landedAtMs?: number;
  readonly settledAtMs: number;
  readonly unencumberedAtMs: number;
  readonly reservedLamports: bigint;
  readonly investedLamports: bigint;
  readonly unknownLamports: bigint;
  readonly realizedNetProceedsLamports: bigint;
  readonly totalFrictionLamports: bigint;
}

export interface CapitalTimeMetrics {
  readonly tradeId: string;
  readonly economicFactId: string;
  readonly lamportSecondsReserved: bigint;
  readonly lamportSecondsUnknown: bigint;
  readonly lamportSecondsInvested: bigint;
  readonly totalLamportSeconds: bigint;
  readonly timeToCashMs: number;
  readonly timeToFinalSettlementMs: number;
  readonly netProceedsLamports: bigint;
  readonly capitalTimeEfficiencyPerSecondBps: number;
  readonly status: 'RESEARCH_ONLY';
  readonly evidenceRoot: string;
}

export class CapitalTimeLedger {
  private readonly records = new Map<string, CapitalTimeMetrics>();

  public recordTradeLifecycle(obs: CapitalTimeObservation): CapitalTimeMetrics {
    const timeToCashMs = obs.unencumberedAtMs - obs.reservedAtMs;
    const timeToFinalSettlementMs = obs.settledAtMs - obs.reservedAtMs;

    const reservedDurationSec = BigInt(Math.max(1, Math.round((obs.settledAtMs - obs.reservedAtMs) / 1000)));
    const investedDurationSec = BigInt(
      Math.max(1, Math.round(((obs.landedAtMs ?? obs.settledAtMs) - obs.reservedAtMs) / 1000))
    );
    const unknownDurationSec = BigInt(
      Math.max(0, Math.round((obs.settledAtMs - (obs.signedAtMs ?? obs.reservedAtMs)) / 1000))
    );

    const lamportSecondsReserved = obs.reservedLamports * reservedDurationSec;
    const lamportSecondsInvested = obs.investedLamports * investedDurationSec;
    const lamportSecondsUnknown = obs.unknownLamports * unknownDurationSec;
    const totalLamportSeconds = lamportSecondsReserved + lamportSecondsUnknown;

    const netProceedsLamports = obs.realizedNetProceedsLamports - obs.totalFrictionLamports;

    // Capital-Time Efficiency: Net Edge (in bps of invested) / Seconds Occupied
    const nominalReturnBps =
      obs.investedLamports > 0n
        ? Number((netProceedsLamports * 10_000n) / obs.investedLamports)
        : 0;
    const capitalTimeEfficiencyPerSecondBps =
      reservedDurationSec > 0n
        ? Number((nominalReturnBps / Number(reservedDurationSec)).toFixed(4))
        : 0;

    const metrics: CapitalTimeMetrics = {
      tradeId: obs.tradeId,
      economicFactId: obs.economicFactId,
      lamportSecondsReserved,
      lamportSecondsUnknown,
      lamportSecondsInvested,
      totalLamportSeconds,
      timeToCashMs,
      timeToFinalSettlementMs,
      netProceedsLamports,
      capitalTimeEfficiencyPerSecondBps,
      status: 'RESEARCH_ONLY',
      evidenceRoot: `ev_cap_time_${obs.tradeId}_${Date.now()}`,
    };

    this.records.set(obs.tradeId, metrics);
    return metrics;
  }

  public getMetrics(tradeId: string): CapitalTimeMetrics | undefined {
    return this.records.get(tradeId);
  }

  public getAllMetrics(): readonly CapitalTimeMetrics[] {
    return Array.from(this.records.values());
  }
}
