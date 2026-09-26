/**
 * Bounded advisory JEV/Laya pilot.
 *
 * This module deliberately accepts only an immutable AstraFeatureContext, which
 * is captured by the point-in-time feature adapter. It has no provider, wallet,
 * command, execution, or signer dependency. Its results are advisory and must
 * remain behind deterministic Guardian/Capital/Safety gates.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { AstraFeatureContext, FeatureName, FeatureObservation } from './contracts.js';
import { FEATURE_DEFINITIONS, FEATURE_SCHEMA, observationIssue } from './features.js';

export type JEVClassification = 'HIGH_INTEREST' | 'WATCH' | 'LOW_INTEREST' | 'NEED_MORE_EVIDENCE' | 'OOD' | 'UNRESOLVED';
export type AdvisoryState = 'SUPPORTED' | 'AMBIGUOUS' | 'CONFLICTED' | 'OOD' | 'INSUFFICIENT_EVIDENCE';
export type EscalationTarget = 'LAYA' | 'SPECIALIST' | 'EINSTEIN';
export interface EscalationPolicy {
  readonly uncertaintyThreshold: number;
  readonly evidenceCoverageMinimum: number;
  readonly oodAlwaysEscalates: boolean;
  readonly highValueAlwaysEscalates: boolean;
  readonly disagreementThreshold: number;
}
export const DEFAULT_ESCALATION_POLICY: EscalationPolicy = Object.freeze({
  uncertaintyThreshold: 0.35, evidenceCoverageMinimum: 0.7, oodAlwaysEscalates: true,
  highValueAlwaysEscalates: true, disagreementThreshold: 0.25,
});
export interface JEVDecision {
  readonly decisionId: string; readonly tokenId: string; readonly modelVersion: string; readonly modelHash: string;
  readonly marketStateHash: string; readonly featureSnapshotHash: string; readonly featureSchemaVersion: string;
  readonly classification: JEVClassification;
  readonly hypothesisProbabilities: Readonly<Record<'organicContinuation' | 'reflexiveChase' | 'distribution' | 'exhaustion' | 'liquidityFailure' | 'syntheticFlow', number>>;
  readonly uncertainty: number; readonly calibrationState: 'UNCALIBRATED_RULE'; readonly evidenceCoverage: number;
  readonly escalation: { readonly required: boolean; readonly reason?: string; readonly preferredAgent?: EscalationTarget };
  readonly warnings: readonly string[]; readonly generatedAt: number;
}
export interface LayaAssessment {
  readonly assessmentId: string; readonly tokenId: string; readonly modelVersion: string; readonly modelHash: string;
  readonly marketStateHash: string; readonly hypotheses: JEVDecision['hypothesisProbabilities'];
  readonly evidenceFor: readonly string[]; readonly evidenceAgainst: readonly string[]; readonly contradictions: readonly string[];
  readonly uncertaintySources: readonly string[]; readonly outOfDistribution: boolean;
  readonly recommendedNextEvidence: readonly string[]; readonly agreementWithJEV: number; readonly disagreementReasons: readonly string[];
  readonly state: AdvisoryState; readonly generatedAt: number;
}
export interface ModelDisagreement {
  readonly magnitude: number; readonly classification: 'LOW' | 'MEANINGFUL' | 'STRUCTURAL' | 'OOD';
  readonly hypothesisConflicts: readonly string[]; readonly likelyCause: string;
}
export interface InferenceCertificate {
  readonly decisionId: string; readonly modelName: 'JEV' | 'LAYA'; readonly modelVersion: string; readonly modelHash: string;
  readonly featureSchemaVersion: string; readonly featureSnapshotHash: string; readonly marketStateHash: string;
  readonly runtimeVersion: string; readonly inferenceStartedAt: number; readonly inferenceFinishedAt: number; readonly outputHash: string;
}

const MODEL_VERSION = Object.freeze({ JEV: 'jev-rule-v0', LAYA: 'laya-rule-v0' });
const modelHash = (name: keyof typeof MODEL_VERSION) => createHash('sha256').update(`${name}:${MODEL_VERSION[name]}:${FEATURE_SCHEMA}`).digest('hex');
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const values = (context: AstraFeatureContext, now: number) => {
  const valid: Partial<Record<FeatureName, number>> = {};
  const issues: string[] = [...context.rejected];
  for (const [name, observation] of Object.entries(context.observations) as [FeatureName, FeatureObservation][]) {
    const issue = observationIssue(observation, now);
    if (issue) issues.push(`${name}:${issue}`); else valid[name] = observation.value!;
  }
  if (context.snapshot.featureSchemaVersion !== FEATURE_SCHEMA) issues.push('FEATURE_SCHEMA_MISMATCH');
  return { valid, issues: [...new Set(issues)].sort() };
};
const baseHypotheses = (v: Partial<Record<FeatureName, number>>) => {
  const velocity = v.price_velocity ?? 0, liquidity = v.liquidity ?? 0, concentration = v.wallet_concentration ?? 1;
  const bundle = v.bundle_rate ?? 1, wash = v.wash_ratio ?? 1, rug = v.rug_score ?? 1;
  const organic = clamp(.35 + velocity * 20 + (v.buy_sell_ratio ?? 0) / 10 - concentration * .25 - bundle * .2 - wash * .2);
  const distribution = clamp(.15 + concentration * .45 + (v.dev_concentration ?? 1) * .3 - velocity * 10);
  const exhaustion = clamp(.2 - velocity * 20 + (v.volatility ?? 1) * .2);
  return Object.freeze({ organicContinuation: organic, reflexiveChase: clamp(.2 + velocity * 12 + bundle * .25), distribution,
    exhaustion, liquidityFailure: clamp(.8 - Math.min(1, liquidity / 100_000) + (v.liquidity_velocity ?? 0) * -20), syntheticFlow: clamp((bundle + wash + rug) / 3) });
};

/** JEV is intentionally fast, deterministic, bounded and advisory. */
export class JevEngine {
  decide(tokenId: string, context: AstraFeatureContext, now: number, policy: EscalationPolicy = DEFAULT_ESCALATION_POLICY): JEVDecision {
    if (!tokenId || !Number.isSafeInteger(now) || now <= 0) throw new Error('Invalid advisory decision identity/time');
    if (tokenId !== context.snapshot.mint) throw new Error('JEV token identity must match its immutable feature snapshot');
    const { valid, issues } = values(context, now);
    // Coverage is defined against the complete certified schema, never merely
    // against whichever inputs happened to arrive for this invocation.
    const coverage = Object.keys(valid).length / Object.keys(FEATURE_DEFINITIONS).length;
    const unusual = (valid.volatility ?? 0) > .08 || (valid.provider_error_rate ?? 0) > .2 || (valid.provider_slot_lag ?? 0) > 20;
    const uncertainty = clamp(1 - coverage + (unusual ? .25 : 0));
    const hypotheses = baseHypotheses(valid);
    const highInterest = hypotheses.organicContinuation >= .65 && hypotheses.distribution < .4 && hypotheses.liquidityFailure < .45;
    const classification: JEVClassification = issues.length || coverage < policy.evidenceCoverageMinimum ? 'NEED_MORE_EVIDENCE'
      : unusual ? 'OOD' : highInterest ? 'HIGH_INTEREST' : hypotheses.organicContinuation >= .45 ? 'WATCH' : 'LOW_INTEREST';
    const reason = classification === 'OOD' ? 'OOD_OR_PROVIDER_ANOMALY' : classification === 'NEED_MORE_EVIDENCE' ? 'INSUFFICIENT_CERTIFIED_EVIDENCE'
      : classification === 'HIGH_INTEREST' ? 'HIGH_VALUE_CANDIDATE' : uncertainty > policy.uncertaintyThreshold ? 'UNCERTAINTY' : undefined;
    const required = classification === 'OOD' && policy.oodAlwaysEscalates || classification === 'HIGH_INTEREST' && policy.highValueAlwaysEscalates || !!reason && classification !== 'LOW_INTEREST';
    return Object.freeze({ decisionId: randomUUID(), tokenId, modelVersion: MODEL_VERSION.JEV, modelHash: modelHash('JEV'),
      marketStateHash: context.snapshot.snapshotHash, featureSnapshotHash: context.snapshot.snapshotHash, featureSchemaVersion: FEATURE_SCHEMA,
      classification, hypothesisProbabilities: hypotheses, uncertainty, calibrationState: 'UNCALIBRATED_RULE', evidenceCoverage: coverage,
      escalation: Object.freeze(required ? { required, reason, preferredAgent: classification === 'OOD' ? 'EINSTEIN' : 'LAYA' } : { required: false }),
      warnings: Object.freeze(['ADVISORY_ONLY', 'RULE_UNCALIBRATED', ...issues]), generatedAt: now });
  }
}

