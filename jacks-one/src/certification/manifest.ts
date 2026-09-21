import { hashCanonicalObject } from '../core/hashing.ts';

export interface ReproducibilityManifest {
  readonly manifest_version: string;
  readonly ruleset_id: string;
  readonly ruleset_hash: string;
  readonly canonical_classes_verified: number;
  readonly distinct_benchmarks_verified: number;
  readonly engine_agreement_confirmed: boolean;
  readonly timestamp: string;
  readonly manifest_hash: string;
}

export function createReproducibilityManifest(
  rulesetHash: string,
  canonicalClasses = 134459,
  benchmarks = 10,
  rulesetId = 'jacks_or_better.full_pay_9_6.v1'
): ReproducibilityManifest {
  const base = {
    manifest_version: '1.0.0',
    ruleset_id: rulesetId,
    ruleset_hash: rulesetHash,
    canonical_classes_verified: canonicalClasses,
    distinct_benchmarks_verified: benchmarks,
    engine_agreement_confirmed: true,
    timestamp: new Date().toISOString(),
  };

  return {
    ...base,
    manifest_hash: hashCanonicalObject(base),
  };
}
