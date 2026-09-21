export interface DimensionVerdict {
  passed: boolean;
  score: number; // 0 to 100
  hardVeto: boolean;
  reason: string;
}

export interface StructuredDecisionPacket {
  candidateId: string;
  mint: string;
  overallAccepted: boolean;
  disagreementScore: number; // 0 (full consensus) to 100 (complete divergence)
  dimensions: {
    alpha: DimensionVerdict;
    momentum: DimensionVerdict;
    walletIntegrity: DimensionVerdict;
    security: DimensionVerdict;
    liquidity: DimensionVerdict;
    executionQuality: DimensionVerdict;
    marketRegime: DimensionVerdict;
    portfolioFit: DimensionVerdict;
    risk: DimensionVerdict;
  };
  hardVetoes: string[];
  maxCapacityLamports: bigint;
  expectedEdgeBps: number;
  expectedExecutionDegradationBps: number;
  edgeAfterCapacityBps: number;
  adversarialSurvivabilityScore: number; // 0 to 100
  timestamp: number;
}

export interface StressScenarioResult {
  scenarioName: string;
  simulatedExitProceedsLamports: bigint;
  maxDrawdownPct: number;
  survived: boolean;
  liquidationPossible: boolean;
}

export interface AdversarialStressReport {
  overallSurvivabilityScore: number; // 0 to 100
  scenarios: StressScenarioResult[];
  catastrophicFailureDetected: boolean;
  recommendation: 'PASS' | 'DOWNSIZE' | 'REJECT';
}
