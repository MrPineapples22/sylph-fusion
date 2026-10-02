/** Constant-product research scenarios only. Not a protocol quote, RPC simulation,
 * landing prediction, execution certificate, or authorization. Production Pump
 * economics remain in Market's SDK-backed quote path. All costs are assumptions.
 */
import { createHash } from 'node:crypto';

export interface ResearchPoolContext {
  readonly model: 'CONSTANT_PRODUCT_SCENARIO';
  readonly solReserveLamports: bigint;
  readonly tokenReserveRaw: bigint;
  readonly walletSolLamports: bigint;
  readonly walletTokenRaw: bigint;
}
interface ResearchCosts {
  readonly economicIntentId: string;
  /** Additive SOL costs, outside the curve input/output. Not a protocol fee rule. */
  readonly assumedNetworkCostLamports: bigint;
  readonly assumedRouteCostLamports: bigint;
  readonly assumedAdverseCostLamports: bigint;
  readonly maxPriceImpactBps: number;
}
export type ResearchSwapParameters = ResearchCosts & (
  { readonly side: 'BUY'; readonly inputLamports: bigint; readonly inputTokenRaw?: never } |
  { readonly side: 'SELL'; readonly inputTokenRaw: bigint; readonly inputLamports?: never }
);
export interface ResearchSwapEstimate {
  readonly evidenceClass: 'RESEARCH_ONLY_SYNTHETIC';
  readonly isSimulationCertificate: false;
  readonly modelVersion: 'SIMULACRUM-RESEARCH-2';
  readonly economicIntentId: string;
  readonly side: 'BUY' | 'SELL';
  readonly observedAtMs: number;
  readonly assumptions: Readonly<ResearchPoolContext & ResearchSwapParameters>;
  readonly outputLamports: bigint;
  readonly outputTokenRaw: bigint;
  readonly tokenDeltaRaw: bigint;
  readonly solCashDeltaLamports: bigint;
  readonly assumedTotalCostsLamports: bigint;
  /** Exact rational impact, before costs; rounded upward for displayed basis points. */
  readonly priceImpactBps: number;
  readonly priceImpactLimitExceeded: boolean;
  readonly walletFeasibleUnderAssumptions: boolean;
  readonly scenarioHash: string;
}
export interface ResearchResidualReport {
  readonly residualErrorLamports: bigint;
  readonly errorRatioBps: bigint | null;
  readonly status: 'ZERO_BASELINE_UNDEFINED' | 'WITHIN_POLICY_THRESHOLD' | 'POLICY_THRESHOLD_EXCEEDED';
  readonly thresholdBps: number;
}
function amount(name: string, value: unknown, positive = false): asserts value is bigint {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value > 18_446_744_073_709_551_615n)
    throw new Error(`${name} must be a ${positive ? 'positive' : 'nonnegative'} u64 bigint`);
}
function integer(name: string, value: number, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`${name} is invalid`);
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex');
}
export class SimulacrumXEngine {
  public simulateExecution(context: ResearchPoolContext, params: ResearchSwapParameters, nowMs: number): ResearchSwapEstimate {
    if (context.model !== 'CONSTANT_PRODUCT_SCENARIO') throw new Error('Unsupported research model');
    integer('observedAtMs', nowMs);
    integer('maxPriceImpactBps', params.maxPriceImpactBps, 10_000);
    if (typeof params.economicIntentId !== 'string' || !params.economicIntentId.trim()) throw new Error('economicIntentId required');
    if (params.side !== 'BUY' && params.side !== 'SELL') throw new Error('Invalid side');
    if ((params.side === 'BUY' && 'inputTokenRaw' in params) || (params.side === 'SELL' && 'inputLamports' in params)) throw new Error('Conflicting input denomination');
    amount('solReserveLamports', context.solReserveLamports, true);
    amount('tokenReserveRaw', context.tokenReserveRaw, true);
    amount('walletSolLamports', context.walletSolLamports);
    amount('walletTokenRaw', context.walletTokenRaw);
    amount('assumedNetworkCostLamports', params.assumedNetworkCostLamports);
    amount('assumedRouteCostLamports', params.assumedRouteCostLamports);
    amount('assumedAdverseCostLamports', params.assumedAdverseCostLamports);
    const input = params.side === 'BUY' ? params.inputLamports : params.inputTokenRaw;
    amount('input', input, true);
    const inputReserve = params.side === 'BUY' ? context.solReserveLamports : context.tokenReserveRaw;
    const outputReserve = params.side === 'BUY' ? context.tokenReserveRaw : context.solReserveLamports;
    const output = outputReserve * input / (inputReserve + input);
    const costs = params.assumedNetworkCostLamports + params.assumedRouteCostLamports + params.assumedAdverseCostLamports;
    const solCashDeltaLamports = params.side === 'BUY' ? -(input + costs) : output - costs;
    // Snapshot known fields explicitly; ignore unrelated caller properties and retain no mutable aliases.
    const assumptions = Object.freeze({model: context.model, solReserveLamports: context.solReserveLamports,
      tokenReserveRaw: context.tokenReserveRaw, walletSolLamports: context.walletSolLamports, walletTokenRaw: context.walletTokenRaw,
      economicIntentId: params.economicIntentId, side: params.side,
      ...(params.side === 'BUY' ? {inputLamports: input} : {inputTokenRaw: input}),
      assumedNetworkCostLamports: params.assumedNetworkCostLamports, assumedRouteCostLamports: params.assumedRouteCostLamports,
      assumedAdverseCostLamports: params.assumedAdverseCostLamports, maxPriceImpactBps: params.maxPriceImpactBps}) as Readonly<ResearchPoolContext & ResearchSwapParameters>;
    const payload = {evidenceClass: 'RESEARCH_ONLY_SYNTHETIC' as const, isSimulationCertificate: false as const,
      modelVersion: 'SIMULACRUM-RESEARCH-2' as const, economicIntentId: params.economicIntentId, side: params.side,
      observedAtMs: nowMs, assumptions, outputLamports: params.side === 'SELL' ? output : 0n,
      outputTokenRaw: params.side === 'BUY' ? output : 0n, tokenDeltaRaw: params.side === 'BUY' ? output : -input,
      solCashDeltaLamports, assumedTotalCostsLamports: costs,
      priceImpactBps: Number((input * 10_000n + inputReserve + input - 1n) / (inputReserve + input)),
      priceImpactLimitExceeded: input * 10_000n > BigInt(params.maxPriceImpactBps) * (inputReserve + input),
      // Conservative upfront cost funding, including modeled adverse cost, even on SELL.
      walletFeasibleUnderAssumptions: context.walletSolLamports >= costs + (params.side === 'BUY' ? input : 0n)
        && (params.side === 'BUY' || context.walletTokenRaw >= input)};
    return Object.freeze({...payload, scenarioHash: hash(payload)});
  }
  /** Compare signed SOL cash deltas in one denomination, never BUY principal to exit proceeds.
   * A fixed threshold is a research policy, not a statistical or execution-quality certificate. */
  public evaluateResiduals(estimate: ResearchSwapEstimate, observedSolCashDeltaLamports: bigint, thresholdBps = 1500): ResearchResidualReport {
    integer('thresholdBps', thresholdBps, 10_000);
    if (typeof observedSolCashDeltaLamports !== 'bigint') throw new Error('Observed cash delta must be bigint');
    const predicted = estimate.solCashDeltaLamports;
    if (typeof predicted !== 'bigint') throw new Error('Predicted cash delta must be bigint');
    const abs = (x: bigint) => x < 0n ? -x : x;
    const residualErrorLamports = abs(predicted - observedSolCashDeltaLamports);
    const baseline = abs(predicted);
    return Object.freeze({residualErrorLamports, errorRatioBps: baseline === 0n ? null : residualErrorLamports * 10_000n / baseline,
      status: baseline === 0n ? 'ZERO_BASELINE_UNDEFINED' : residualErrorLamports * 10_000n > baseline * BigInt(thresholdBps)
        ? 'POLICY_THRESHOLD_EXCEEDED' : 'WITHIN_POLICY_THRESHOLD', thresholdBps});
  }
}
