/**
 * Research-only simulation risk evaluator inspired by MOBIUS Searcher.
 *
 * It produces a local diagnostic certificate. Evidence is not authenticated,
 * this module has no signer or broadcaster, and its result cannot authorize a
 * transaction. Any future execution use requires independent Astra review.
 */

import { createHash } from 'node:crypto';

export interface SimulationEvidence {
  readonly simulationId: string;
  readonly mint: string;
  readonly slot: number;
  readonly simulatedAtMs: number;
  readonly computeUnitsConsumed: number;
  readonly computeUnitsLimit: number;
  readonly isSimulationSuccess: boolean;
  readonly errorDetails?: string | null;
  readonly expectedSolOut: number;
  readonly expectedTokenOut: number;
  readonly expectedSlippageBps: number;
  readonly priorityFeeLamports?: bigint;
  readonly tipLamports?: bigint;
}

export interface RiskEnvelopeConfig {
  readonly maxAllowedSimulationAgeMs?: number;
  readonly maxAllowedCuRatio?: number;
  readonly maxAllowedSlippageBps?: number;
  readonly maxTradeNotionalSol?: number;
  readonly maxDailyDrawdownSol?: number;
  readonly maxPriorityFeeLamports?: bigint;
  readonly maxTipLamports?: bigint;
}

export type SimulationRiskVerdict =
  | 'SIMULATION_APPROVED'
  | 'SIMULATION_REQUIRED'
  | 'SIMULATION_STALE'
  | 'SIMULATION_FAILED'
  | 'CU_BUDGET_EXCEEDED'
  | 'SLIPPAGE_EXCEEDED'
  | 'NOTIONAL_CAP_EXCEEDED'
  | 'DAILY_DRAWDOWN_LIMIT_EXCEEDED'
  | 'PRIORITY_FEE_CAP_EXCEEDED'
  | 'TIP_CAP_EXCEEDED'
  | 'MALFORMED_EVIDENCE';

export interface SimulationRiskCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly slot: number;
  readonly isApproved: boolean;
  readonly verdict: SimulationRiskVerdict;
  readonly rejectionReason: string | null;
  readonly stalenessMs: number;
  readonly cuUtilizationPct: number;
  readonly expectedSlippageBps: number;
  readonly certificateHash: string;
  readonly evaluatedAtMs: number;
  readonly authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY';
}

type EvaluationContext = {
  readonly nowMs?: number;
  readonly tradeNotionalSol?: number;
  readonly dailyDrawdownSol?: number;
};

function makeCertificate(params: {
  mint: string;
  slot: number;
  verdict: SimulationRiskVerdict;
  reason: string | null;
  stalenessMs: number;
  cuUtilizationPct: number;
  expectedSlippageBps: number;
  evaluatedAtMs: number;
  evidenceDigestInput: string;
}): SimulationRiskCertificate {
  const isApproved = params.verdict === 'SIMULATION_APPROVED';
  const payload = JSON.stringify({
    mint: params.mint,
    slot: params.slot,
    verdict: params.verdict,
    reason: params.reason,
    stalenessMs: params.stalenessMs,
    cuUtilizationPct: params.cuUtilizationPct,
    expectedSlippageBps: params.expectedSlippageBps,
    evaluatedAtMs: params.evaluatedAtMs,
    evidenceDigestInput: params.evidenceDigestInput,
  });
  const certificateHash = createHash('sha256').update(payload).digest('hex');
  return Object.freeze({
    certificateId: `srec_${certificateHash.slice(0, 16)}`,
    mint: params.mint,
    slot: params.slot,
    isApproved,
    verdict: params.verdict,
    rejectionReason: params.reason,
    stalenessMs: params.stalenessMs,
    cuUtilizationPct: params.cuUtilizationPct,
    expectedSlippageBps: params.expectedSlippageBps,
    certificateHash,
    evaluatedAtMs: params.evaluatedAtMs,
    authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY',
  });
}

/** No simulation means unavailable evidence, never a synthetic approval. */
export function missingSimulationRiskCertificate(params: {
  readonly mint: string;
  readonly slot: number;
  readonly evaluatedAtMs: number;
}): SimulationRiskCertificate {
  const mint = typeof params?.mint === 'string' && params.mint.length > 0 ? params.mint : 'UNKNOWN';
  const slot = Number.isSafeInteger(params?.slot) && params.slot >= 0 ? params.slot : 0;
  const evaluatedAtMs = Number.isFinite(params?.evaluatedAtMs) && params.evaluatedAtMs >= 0 ? params.evaluatedAtMs : 0;
  return makeCertificate({
    mint, slot, verdict: 'SIMULATION_REQUIRED', reason: 'SIMULATION_EVIDENCE_MISSING',
    stalenessMs: 0, cuUtilizationPct: 100, expectedSlippageBps: 10_000, evaluatedAtMs,
    evidenceDigestInput: 'MISSING_SIMULATION',
  });
}

