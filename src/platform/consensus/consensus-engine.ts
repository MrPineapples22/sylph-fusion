import { DimensionVerdict, StructuredDecisionPacket } from './types.js';
import { CapacityEngine, CapacityConstraints } from './capacity-engine.js';
import { SecurityGatewayResult } from '../security/token-gateway.js';
import { RiskAuthorization } from '../risk/types.js';

export interface ConsensusInput {
  candidateId: string;
  mint: string;
  securityResult: SecurityGatewayResult;
  riskAuth: RiskAuthorization;
  poolLiquidityLamports: bigint;
  alphaScore: number;       // 0 to 100
  momentumScore: number;    // 0 to 100
  regimeScore: number;      // 0 to 100
  walletIntegrityScore: number; // 0 to 100
  executionQualityScore: number; // 0 to 100
  portfolioFitScore: number; // 0 to 100
  expectedEdgeBps: number;
  capacityConstraints: CapacityConstraints;
}

export class TradeConsensusEngine {
  private capacityEngine = new CapacityEngine();

  evaluateConsensus(input: ConsensusInput): StructuredDecisionPacket {
    const hardVetoes: string[] = [];

    // 1. Security Dimension (Hard Veto if BLOCK)
    const securityVeto = input.securityResult.verdict === 'BLOCK';
    if (securityVeto) hardVetoes.push(`security_block: ${input.securityResult.reason}`);
    const securityDim: DimensionVerdict = {
      passed: input.securityResult.verdict === 'ALLOW' || input.securityResult.verdict === 'LIMIT',
      score: 100 - input.securityResult.riskScore,
      hardVeto: securityVeto,
      reason: input.securityResult.reason,
    };

    // 2. Risk Dimension (Hard Veto if REJECT)
    const riskVeto = input.riskAuth.disposition === 'REJECT';
    if (riskVeto) hardVetoes.push(`risk_reject: ${input.riskAuth.rejectionReason}`);
    const riskDim: DimensionVerdict = {
      passed: input.riskAuth.disposition !== 'REJECT',
      score: input.riskAuth.disposition === 'APPROVE' ? 90 : input.riskAuth.disposition === 'REDUCE' ? 60 : 0,
      hardVeto: riskVeto,
      reason: input.riskAuth.rejectionReason ?? 'Approved by risk engine',
    };

    // 3. Alpha & Momentum Dimensions
    const alphaDim: DimensionVerdict = {
      passed: input.alphaScore >= 50,
      score: input.alphaScore,
      hardVeto: false,
      reason: input.alphaScore >= 50 ? 'Strong predictive signal' : 'Weak alpha score',
    };

    const momentumDim: DimensionVerdict = {
      passed: input.momentumScore >= 45,
      score: input.momentumScore,
      hardVeto: false,
      reason: input.momentumScore >= 45 ? 'Positive momentum velocity' : 'Negative/neutral momentum',
    };

    // 4. Wallet Integrity Dimension
    const walletDim: DimensionVerdict = {
      passed: input.walletIntegrityScore >= 50,
      score: input.walletIntegrityScore,
      hardVeto: input.walletIntegrityScore < 20, // Hard veto on cluster collusion
      reason: input.walletIntegrityScore >= 50 ? 'Clean wallet graph' : 'Cluster/funder flags detected',
    };
    if (walletDim.hardVeto) hardVetoes.push('wallet_integrity_severe_failure');

    // 5. Liquidity & Execution Dimensions
    const liqPassed = input.poolLiquidityLamports >= 1_000_000_000n;
    const liquidityDim: DimensionVerdict = {
      passed: liqPassed,
      score: liqPassed ? 85 : 30,
      hardVeto: !liqPassed,
      reason: liqPassed ? 'Liquidity depth adequate' : 'Insufficient pool liquidity',
    };
    if (liquidityDim.hardVeto) hardVetoes.push('shallow_liquidity_veto');

    const execDim: DimensionVerdict = {
      passed: input.executionQualityScore >= 50,
      score: input.executionQualityScore,
      hardVeto: false,
      reason: `Execution score: ${input.executionQualityScore}/100`,
    };

    // 6. Regime & Portfolio Fit Dimensions
    const regimeDim: DimensionVerdict = {
      passed: input.regimeScore >= 40,
      score: input.regimeScore,
      hardVeto: false,
      reason: `Regime score: ${input.regimeScore}/100`,
    };

    const portfolioDim: DimensionVerdict = {
      passed: input.portfolioFitScore >= 50,
      score: input.portfolioFitScore,
      hardVeto: false,
      reason: `Portfolio fit: ${input.portfolioFitScore}/100`,
    };

    // 7. Calculate Signal Disagreement (Variance between predictive signals)
    const signals = [input.alphaScore, input.momentumScore, input.regimeScore];
    const mean = signals.reduce((a, b) => a + b, 0) / signals.length;
    const variance = signals.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / signals.length;
    const disagreementScore = Math.min(100, Math.round(Math.sqrt(variance) * 2.5));

    // 8. Capacity & Adversarial Stress Simulation
    let authorizedCap = input.riskAuth.authorizedAmountLamports;
    if (input.securityResult.allowedMaxPositionSizeLamports !== null) {
      if (authorizedCap > input.securityResult.allowedMaxPositionSizeLamports) {
        authorizedCap = input.securityResult.allowedMaxPositionSizeLamports;
      }
    }

    const maxCapacityLamports = this.capacityEngine.calculateMaxAuthorizedPosition(
      input.capacityConstraints,
      authorizedCap
    );

    const stressReport = this.capacityEngine.runAdversarialSimulation(
      maxCapacityLamports,
      input.poolLiquidityLamports
    );

    if (stressReport.catastrophicFailureDetected) {
      hardVetoes.push('adversarial_simulation_catastrophic_failure');
    }

    const { edgeAfterCapacityBps, degradationBps, viable } = this.capacityEngine.calculateEdgeAfterCapacity(
      input.expectedEdgeBps,
      maxCapacityLamports,
      input.poolLiquidityLamports
    );

    if (!viable) {
      hardVetoes.push(`negative_or_insufficient_edge_after_capacity_${edgeAfterCapacityBps}bps`);
    }

    // FUNDAMENTAL INVARIANT: Hard vetoes CANNOT be overridden by high alpha
    const overallAccepted = hardVetoes.length === 0 && disagreementScore < 50;

    return {
      candidateId: input.candidateId,
      mint: input.mint,
      overallAccepted,
      disagreementScore,
      dimensions: {
        alpha: alphaDim,
        momentum: momentumDim,
        walletIntegrity: walletDim,
        security: securityDim,
        liquidity: liquidityDim,
        executionQuality: execDim,
        marketRegime: regimeDim,
        portfolioFit: portfolioDim,
        risk: riskDim,
      },
      hardVetoes,
      maxCapacityLamports: overallAccepted ? maxCapacityLamports : 0n,
      expectedEdgeBps: input.expectedEdgeBps,
      expectedExecutionDegradationBps: degradationBps,
      edgeAfterCapacityBps,
      adversarialSurvivabilityScore: stressReport.overallSurvivabilityScore,
      timestamp: Date.now(),
    };
  }
}
