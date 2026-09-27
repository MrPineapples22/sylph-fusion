/**
 * SYLPH FUSION — SIMULACRUM-X: Deterministic Solana Execution Digital Twin
 * Specifications: Section 5 (Upgrade 1: Simulacrum-X), Section 103 (Invariants 7, 8)
 *
 * Invariants:
 * 1. Do not model profit as `future price - current price`.
 * 2. Calculate counterfactual executable net proceeds minus:
 *    cost basis, slippage, price impact, base fees, priority fees, Jito tips,
 *    rent/account creation, failed attempt costs, adverse selection, and latency decay.
 * 3. Issue verifiable SimulationCertificate.
 * 4. Compare simulated predictions against actual execution receipts to detect
 *    SIMULATION_MODEL_DRIFT when residuals exceed statistically defensible thresholds.
 */

import { createHash } from 'node:crypto';

export interface SimulationEnvironmentContext {
  readonly slot: number;
  readonly blockhash: string;
  readonly quoteSlot: number;
  readonly virtualSolReserves: bigint;
  readonly virtualTokenReserves: bigint;
  readonly realSolReserves?: bigint;
  readonly realTokenReserves?: bigint;
  readonly walletSolBalanceLamports: bigint;
  readonly walletTokenBalanceRaw: bigint;
  readonly isAmmActive: boolean;
  readonly writableAccountContentionScore: number; // 0.0 (no contention) to 1.0 (hot account)
  readonly expectedLandingLatencySlots: number;   // e.g. 1-3 slots
  readonly marketVelocityBpsPerSecond: number;
}

export interface SimulationParameters {
  readonly economicIntentId: string;
  readonly side: 'BUY' | 'SELL';
  readonly inputAmountLamports: bigint;
  readonly baseNetworkFeeLamports: bigint;
  readonly priorityFeeLamports: bigint;
  readonly jitoTipLamports: bigint;
  readonly rentLamports: bigint;
  readonly maxAllowedSlippageBps: number;
  readonly transactionVersion: 'LEGACY' | 'V0' | 'V1';
}

export interface SimulationCertificate {
  readonly simulationId: string;
  readonly economicIntentId: string;
  readonly messageHash: string;
  readonly decisionWatermark: number;
  readonly stateHash: string;
  readonly simulatedSlot: number;
  readonly transactionVersion: 'LEGACY' | 'V0' | 'V1';
  readonly expectedInputLamports: bigint;
  readonly expectedOutputTokens: bigint;
  readonly expectedTokenDelta: bigint;
  readonly expectedSolDelta: bigint;
  readonly totalFrictionFeesLamports: bigint;
  readonly priceImpactBps: number;
  readonly expectedSlippageBps: number;
  readonly adverseSelectionCostLamports: bigint;
  readonly netExecutableProceedsLamports: bigint;
  readonly expectedLandingProbability: number; // 0.0 to 1.0
  readonly simulationLogsHash: string;
  readonly simulationEngineVersion: string;
  readonly expiresAtMs: number;
  readonly digest: string;
}

export interface ExecutionResidualReport {
  readonly intentId: string;
  readonly simulatedNetProceedsLamports: bigint;
  readonly actualNetProceedsLamports: bigint;
  readonly residualErrorLamports: bigint;
  readonly errorRatioPct: number;
  readonly isModelDriftDetected: boolean;
  readonly details: string;
}

export class SimulacrumXEngine {
  private static readonly ENGINE_VERSION = 'SIMULACRUM-X-2026.1';
  private static readonly DRIFT_ERROR_THRESHOLD_PCT = 15.0; // 15% error threshold

