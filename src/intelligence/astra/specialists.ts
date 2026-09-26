import type { AstraAgent, AstraAgentResult, AstraFeatureContext, AstraSignal, FeatureName, FeatureObservation } from './contracts.js';
import { FEATURE_SCHEMA, observationIssue } from './features.js';

const clamp = (value: number): number => Math.max(0, Math.min(1, value));
type Values = Readonly<Partial<Record<FeatureName, number>>>;
const unknown = (reasons: readonly string[]): AstraSignal => ({ opportunity: null, risk: null, regime: 'UNKNOWN', reasons });

/** A rule is a reproducible score, never a calibrated prediction or capital authorization. */
abstract class RuleAgent implements AstraAgent {
  abstract readonly id: string;
  readonly version = '1.0.0';
  readonly cost = 'CHEAP' as const;
  abstract readonly requiredFeatures: readonly FeatureName[];
  protected abstract readonly limitation: string;
  protected abstract score(values: Values): AstraSignal;

  async analyze(context: AstraFeatureContext, now: number, signal: AbortSignal): Promise<AstraAgentResult> {
    const evidence: FeatureObservation[] = [];
    const issues: string[] = [];
    const values: Partial<Record<FeatureName, number>> = {};
    let stale = false;
    let conflicted = false;
    if (signal.aborted) issues.push('ABORTED');
    if (!Number.isSafeInteger(now) || now <= 0) issues.push('INVALID_DECISION_TIME');
    if (context.snapshot.featureSchemaVersion !== FEATURE_SCHEMA) issues.push('FEATURE_SCHEMA_MISMATCH');
    if (!Number.isFinite(context.snapshot.timestampMs) || context.snapshot.timestampMs > now) issues.push('INVALID_SNAPSHOT_TIME');
    if (!/^[a-f0-9]{64}$/.test(context.snapshot.snapshotHash)) issues.push('INVALID_SNAPSHOT_HASH');

    for (const name of this.requiredFeatures) {
      const observation = context.observations[name];
      if (!observation) { issues.push(`${name}:MISSING`); continue; }
      evidence.push(Object.freeze({ ...observation }));
      const issue = observation.name === name ? observationIssue(observation, now) : 'FEATURE_NAME_MISMATCH';
      if (issue) issues.push(`${name}:${issue}`);
      stale ||= issue === 'STALE';
      conflicted ||= observation.conflict === true;
      if (observation.availableAt > context.snapshot.timestampMs) issues.push(`${name}:AFTER_SNAPSHOT`);
      // A fresh observation outside the captured snapshot cannot silently replace its inputs.
      if (!issue && context.snapshot.features[name] !== observation.value) issues.push(`${name}:SNAPSHOT_VALUE_MISMATCH`);
      if (!issue && observation.confidence === 0) issues.push(`${name}:ZERO_EVIDENCE_CONFIDENCE`);
      if (!issue) values[name] = observation.value!;
    }
    if (this.id === 'Liquidity' && values.market_cap === 0) issues.push('market_cap:UNDEFINED_LIQUIDITY_RATIO');
    const warnings = ['RULE_UNCALIBRATED: confidence is capped evidence quality, not predictive probability.', this.limitation];
    const ageValues = evidence.map(value => now - value.observedAt).filter(value => Number.isFinite(value) && value >= 0);
    return {
      agentId: this.id, agentVersion: this.version, timestamp: now,
      snapshotHash: context.snapshot.snapshotHash,
      status: issues.length ? stale || conflicted ? 'DEGRADED' : 'UNKNOWN' : 'VERIFIED',
      result: issues.length ? unknown(issues) : this.score(values),
      confidence: issues.length ? 0 : Math.min(0.5, ...evidence.map(value => value.confidence)),
      evidence: Object.freeze(evidence),
      provenance: { sources: Object.freeze([...new Set(evidence.map(value => value.source))].sort()), featureVersion: FEATURE_SCHEMA, modelVersion: this.version },
      diagnostics: { latencyMs: 0, oldestInputAgeMs: ageValues.length ? Math.max(...ageValues) : null, staleInput: stale, driftDetected: false },
      warnings,
    };
  }
}

export class Momentum extends RuleAgent {
  readonly id = 'Momentum';
  readonly requiredFeatures = Object.freeze(['price_velocity', 'price_acceleration', 'buy_sell_ratio'] as const);
  protected readonly limitation = 'Count imbalance is not volume OFI; momentum can be manipulated and does not establish expected return.';
  protected score(v: Values): AstraSignal {
    const velocity = v.price_velocity!, acceleration = v.price_acceleration!, ratio = v.buy_sell_ratio!;
    const opportunity = 0.5 * clamp(0.5 + velocity / 0.02) + 0.2 * clamp(0.5 + acceleration / 0.004) + 0.3 * ratio / (1 + ratio);
    return { opportunity, risk: clamp(-velocity / 0.01), regime: 'UNKNOWN', reasons: ['Rule: velocity neutral=0, saturates at ±0.01 fraction/second; acceleration at ±0.002 fraction/second²; count buy/sell ratio neutral=1.', 'Weights: velocity 0.5, acceleration 0.2, count imbalance 0.3; downside speed risk reaches 1 at -0.01/second.'] };
  }
}