export class SimulationRiskEnvelopeEngine {
  private readonly maxAllowedSimulationAgeMs: number;
  private readonly maxAllowedCuRatio: number;
  private readonly maxAllowedSlippageBps: number;
  private readonly maxTradeNotionalSol: number;
  private readonly maxDailyDrawdownSol: number | undefined;
  private readonly maxPriorityFeeLamports: bigint | undefined;
  private readonly maxTipLamports: bigint;
  private totalEvaluated = 0;
  private totalApproved = 0;
  private totalRejected = 0;

  constructor(config: RiskEnvelopeConfig = {}) {
    this.maxAllowedSimulationAgeMs = config.maxAllowedSimulationAgeMs ?? 400;
    this.maxAllowedCuRatio = config.maxAllowedCuRatio ?? 0.90;
    this.maxAllowedSlippageBps = config.maxAllowedSlippageBps ?? 250;
    this.maxTradeNotionalSol = config.maxTradeNotionalSol ?? 5.0;
    this.maxDailyDrawdownSol = config.maxDailyDrawdownSol;
    this.maxPriorityFeeLamports = config.maxPriorityFeeLamports;
    this.maxTipLamports = config.maxTipLamports ?? 500_000n;

    if (!Number.isFinite(this.maxAllowedSimulationAgeMs) || this.maxAllowedSimulationAgeMs < 50) throw new Error('INVALID_SIMULATION_AGE_CONFIG');
    if (!Number.isFinite(this.maxAllowedCuRatio) || this.maxAllowedCuRatio <= 0 || this.maxAllowedCuRatio > 1) throw new Error('INVALID_CU_RATIO_CONFIG');
    if (!Number.isFinite(this.maxAllowedSlippageBps) || this.maxAllowedSlippageBps < 0 || this.maxAllowedSlippageBps > 10_000) throw new Error('INVALID_SLIPPAGE_CONFIG');
    if (!Number.isFinite(this.maxTradeNotionalSol) || this.maxTradeNotionalSol <= 0) throw new Error('INVALID_NOTIONAL_CONFIG');
    if (this.maxDailyDrawdownSol !== undefined && (!Number.isFinite(this.maxDailyDrawdownSol) || this.maxDailyDrawdownSol <= 0)) throw new Error('INVALID_DRAWDOWN_CONFIG');
    if (this.maxPriorityFeeLamports !== undefined && (typeof this.maxPriorityFeeLamports !== 'bigint' || this.maxPriorityFeeLamports < 0n)) throw new Error('INVALID_PRIORITY_FEE_CONFIG');
    if (typeof this.maxTipLamports !== 'bigint' || this.maxTipLamports < 0n) throw new Error('INVALID_TIP_CONFIG');
  }