/** Laya adds bounded contextual interpretation, never authority or raw-provider access. */
export class LayaEngine {
  assess(tokenId: string, context: AstraFeatureContext, jev: JEVDecision, now: number): LayaAssessment {
    if (jev.tokenId !== tokenId || jev.featureSnapshotHash !== context.snapshot.snapshotHash) throw new Error('Laya requires the exact JEV snapshot');
    const { valid, issues } = values(context, now);
    const hypotheses = baseHypotheses(valid);
    const magnitude = Math.max(...Object.keys(hypotheses).map(key => Math.abs(hypotheses[key as keyof typeof hypotheses] - jev.hypothesisProbabilities[key as keyof typeof hypotheses])));
    const ood = jev.classification === 'OOD' || issues.some(x => x.includes('SCHEMA') || x.includes('CONFLICT'));
    const state: AdvisoryState = ood ? 'OOD' : issues.length ? 'INSUFFICIENT_EVIDENCE' : magnitude > .25 ? 'AMBIGUOUS' : 'SUPPORTED';
    const evidence = Object.values(context.observations).filter(Boolean).map(x => x!.evidenceId);
    const against = hypotheses.distribution > .4 || hypotheses.liquidityFailure > .4 ? ['DISTRIBUTION_OR_LIQUIDITY_RISK'] : [];
    return Object.freeze({ assessmentId: randomUUID(), tokenId, modelVersion: MODEL_VERSION.LAYA, modelHash: modelHash('LAYA'),
      marketStateHash: context.snapshot.snapshotHash, hypotheses, evidenceFor: Object.freeze(evidence), evidenceAgainst: Object.freeze(against),
      contradictions: Object.freeze(issues), uncertaintySources: Object.freeze([...(ood ? ['OOD_OR_CONFLICT'] : []), ...(jev.warnings.filter(x => x !== 'ADVISORY_ONLY'))]), outOfDistribution: ood,
      recommendedNextEvidence: Object.freeze(state === 'INSUFFICIENT_EVIDENCE' ? ['REQUEST_CERTIFIED_FEATURES'] : state === 'OOD' ? ['ESCALATE_SPECIALIST'] : []),
      agreementWithJEV: clamp(1 - magnitude), disagreementReasons: Object.freeze(magnitude > .25 ? ['HYPOTHESIS_DIVERGENCE'] : []), state, generatedAt: now });
  }
}