export class Liquidity extends RuleAgent {
  readonly id = 'Liquidity';
  readonly requiredFeatures = Object.freeze(['liquidity', 'market_cap', 'liquidity_velocity'] as const);
  protected readonly limitation = 'Reported liquidity USD is not executable depth, LP-lock verification or guaranteed exit capacity.';
  protected score(v: Values): AstraSignal {
    const depth = v.liquidity!, cap = v.market_cap!, velocity = v.liquidity_velocity!;
    if (cap === 0) return unknown(['UNDEFINED_LIQUIDITY_RATIO: observed market capitalization is zero.']);
    const coverage = clamp(depth / cap / 0.1), adequacy = clamp(depth / 100_000);
    return { opportunity: null, risk: Math.max(1 - adequacy, 1 - coverage, clamp(-velocity / 0.01)), regime: depth < 20_000 ? 'LOW_LIQUIDITY' : 'UNKNOWN', reasons: ['Rule: depth risk decreases to 0 at USD 100,000; liquidity/market-cap coverage at 10%; liquidity loss risk reaches 1 at -0.01/second.', 'A score of zero means these three rule thresholds passed; sellability remains unverified.'] };
  }
}

export class Wallet extends RuleAgent {
  readonly id = 'Wallet';
  readonly requiredFeatures = Object.freeze(['wallet_concentration', 'unique_buyers', 'first_buyer_quality'] as const);
  protected readonly limitation = 'Distinct addresses are not independent economic owners; first-buyer quality requires a separate validated adapter.';
  protected score(v: Values): AstraSignal {
    const concentration = v.wallet_concentration!, buyers = v.unique_buyers!, quality = v.first_buyer_quality!;
    return { opportunity: null, risk: clamp(0.6 * concentration + 0.2 * (1 - clamp(buyers / 50)) + 0.2 * (1 - quality)), regime: 'UNKNOWN', reasons: ['Rule: concentration weight 0.6; buyer-count shortfall below 50 weight 0.2; first-buyer-quality shortfall weight 0.2.', 'This rule does not infer wallet conviction or historical profitability.'] };
  }
}

export class Bundler extends RuleAgent {
  readonly id = 'Bundler';
  readonly requiredFeatures = Object.freeze(['bundle_rate'] as const);
  protected readonly limitation = 'Bundling is not proof of collusion; low measured bundle rate does not establish independent buyers.';
  protected score(v: Values): AstraSignal {
    return { opportunity: null, risk: v.bundle_rate!, regime: 'UNKNOWN', reasons: ['Rule: risk equals verified bundled-transaction share in the covered 10-second window; no extrapolation beyond observed coverage.'] };
  }
}

export class Wash extends RuleAgent {
  readonly id = 'Wash';
  readonly requiredFeatures = Object.freeze(['wash_ratio'] as const);
  protected readonly limitation = 'Circular-volume share depends on coverage and attribution; low share does not prove organic volume.';
  protected score(v: Values): AstraSignal {
    return { opportunity: null, risk: v.wash_ratio!, regime: 'UNKNOWN', reasons: ['Rule: risk equals verified circular-volume share in the covered 10-second window.'] };
  }
}

export class RugRisk extends RuleAgent {
  readonly id = 'RugRisk';
  readonly requiredFeatures = Object.freeze(['rug_score', 'dev_concentration'] as const);
  protected readonly limitation = 'Risk score is an adapter-defined heuristic, not a rug probability; low scores do not verify token authorities or LP locks.';
  protected score(v: Values): AstraSignal {
    return { opportunity: null, risk: Math.max(v.rug_score!, v.dev_concentration!), regime: 'UNKNOWN', reasons: ['Rule: retain the larger of normalized adapter rug-risk score and verified developer supply concentration; neither can offset the other.'] };
  }
}

export class MarketRegime extends RuleAgent {
  readonly id = 'MarketRegime';
  readonly requiredFeatures = Object.freeze(['volatility', 'price_velocity', 'liquidity'] as const);
  protected readonly limitation = 'This is a local token regime; it does not establish the market-wide regime or forecast regime duration.';
  protected score(v: Values): AstraSignal {
    const volatility = v.volatility!, velocity = v.price_velocity!, depth = v.liquidity!;
    const regime = depth < 20_000 ? 'LOW_LIQUIDITY' : volatility >= 0.05 ? 'HIGH_VOLATILITY' : velocity <= -0.005 ? 'RISK_OFF' : velocity >= 0.005 ? 'TRENDING' : volatility >= 0.01 ? 'CHOPPY' : 'NORMAL';
    return { opportunity: null, risk: Math.max(clamp(volatility / 0.05), clamp(-velocity / 0.01), 1 - clamp(depth / 20_000)), regime, reasons: ['Rule priority: liquidity <USD 20,000; 30-second return volatility ≥5%; velocity ≤-0.005/second; velocity ≥0.005/second; volatility ≥1%; otherwise NORMAL.', 'Risk retains the maximum volatility, downside velocity or shallow-liquidity rule; NORMAL is not permission to trade.'] };
  }
}

export class ProviderQuality extends RuleAgent {
  readonly id = 'ProviderQuality';
  readonly requiredFeatures = Object.freeze(['provider_error_rate', 'provider_slot_lag'] as const);
  protected readonly limitation = 'Request reliability and finalized-slot lag do not establish market-data correctness, independent quorum, or signer availability.';
  protected score(v: Values): AstraSignal {
    return { opportunity: null, risk: Math.max(clamp(v.provider_error_rate! / 0.2), clamp(v.provider_slot_lag! / 20)), regime: 'UNKNOWN', reasons: ['Rule: provider risk reaches 1 at 20% measured request failures or 20 finalized slots behind an independent reference; retain the worse dimension.'] };
  }
}

export function createInitialAgents(): AstraAgent[] {
  return [new Momentum(), new Liquidity(), new Wallet(), new Bundler(), new Wash(), new RugRisk(), new MarketRegime(), new ProviderQuality()];
}
