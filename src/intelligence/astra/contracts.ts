import type { FeatureSnapshot } from '../truth/types.js';

export const ASTRA_VERSION = '1.0.0';
export type AstraStatus = 'VERIFIED' | 'DEGRADED' | 'UNKNOWN' | 'FAILED';
export type Regime = 'TRENDING' | 'NORMAL' | 'CHOPPY' | 'LOW_LIQUIDITY' | 'HIGH_VOLATILITY' | 'RISK_OFF' | 'UNKNOWN';
export type FeatureName = 'price_velocity' | 'price_acceleration' | 'buy_sell_ratio' | 'liquidity' |
  'market_cap' | 'liquidity_velocity' | 'wallet_concentration' | 'unique_buyers' |
  'first_buyer_quality' | 'bundle_rate' | 'wash_ratio' | 'rug_score' | 'dev_concentration' |
  'volatility' | 'provider_error_rate' | 'provider_slot_lag';
export interface FeatureDefinition {
  readonly name: FeatureName; readonly type: 'number'; readonly unit: string; readonly windowMs: number;
  readonly formula: string; readonly version: string; readonly missingPolicy: 'UNKNOWN';
  readonly freshnessLimitMs: number; readonly minimum: number; readonly maximum: number;
}
export interface FeatureObservation {
  readonly name: FeatureName; readonly value: number | null; readonly source: string;
  readonly evidenceId: string; readonly correlationGroup: string; readonly observedAt: number;
  readonly availableAt: number; readonly unit: string; readonly windowMs: number;
  readonly confidence: number; readonly conflict: boolean;
}
export interface AstraFeatureContext {
  readonly snapshot: FeatureSnapshot;
  readonly observations: Readonly<Partial<Record<FeatureName, FeatureObservation>>>;
  readonly rejected: readonly string[];
}
export interface AstraSignal {
  readonly opportunity: number | null; readonly risk: number | null;
  readonly regime: Regime; readonly reasons: readonly string[];
}
export interface AstraAgentResult {
  readonly agentId: string; readonly agentVersion: string; readonly timestamp: number;
  readonly snapshotHash: string; readonly status: AstraStatus; readonly result: AstraSignal;
  readonly confidence: number; readonly evidence: readonly FeatureObservation[];
  readonly provenance: {readonly sources: readonly string[]; readonly featureVersion: string; readonly modelVersion?: string};
  readonly diagnostics: {readonly latencyMs: number; readonly oldestInputAgeMs: number | null;
    readonly staleInput: boolean; readonly driftDetected: boolean};
  readonly warnings: readonly string[];
}
export interface AstraAgent {
  readonly id: string; readonly version: string; readonly requiredFeatures: readonly FeatureName[];
  readonly cost: 'CHEAP' | 'DEEP';
  analyze(context: AstraFeatureContext, now: number, signal: AbortSignal): Promise<AstraAgentResult>;
}
export interface ModelRecord {
  readonly modelId: string; readonly modelVersion: string; readonly modelType: 'RULE' | 'ML';
  readonly featureSchema: string; readonly trainingDataVersion: string | null; readonly createdAt: number;
  readonly validationResults: {readonly evidenceId: string; readonly asOf: number; readonly samples: number;
    readonly outOfSample: boolean; readonly accuracy: number} | null;
  readonly activeStatus: 'RESEARCH' | 'SHADOW' | 'ACTIVE' | 'RETIRED';
  readonly calibration: number | null; readonly reliability: number | null;
  readonly supportedRegimes: readonly Regime[]; readonly knownLimitations: readonly string[];
  readonly health: 'HEALTHY' | 'WATCH' | 'DEGRADED' | 'UNTRUSTED' | 'UNKNOWN';
}
export interface AstraConsensusResult {
  readonly opportunityScore: number | null; readonly riskScore: number | null; readonly confidence: number;
  readonly disagreement: number; readonly signalConflict: boolean; readonly uncertainty: number;
  readonly dataQuality: 'VERIFIED' | 'PARTIAL' | 'UNKNOWN'; readonly marketRegime: Regime;
  readonly warnings: readonly string[]; readonly contributingAgents: readonly string[];
  readonly verificationState: 'UNVERIFIED'; readonly agentEvidence: readonly AstraAgentResult[];
}
export interface AstraVerification {
  readonly state: 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'FAILED';
  readonly reasons: readonly string[]; readonly independentOracle: 'RULE_REPLAY';
  readonly executionAuthorized: false;
}