export function assessDisagreement(jev: JEVDecision, laya: LayaAssessment): ModelDisagreement {
  const conflicts = Object.keys(jev.hypothesisProbabilities).filter(key => Math.abs(jev.hypothesisProbabilities[key as keyof typeof jev.hypothesisProbabilities] - laya.hypotheses[key as keyof typeof laya.hypotheses]) > .25);
  const magnitude = clamp(1 - laya.agreementWithJEV);
  const classification = laya.outOfDistribution ? 'OOD' : magnitude > .5 ? 'STRUCTURAL' : magnitude > .15 ? 'MEANINGFUL' : 'LOW';
  return Object.freeze({ magnitude, classification, hypothesisConflicts: Object.freeze(conflicts), likelyCause: classification === 'LOW' ? 'CONSISTENT_CERTIFIED_FEATURE_INTERPRETATION' : 'REQUIRES_ADVISORY_REVIEW' });
}

export function certificateFor(modelName: 'JEV' | 'LAYA', decisionId: string, context: AstraFeatureContext, output: unknown, startedAt: number, finishedAt: number): InferenceCertificate {
  if (finishedAt < startedAt) throw new Error('Inference time moved backwards');
  if (!decisionId || !output || typeof output !== 'object' || !('tokenId' in output) || (output as { tokenId?: unknown }).tokenId !== context.snapshot.mint) {
    throw new Error('Inference certificate requires an output bound to the exact feature snapshot subject');
  }
  const outputId = modelName === 'JEV' ? (output as { decisionId?: unknown }).decisionId : (output as { assessmentId?: unknown }).assessmentId;
  if (outputId !== decisionId) throw new Error('Inference certificate decision identity does not match its output');
  return Object.freeze({ decisionId, modelName, modelVersion: MODEL_VERSION[modelName], modelHash: modelHash(modelName), featureSchemaVersion: FEATURE_SCHEMA,
    featureSnapshotHash: context.snapshot.snapshotHash, marketStateHash: context.snapshot.snapshotHash, runtimeVersion: 'node-typescript', inferenceStartedAt: startedAt, inferenceFinishedAt: finishedAt, outputHash: digest(output) });
}