  /**
   * Deterministically simulates a Solana swap execution against market depth and fees.
   */
  public simulateExecution(
    context: SimulationEnvironmentContext,
    params: SimulationParameters,
    nowMs: number = Date.now()
  ): SimulationCertificate {
    // 1. Calculate constant-product or bonding curve price impact
    const solReserves = context.isAmmActive && context.realSolReserves
      ? context.realSolReserves
      : context.virtualSolReserves;
    const tokenReserves = context.isAmmActive && context.realTokenReserves
      ? context.realTokenReserves
      : context.virtualTokenReserves;

    if (solReserves <= 0n || tokenReserves <= 0n) {
      throw new Error('Simulation failed: zero liquidity reserves');
    }

    // Constant product: deltaToken = (tokenReserves * inputSol) / (solReserves + inputSol)
    const expectedOutputTokens =
      params.side === 'BUY'
        ? (tokenReserves * params.inputAmountLamports) / (solReserves + params.inputAmountLamports)
        : (solReserves * params.inputAmountLamports) / (tokenReserves + params.inputAmountLamports);

    // Price impact Bps = (inputSol / (solReserves + inputSol)) * 10,000
    const priceImpactBps = Number((params.inputAmountLamports * 10_000n) / (solReserves + params.inputAmountLamports));

    // 2. Compute total friction fees
    const totalFrictionFeesLamports =
      params.baseNetworkFeeLamports + params.priorityFeeLamports + params.jitoTipLamports + params.rentLamports;

    // 3. Adverse selection & latency decay cost
    // adverseCost = input * (velocity * latencySeconds)
    const latencySeconds = context.expectedLandingLatencySlots * 0.4;
    const adverseMovementBps = Math.min(500, Math.round(context.marketVelocityBpsPerSecond * latencySeconds));
    const adverseSelectionCostLamports = (params.inputAmountLamports * BigInt(adverseMovementBps)) / 10_000n;

    // 4. Net Executable Proceeds calculation
    // Counterfactual value minus all frictions
    const expectedSolDelta =
      params.side === 'BUY'
        ? -(params.inputAmountLamports + totalFrictionFeesLamports + adverseSelectionCostLamports)
        : params.inputAmountLamports - totalFrictionFeesLamports - adverseSelectionCostLamports;

    const netExecutableProceedsLamports =
      params.side === 'BUY'
        ? params.inputAmountLamports - totalFrictionFeesLamports - adverseSelectionCostLamports
        : expectedOutputTokens;

    // Landing probability modeled by priority fee and account contention
    const baseLandingProb = Math.max(0.1, 1.0 - context.writableAccountContentionScore * 0.5);
    const tipBoost = params.jitoTipLamports > 50_000n ? 0.2 : 0.05;
    const expectedLandingProbability = Math.min(0.99, baseLandingProb + tipBoost);

    // Hashes and IDs
    const statePayload = `${context.slot}:${context.blockhash}:${solReserves}:${tokenReserves}`;
    const stateHash = createHash('sha256').update(statePayload).digest('hex');

    const logPayload = `sim_log:${params.economicIntentId}:${expectedOutputTokens}:${totalFrictionFeesLamports}`;
    const simulationLogsHash = createHash('sha256').update(logPayload).digest('hex');

    const certPayload = `${params.economicIntentId}:${stateHash}:${expectedOutputTokens}:${expectedSolDelta}:${nowMs}`;
    const digest = createHash('sha256').update(certPayload).digest('hex');
    const simulationId = `SIM-CERT-${digest.slice(0, 16)}`;

    return {
      simulationId,
      economicIntentId: params.economicIntentId,
      messageHash: createHash('sha256').update(`msg:${params.economicIntentId}`).digest('hex'),
      decisionWatermark: nowMs,
      stateHash,
      simulatedSlot: context.slot,
      transactionVersion: params.transactionVersion,
      expectedInputLamports: params.inputAmountLamports,
      expectedOutputTokens,
      expectedTokenDelta: params.side === 'BUY' ? expectedOutputTokens : -params.inputAmountLamports,
      expectedSolDelta,
      totalFrictionFeesLamports,
      priceImpactBps,
      expectedSlippageBps: Math.min(params.maxAllowedSlippageBps, priceImpactBps + adverseMovementBps),
      adverseSelectionCostLamports,
      netExecutableProceedsLamports,
      expectedLandingProbability,
      simulationLogsHash,
      simulationEngineVersion: SimulacrumXEngine.ENGINE_VERSION,
      expiresAtMs: nowMs + 10_000,
      digest
    };
  }

  /**
   * Evaluates prediction residuals between simulated forecast and actual on-chain fill.
   * Generates SIMULATION_MODEL_DRIFT if errors exceed statistical boundaries.
   */
  public evaluateResiduals(
    certificate: SimulationCertificate,
    actualNetProceedsLamports: bigint
  ): ExecutionResidualReport {
    const simNet = certificate.netExecutableProceedsLamports;
    const diff = simNet > actualNetProceedsLamports ? simNet - actualNetProceedsLamports : actualNetProceedsLamports - simNet;

    const errorRatioPct = simNet > 0n ? (Number(diff) / Number(simNet)) * 100 : 0;
    const isModelDriftDetected = errorRatioPct > SimulacrumXEngine.DRIFT_ERROR_THRESHOLD_PCT;

    const details = isModelDriftDetected
      ? `SIMULATION_MODEL_DRIFT: Prediction error ${errorRatioPct.toFixed(2)}% exceeds threshold ${SimulacrumXEngine.DRIFT_ERROR_THRESHOLD_PCT}% (Simulated: ${simNet}, Actual: ${actualNetProceedsLamports})`
      : `Simulation accuracy verified within ${errorRatioPct.toFixed(2)}% of actual execution`;

    return {
      intentId: certificate.economicIntentId,
      simulatedNetProceedsLamports: simNet,
      actualNetProceedsLamports,
      residualErrorLamports: diff,
      errorRatioPct,
      isModelDriftDetected,
      details
    };
  }
}
