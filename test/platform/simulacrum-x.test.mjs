import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SimulacrumXEngine
} from '../../dist/platform/simulation/simulacrum-x.js';

describe('SIMULACRUM-X: Deterministic Solana Execution Digital Twin (Upgrade 1)', () => {
  const engine = new SimulacrumXEngine();

  const mockContext = {
    slot: 289450000,
    blockhash: '5BlockhashSimulacrum111111111111111111111111111',
    quoteSlot: 289450000,
    virtualSolReserves: 30_000_000_000n, // 30 SOL
    virtualTokenReserves: 1_000_000_000_000n,
    walletSolBalanceLamports: 10_000_000_000n,
    walletTokenBalanceRaw: 0n,
    isAmmActive: false,
    writableAccountContentionScore: 0.2,
    expectedLandingLatencySlots: 2,
    marketVelocityBpsPerSecond: 50
  };

  it('calculates counterfactual net proceeds minus friction, adverse selection and impact', () => {
    const cert = engine.simulateExecution(mockContext, {
      economicIntentId: 'INTENT-SIM-001',
      side: 'BUY',
      inputAmountLamports: 100_000_000n, // 0.1 SOL
      baseNetworkFeeLamports: 5_000n,
      priorityFeeLamports: 50_000n,
      jitoTipLamports: 100_000n,
      rentLamports: 2_039_280n,
      maxAllowedSlippageBps: 300,
      transactionVersion: 'V0'
    });

    assert.ok(cert.simulationId.startsWith('SIM-CERT-'));
    assert.equal(cert.totalFrictionFeesLamports, 5_000n + 50_000n + 100_000n + 2_039_280n);
    assert.ok(cert.priceImpactBps > 0);
    assert.ok(cert.adverseSelectionCostLamports > 0n);
    assert.ok(cert.expectedLandingProbability >= 0.85);

    // Invariant: Net proceeds must be less than gross input due to friction
    assert.ok(cert.netExecutableProceedsLamports < cert.expectedInputLamports);
  });

  it('detects SIMULATION_MODEL_DRIFT when actual on-chain fill differs by > 15%', () => {
    const cert = engine.simulateExecution(mockContext, {
      economicIntentId: 'INTENT-DRIFT-001',
      side: 'BUY',
      inputAmountLamports: 100_000_000n,
      baseNetworkFeeLamports: 5_000n,
      priorityFeeLamports: 50_000n,
      jitoTipLamports: 100_000n,
      rentLamports: 0n,
      maxAllowedSlippageBps: 200,
      transactionVersion: 'V0'
    });

    // Case 1: Fill close to simulated -> NO drift
    const goodActual = cert.netExecutableProceedsLamports - 1_000n; // ~0.001% diff
    const goodReport = engine.evaluateResiduals(cert, goodActual);
    assert.equal(goodReport.isModelDriftDetected, false);
    assert.ok(goodReport.details.includes('Simulation accuracy verified'));

    // Case 2: Severe slippage on-chain (actual proceeds 25% lower) -> DRIFT DETECTED
    const badActual = (cert.netExecutableProceedsLamports * 75n) / 100n; // 25% lower
    const driftReport = engine.evaluateResiduals(cert, badActual);
    assert.equal(driftReport.isModelDriftDetected, true);
    assert.ok(driftReport.details.includes('SIMULATION_MODEL_DRIFT'));
  });
});