  public evaluateSimulation(evidence: SimulationEvidence, context: EvaluationContext = {}): SimulationRiskCertificate {
    this.totalEvaluated++;
    const now = context.nowMs ?? Date.now();
    const mint = typeof evidence?.mint === 'string' && evidence.mint.length > 0 ? evidence.mint : 'UNKNOWN';
    const slot = Number.isSafeInteger(evidence?.slot) && evidence.slot >= 0 ? evidence.slot : 0;
    const invalid = !evidence ||
      typeof evidence.simulationId !== 'string' || evidence.simulationId.trim().length === 0 ||
      typeof evidence.mint !== 'string' || evidence.mint.trim().length === 0 ||
      !Number.isSafeInteger(evidence.slot) || evidence.slot < 0 ||
      !Number.isFinite(evidence.simulatedAtMs) || evidence.simulatedAtMs <= 0 || evidence.simulatedAtMs > now ||
      !Number.isSafeInteger(evidence.computeUnitsConsumed) || evidence.computeUnitsConsumed < 0 ||
      !Number.isSafeInteger(evidence.computeUnitsLimit) || evidence.computeUnitsLimit <= 0 ||
      typeof evidence.isSimulationSuccess !== 'boolean' ||
      (evidence.errorDetails !== undefined && evidence.errorDetails !== null && typeof evidence.errorDetails !== 'string') ||
      !Number.isFinite(evidence.expectedSolOut) || evidence.expectedSolOut < 0 ||
      !Number.isFinite(evidence.expectedTokenOut) || evidence.expectedTokenOut < 0 ||
      !Number.isFinite(evidence.expectedSlippageBps) || evidence.expectedSlippageBps < 0 || evidence.expectedSlippageBps > 10_000 ||
      (evidence.priorityFeeLamports !== undefined && (typeof evidence.priorityFeeLamports !== 'bigint' || evidence.priorityFeeLamports < 0n)) ||
      (this.maxPriorityFeeLamports !== undefined && evidence.priorityFeeLamports === undefined) ||
      (evidence.tipLamports !== undefined && (typeof evidence.tipLamports !== 'bigint' || evidence.tipLamports < 0n)) ||
      !Number.isFinite(now) || now < 0 ||
      !Number.isFinite(context.tradeNotionalSol) || (context.tradeNotionalSol ?? 0) <= 0 ||
      (this.maxDailyDrawdownSol !== undefined && (!Number.isFinite(context.dailyDrawdownSol) || (context.dailyDrawdownSol ?? -1) < 0));

    if (invalid) {
      this.totalRejected++;
      return makeCertificate({
        mint, slot, verdict: 'MALFORMED_EVIDENCE', reason: 'Simulation evidence or required risk context is missing or out of bounds',
        stalenessMs: 0, cuUtilizationPct: 100, expectedSlippageBps: 10_000, evaluatedAtMs: Number.isFinite(now) && now >= 0 ? now : 0,
        evidenceDigestInput: 'INVALID_EVIDENCE',
      });
    }

    const stalenessMs = now - evidence.simulatedAtMs;
    const cuRatio = evidence.computeUnitsConsumed / evidence.computeUnitsLimit;
    const cuUtilizationPct = Number((cuRatio * 100).toFixed(1));
    let verdict: SimulationRiskVerdict = 'SIMULATION_APPROVED';
    let rejectionReason: string | null = null;

    if (!evidence.isSimulationSuccess) {
      verdict = 'SIMULATION_FAILED';
      rejectionReason = `Simulated execution instruction failed: ${evidence.errorDetails || 'CUSTOM_ERROR'}`;
    } else if (stalenessMs > this.maxAllowedSimulationAgeMs) {
      verdict = 'SIMULATION_STALE';
      rejectionReason = `Simulation age ${stalenessMs}ms exceeds max allowed ${this.maxAllowedSimulationAgeMs}ms`;
    } else if (cuRatio > this.maxAllowedCuRatio) {
      verdict = 'CU_BUDGET_EXCEEDED';
      rejectionReason = `Simulated CU consumption (${cuUtilizationPct}%) exceeds budget ceiling (${(this.maxAllowedCuRatio * 100).toFixed(0)}%)`;
    } else if (evidence.expectedSlippageBps > this.maxAllowedSlippageBps) {
      verdict = 'SLIPPAGE_EXCEEDED';
      rejectionReason = `Simulated slippage ${evidence.expectedSlippageBps} bps exceeds max ${this.maxAllowedSlippageBps} bps`;
    } else if (context.tradeNotionalSol! > this.maxTradeNotionalSol) {
      verdict = 'NOTIONAL_CAP_EXCEEDED';
      rejectionReason = `Trade notional ${context.tradeNotionalSol!.toFixed(2)} SOL exceeds ceiling ${this.maxTradeNotionalSol.toFixed(2)} SOL`;
    } else if (this.maxDailyDrawdownSol !== undefined && context.dailyDrawdownSol! > this.maxDailyDrawdownSol) {
      verdict = 'DAILY_DRAWDOWN_LIMIT_EXCEEDED';
      rejectionReason = `Daily drawdown ${context.dailyDrawdownSol!.toFixed(4)} SOL exceeds ceiling ${this.maxDailyDrawdownSol.toFixed(4)} SOL`;
    } else if (this.maxPriorityFeeLamports !== undefined && evidence.priorityFeeLamports! > this.maxPriorityFeeLamports) {
      verdict = 'PRIORITY_FEE_CAP_EXCEEDED';
      rejectionReason = `Simulated priority fee ${evidence.priorityFeeLamports!.toString()} lamports exceeds cap ${this.maxPriorityFeeLamports.toString()}`;
    } else if (evidence.tipLamports !== undefined && evidence.tipLamports > this.maxTipLamports) {
      verdict = 'TIP_CAP_EXCEEDED';
      rejectionReason = `Simulated tip ${evidence.tipLamports.toString()} lamports exceeds cap ${this.maxTipLamports.toString()}`;
    }

    const evidenceDigestInput = JSON.stringify({
      simulationId: evidence.simulationId,
      mint: evidence.mint,
      slot: evidence.slot,
      simulatedAtMs: evidence.simulatedAtMs,
      computeUnitsConsumed: evidence.computeUnitsConsumed,
      computeUnitsLimit: evidence.computeUnitsLimit,
      isSimulationSuccess: evidence.isSimulationSuccess,
      errorDetails: evidence.errorDetails ?? null,
      expectedSolOut: evidence.expectedSolOut,
      expectedTokenOut: evidence.expectedTokenOut,
      expectedSlippageBps: evidence.expectedSlippageBps,
      priorityFeeLamports: evidence.priorityFeeLamports?.toString() ?? null,
      tipLamports: evidence.tipLamports?.toString() ?? null,
      tradeNotionalSol: context.tradeNotionalSol,
      dailyDrawdownSol: context.dailyDrawdownSol ?? null,
    });
    const certificate = makeCertificate({
      mint, slot, verdict, reason: rejectionReason, stalenessMs, cuUtilizationPct,
      expectedSlippageBps: evidence.expectedSlippageBps, evaluatedAtMs: now, evidenceDigestInput,
    });
    if (certificate.isApproved) this.totalApproved++;
    else this.totalRejected++;
    return certificate;
  }

  public getStats(): { totalEvaluated: number; totalApproved: number; totalRejected: number } {
    return { totalEvaluated: this.totalEvaluated, totalApproved: this.totalApproved, totalRejected: this.totalRejected };
  }
}
