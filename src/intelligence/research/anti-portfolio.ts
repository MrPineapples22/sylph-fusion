/**
 * SYLPH FUSION — ANTI-PORTFOLIO & SECOND-CHANCE QUEUE
 * Specifications: Master Blueprint Sections XXXVI, XXXVII, XXXVIII, XXXIX
 *
 * Tracks EVERY rejected candidate and determines what happened later:
 * - rejected_2x, rejected_5x, rejected_10x, rejected_50x, rejected_100x
 * - rejected_rug, rejected_death, rejected_executable_EV
 * - Second-chance requalification queue (REJECT -> REJECTED_WATCH -> REQUALIFIED)
 * - Filter Net Value = AvoidedLoss - MissedExecutableEV
 * - Moonshot Tax(F) = ExtremeWinnerEVRejected / BadEVPrevented
 *
 * Mandatory requirement: SYLPH cannot improve filters without knowing what the filters rejected.
 */

export type RejectionDisposition = 'REJECT' | 'REJECTED_WATCH' | 'REQUALIFIED';

export interface RejectedCandidateRecord {
  readonly candidateId: string;
  readonly mint: string;
  readonly rejectedAtMs: number;
  readonly rejectionReason: string;
  readonly filterName: string;
  readonly entryPriceSol: number;
  readonly entryLiquidityLamports: bigint;
  disposition: RejectionDisposition;
  subsequentPeakMultiple?: number;
  subsequentWorstDrawdownBps?: number;
  isRug?: boolean;
  isDead?: boolean;
  actualExecutableReturnBps?: number;
  requalifiedAtMs?: number;
  requalificationReason?: string;
}

export interface AntiPortfolioSummary {
  readonly totalRejectedCount: number;
  readonly rejectedRugCount: number;
  readonly rejectedDeathCount: number;
  readonly rejected2xCount: number;
  readonly rejected5xCount: number;
  readonly rejected10xCount: number;
  readonly rejected50xCount: number;
  readonly rejected100xCount: number;
  readonly totalAvoidedLossLamports: bigint;
  readonly totalMissedExecutableEvLamports: bigint;
  readonly filterNetValueLamports: bigint;
  readonly overallMoonshotTax: number;
}

export class AntiPortfolioEngine {
  private readonly rejected = new Map<string, RejectedCandidateRecord>();

  public recordRejection(params: {
    mint: string;
    candidateId?: string;
    filterName: string;
    rejectionReason: string;
    entryPriceSol: number;
    entryLiquidityLamports: bigint;
    eligibleForSecondChance?: boolean;
  }): RejectedCandidateRecord {
    const candidateId = params.candidateId ?? `rej_${params.mint}_${Date.now()}`;
    const record: RejectedCandidateRecord = {
      candidateId,
      mint: params.mint,
      rejectedAtMs: Date.now(),
      rejectionReason: params.rejectionReason,
      filterName: params.filterName,
      entryPriceSol: params.entryPriceSol,
      entryLiquidityLamports: params.entryLiquidityLamports,
      disposition: params.eligibleForSecondChance ? 'REJECTED_WATCH' : 'REJECT',
    };
    this.rejected.set(params.mint, record);
    return record;
  }

  /**
   * Requalifies a previously rejected candidate when structural state improves.
   */
  public requalifyCandidate(mint: string, reason: string): boolean {
    const record = this.rejected.get(mint);
    if (!record || record.disposition !== 'REJECTED_WATCH') return false;

    record.disposition = 'REQUALIFIED';
    record.requalifiedAtMs = Date.now();
    record.requalificationReason = reason;
    return true;
  }

  /**
   * Updates outcome observation for a rejected token as historical data matures.
   */
  public updateRejectedOutcome(params: {
    mint: string;
    peakMultiple: number;
    worstDrawdownBps: number;
    isRug: boolean;
    isDead: boolean;
    actualExecutableReturnBps: number;
  }): void {
    const record = this.rejected.get(params.mint);
    if (!record) return;

    record.subsequentPeakMultiple = params.peakMultiple;
    record.subsequentWorstDrawdownBps = params.worstDrawdownBps;
    record.isRug = params.isRug;
    record.isDead = params.isDead;
    record.actualExecutableReturnBps = params.actualExecutableReturnBps;
  }

  /**
   * Computes the economic impact and Moonshot Tax of all applied filters.
   */
  public computeAntiPortfolioSummary(): AntiPortfolioSummary {
    let totalRejectedCount = 0;
    let rejectedRugCount = 0;
    let rejectedDeathCount = 0;
    let rejected2xCount = 0;
    let rejected5xCount = 0;
    let rejected10xCount = 0;
    let rejected50xCount = 0;
    let rejected100xCount = 0;

    let totalAvoidedLossLamports = 0n;
    let totalMissedExecutableEvLamports = 0n;

    for (const record of this.rejected.values()) {
      totalRejectedCount++;
      const peak = record.subsequentPeakMultiple ?? 1.0;

      if (record.isRug) {
        rejectedRugCount++;
        totalAvoidedLossLamports += 100_000_000n; // 0.1 SOL avoided per rug
      } else if (record.isDead) {
        rejectedDeathCount++;
        totalAvoidedLossLamports += 80_000_000n;
      }

      if (peak >= 100) rejected100xCount++;
      if (peak >= 50) rejected50xCount++;
      if (peak >= 10) rejected10xCount++;
      if (peak >= 5) rejected5xCount++;
      if (peak >= 2) rejected2xCount++;

      if (record.actualExecutableReturnBps && record.actualExecutableReturnBps > 0) {
        const missedEv = BigInt(Math.round(100_000_000 * (record.actualExecutableReturnBps / 10_000)));
        totalMissedExecutableEvLamports += missedEv;
      }
    }

    const filterNetValueLamports = totalAvoidedLossLamports - totalMissedExecutableEvLamports;
    const overallMoonshotTax = totalAvoidedLossLamports > 0n
      ? Number(totalMissedExecutableEvLamports) / Number(totalAvoidedLossLamports)
      : 0;

    return {
      totalRejectedCount,
      rejectedRugCount,
      rejectedDeathCount,
      rejected2xCount,
      rejected5xCount,
      rejected10xCount,
      rejected50xCount,
      rejected100xCount,
      totalAvoidedLossLamports,
      totalMissedExecutableEvLamports,
      filterNetValueLamports,
      overallMoonshotTax: Number(overallMoonshotTax.toFixed(4)),
    };
  }

  public getRecord(mint: string): RejectedCandidateRecord | undefined {
    return this.rejected.get(mint);
  }

  public getAllRecords(): readonly RejectedCandidateRecord[] {
    return Array.from(this.rejected.values());
  }
}
