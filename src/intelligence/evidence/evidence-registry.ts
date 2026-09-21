/**
 * SOL-SYLPH Evidence Registry & Evidence Fusion Engine
 * Specifications: Parts VII, VIII, IX, X, LXXIII
 *
 * Enforces:
 * 1. Explicit ObservedFact representation preserving provenance and epistemic type.
 * 2. Strict global axioms: ZERO != UNKNOWN, UNKNOWN != MISSING, MISSING != STALE, STALE != INVALID.
 * 3. Source Reliability tracking (availability, latency, 429s, schema errors, reconnects).
 * 4. Field-level freshness policies.
 * 5. Evidence Fusion with 7 explicit conflict categories.
 */

import type { TokenId, EventId, EvidenceId, ObservationId } from '../events/canonical-event.js';

// --- Part LXXIII: Knowledge / Epistemic Types ---
export type EpistemicType =
  | 'OBSERVED'
  | 'DERIVED'
  | 'INFERRED'
  | 'MODEL_ESTIMATE'
  | 'HYPOTHESIS'
  | 'SIMULATED'
  | 'HISTORICAL'
  | 'OPERATOR_ANNOTATION';

// --- Part VII: Evidence Status ---
export type FactStatus = 'FRESH' | 'AGING' | 'STALE' | 'MISSING' | 'CONFLICTED' | 'INVALID';

export type ConfidenceTier = 'VERIFIED' | 'STRONG' | 'MODERATE' | 'WEAK' | 'SPECULATIVE';

// Explicit sentinel symbols guaranteeing ZERO != UNKNOWN, UNKNOWN != MISSING
export const VALUE_UNKNOWN = Symbol.for('SYLPH_VALUE_UNKNOWN');
export const VALUE_MISSING = Symbol.for('SYLPH_VALUE_MISSING');

export type FactValue = number | string | boolean | bigint | typeof VALUE_UNKNOWN | typeof VALUE_MISSING;

export interface Provenance {
  readonly source: string;
  readonly endpoint?: string;
  readonly sourceEventId?: EventId;
  readonly slot?: number;
  readonly signature?: string;
  readonly responseLatencyMs?: number;
}

export interface ObservedFact {
  readonly factId: ObservationId;
  readonly mint: TokenId;
  readonly field: string;
  readonly value: FactValue;
  readonly unit: string;
  readonly source: string;
  readonly sourceEventId?: EventId;
  readonly eventTime: number; // When fact occurred in the real world
  readonly receivedTime: number; // When fact arrived at boundary
  readonly ageMs: number;
  readonly reliability: number; // 0.0 to 1.0 (source score)
  readonly quality: number; // 0.0 to 1.0 (data completeness/precision)
  readonly confidence: number; // 0.0 to 1.0
  readonly completeness: boolean;
  readonly status: FactStatus;
  readonly epistemicType: EpistemicType;
  readonly provenance: Provenance;
}

// --- Part IX: Field-Level Freshness Policy ---
export interface FreshnessPolicy {
  readonly freshUntilMs: number;
  readonly agingUntilMs: number;
  readonly staleAfterMs: number;
  readonly hardExpiryMs: number;
}

export const DEFAULT_FRESHNESS_POLICIES: Record<string, FreshnessPolicy> = {
  price: { freshUntilMs: 1500, agingUntilMs: 3500, staleAfterMs: 7000, hardExpiryMs: 15000 },
  liquidity: { freshUntilMs: 3000, agingUntilMs: 8000, staleAfterMs: 15000, hardExpiryMs: 30000 },
  trade: { freshUntilMs: 1000, agingUntilMs: 3000, staleAfterMs: 6000, hardExpiryMs: 12000 },
  rug: { freshUntilMs: 30000, agingUntilMs: 120000, staleAfterMs: 300000, hardExpiryMs: 600000 },
  holders: { freshUntilMs: 15000, agingUntilMs: 60000, staleAfterMs: 120000, hardExpiryMs: 300000 },
  default: { freshUntilMs: 5000, agingUntilMs: 15000, staleAfterMs: 30000, hardExpiryMs: 60000 },
};

// --- Part VIII: Source Reliability Tracking ---
export interface SourceMetrics {
  readonly sourceName: string;
  availability: number; // 0.0 to 1.0
  averageLatencyMs: number;
  timeoutsCount: number;
  http429Count: number;
  schemaErrorsCount: number;
  reconnectsCount: number;
  missingnessRate: number;
  sequenceGapsCount: number;
  disagreementsCount: number;
  totalRequests: number;
  lastActiveMs: number;
  historicalReliability: number; // 0.0 to 1.0 EWMA
}

export class SourceReliabilityTracker {
  private readonly sources = new Map<string, SourceMetrics>();

  public registerSource(sourceName: string): void {
    if (this.sources.has(sourceName)) return;
    this.sources.set(sourceName, {
      sourceName,
      availability: 1.0,
      averageLatencyMs: 50,
      timeoutsCount: 0,
      http429Count: 0,
      schemaErrorsCount: 0,
      reconnectsCount: 0,
      missingnessRate: 0.0,
      sequenceGapsCount: 0,
      disagreementsCount: 0,
      totalRequests: 0,
      lastActiveMs: Date.now(),
      historicalReliability: 1.0,
    });
  }

  public recordSuccess(sourceName: string, latencyMs: number): void {
    const s = this.getOrCreate(sourceName);
    s.totalRequests += 1;
    s.lastActiveMs = Date.now();
    s.averageLatencyMs = s.averageLatencyMs * 0.9 + latencyMs * 0.1;
    s.historicalReliability = Math.min(1.0, s.historicalReliability * 0.99 + 0.01);
  }

  public recordFailure(sourceName: string, type: 'TIMEOUT' | '429' | 'SCHEMA_ERROR' | 'RECONNECT'): void {
    const s = this.getOrCreate(sourceName);
    s.totalRequests += 1;
    s.lastActiveMs = Date.now();
    if (type === 'TIMEOUT') s.timeoutsCount += 1;
    if (type === '429') s.http429Count += 1;
    if (type === 'SCHEMA_ERROR') s.schemaErrorsCount += 1;
    if (type === 'RECONNECT') s.reconnectsCount += 1;

    s.historicalReliability = Math.max(0.0, s.historicalReliability * 0.95 - 0.05);
  }

  public recordDisagreement(sourceName: string): void {
    const s = this.getOrCreate(sourceName);
    s.disagreementsCount += 1;
    s.historicalReliability = Math.max(0.1, s.historicalReliability - 0.02);
  }

  public getReliability(sourceName: string): number {
    return this.sources.get(sourceName)?.historicalReliability ?? 0.5;
  }

  public getSourceMetrics(sourceName: string): SourceMetrics | undefined {
    return this.sources.get(sourceName);
  }

  private getOrCreate(sourceName: string): SourceMetrics {
    let s = this.sources.get(sourceName);
    if (!s) {
      this.registerSource(sourceName);
      s = this.sources.get(sourceName)!;
    }
    return s;
  }
}

// --- Part X: Evidence Fusion & 7 Conflict Categories ---
export type ConflictCategory =
  | 'SOURCE_DISAGREEMENT'
  | 'SEVERE_SOURCE_DISAGREEMENT'
  | 'BEHAVIORAL_CONFLICT'
  | 'STRUCTURAL_CONFLICT'
  | 'TEMPORAL_CONFLICT'
  | 'RULE_CONFLICT'
  | 'MODEL_RULE_CONFLICT';

export interface EvidenceConflict {
  readonly conflictId: string;
  readonly category: ConflictCategory;
  readonly mint: TokenId;
  readonly field: string;
  readonly primaryObservation: ObservedFact;
  readonly alternativeObservation?: ObservedFact;
  readonly severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly description: string;
  readonly detectedAt: number;
}

export interface FusedEvidence {
  readonly evidenceId: EvidenceId;
  readonly mint: TokenId;
  readonly field: string;
  readonly fusedValue: FactValue;
  readonly unit: string;
  readonly primarySource: string;
  readonly corroboratingSources: readonly string[];
  readonly agreementScore: number; // 0.0 (total conflict) to 1.0 (unanimous)
  readonly conflicts: readonly EvidenceConflict[];
  readonly quality: number;
  readonly confidence: number;
  readonly uncertainty: number;
  readonly status: FactStatus;
  readonly lastUpdatedAt: number;
}

export class EvidenceRegistry {
  private readonly factsByToken = new Map<TokenId, Map<string, ObservedFact[]>>();
  private readonly fusedEvidenceByToken = new Map<TokenId, Map<string, FusedEvidence>>();
  private readonly conflicts: EvidenceConflict[] = [];
  public readonly sourceTracker: SourceReliabilityTracker;

  constructor(sourceTracker?: SourceReliabilityTracker) {
    this.sourceTracker = sourceTracker ?? new SourceReliabilityTracker();
  }

  public ingestFact(fact: ObservedFact, now: number = Date.now()): { fact: ObservedFact; fused: FusedEvidence } {
    // 1. Evaluate Freshness
    const policy = DEFAULT_FRESHNESS_POLICIES[fact.field] ?? DEFAULT_FRESHNESS_POLICIES.default;
    const ageMs = now - fact.receivedTime;

    let computedStatus: FactStatus = fact.status;
    if (fact.value === VALUE_MISSING) {
      computedStatus = 'MISSING';
    } else if (fact.value === VALUE_UNKNOWN) {
      computedStatus = 'AGING';
    } else if (ageMs > policy.hardExpiryMs) {
      computedStatus = 'INVALID';
    } else if (ageMs > policy.staleAfterMs) {
      computedStatus = 'STALE';
    } else if (ageMs > policy.freshUntilMs) {
      computedStatus = 'AGING';
    } else {
      computedStatus = 'FRESH';
    }

    const evaluatedFact: ObservedFact = {
      ...fact,
      ageMs,
      status: computedStatus,
    };

    // 2. Store in Raw Registry
    let tokenMap = this.factsByToken.get(fact.mint);
    if (!tokenMap) {
      tokenMap = new Map();
      this.factsByToken.set(fact.mint, tokenMap);
    }
    let fieldHistory = tokenMap.get(fact.field);
    if (!fieldHistory) {
      fieldHistory = [];
      tokenMap.set(fact.field, fieldHistory);
    }
    fieldHistory.unshift(evaluatedFact);
    if (fieldHistory.length > 20) {
      fieldHistory.pop();
    }

    // 3. Perform Evidence Fusion
    const fused = this.fuseField(fact.mint, fact.field, evaluatedFact, now);
    let fusedTokenMap = this.fusedEvidenceByToken.get(fact.mint);
    if (!fusedTokenMap) {
      fusedTokenMap = new Map();
      this.fusedEvidenceByToken.set(fact.mint, fusedTokenMap);
    }
    fusedTokenMap.set(fact.field, fused);

    return { fact: evaluatedFact, fused };
  }

  public getFusedEvidence(mint: TokenId, field: string): FusedEvidence | undefined {
    return this.fusedEvidenceByToken.get(mint)?.get(field);
  }

  public getAllFusedEvidenceForToken(mint: TokenId): readonly FusedEvidence[] {
    const map = this.fusedEvidenceByToken.get(mint);
    return map ? Array.from(map.values()) : [];
  }

  public getActiveConflicts(): readonly EvidenceConflict[] {
    return this.conflicts;
  }

  private fuseField(mint: TokenId, field: string, latestFact: ObservedFact, now: number): FusedEvidence {
    const history = this.factsByToken.get(mint)?.get(field) ?? [latestFact];
    const recentFacts = history.filter(f => now - f.receivedTime <= 30000 && f.status !== 'INVALID');

    const conflicts: EvidenceConflict[] = [];
    const sourcesSeen = new Set<string>();
    let agreementScore = 1.0;

    // Check for numerical source disagreement
    if (typeof latestFact.value === 'number') {
      for (const alt of recentFacts) {
        if (alt.source !== latestFact.source && typeof alt.value === 'number') {
          sourcesSeen.add(alt.source);
          const diffPct = Math.abs(latestFact.value - alt.value) / Math.max(1e-6, Math.abs(latestFact.value));
          if (diffPct > 0.35) {
            const conflict: EvidenceConflict = {
              conflictId: `conf_${mint.slice(0, 6)}_${field}_${now}`,
              category: diffPct > 0.70 ? 'SEVERE_SOURCE_DISAGREEMENT' : 'SOURCE_DISAGREEMENT',
              mint,
              field,
              primaryObservation: latestFact,
              alternativeObservation: alt,
              severity: diffPct > 0.70 ? 'CRITICAL' : 'HIGH',
              description: `Disagreement between ${latestFact.source} (${latestFact.value}) and ${alt.source} (${alt.value}) on ${field}: ${(diffPct * 100).toFixed(1)}%`,
              detectedAt: now,
            };
            conflicts.push(conflict);
            this.conflicts.push(conflict);
            this.sourceTracker.recordDisagreement(alt.source);
            agreementScore = Math.min(agreementScore, 1.0 - diffPct);
          }
        }
      }
    }

    const sourceReliability = this.sourceTracker.getReliability(latestFact.source);
    const quality = latestFact.quality * sourceReliability;
    const confidence = Math.max(0.0, latestFact.confidence * agreementScore * (latestFact.status === 'FRESH' ? 1.0 : 0.7));
    const uncertainty = 1.0 - confidence;

    return {
      evidenceId: `evi_${mint.slice(0, 8)}_${field}`,
      mint,
      field,
      fusedValue: latestFact.value,
      unit: latestFact.unit,
      primarySource: latestFact.source,
      corroboratingSources: Array.from(sourcesSeen),
      agreementScore: Math.max(0.0, agreementScore),
      conflicts,
      quality,
      confidence,
      uncertainty,
      status: conflicts.length > 0 ? 'CONFLICTED' : latestFact.status,
      lastUpdatedAt: now,
    };
  }
}

// --- Blueprint Part IV: Truth Plane Evidence Envelope ---
export type VerificationStatus =
  | 'KNOWN'
  | 'UNKNOWN'
  | 'STALE'
  | 'CONFLICTED'
  | 'UNSUPPORTED'
  | 'NOT_APPLICABLE';

export interface EvidenceEnvelope<T = unknown> {
  readonly value: T | typeof VALUE_UNKNOWN;
  readonly source: string;
  readonly upstreamSource?: string;
  readonly slot?: number;
  readonly blockTime?: number;
  readonly observedAt: number;
  readonly availableAt: number;
  readonly computedAt: number;
  readonly commitment: 'processed' | 'confirmed' | 'finalized';
  readonly ageMs: number;
  readonly verificationStatus: VerificationStatus;
  readonly confidence: number; // 0.0 - 1.0
  readonly parserVersion: string;
  readonly rawHash: string;
}

// --- Blueprint Part V: 9-Category Evidence Coverage ---
export type EvidenceCategory =
  | 'STRUCTURAL'
  | 'MARKET'
  | 'ACTOR'
  | 'CAPITAL'
  | 'LIQUIDITY'
  | 'EXECUTION'
  | 'PROGRAM'
  | 'HISTORICAL'
  | 'SIMULATION';

export interface CategoryCoverage {
  readonly category: EvidenceCategory;
  readonly status: VerificationStatus;
  readonly coverageRatio: number; // 0.0 - 1.0
  readonly freshnessMs: number;
  readonly confidence: number;
  readonly criticalUnknowns: string[];
}

export interface EvidenceCoverageReport {
  readonly mint: string;
  readonly categories: Record<EvidenceCategory, CategoryCoverage>;
  readonly overallCoverage: number; // 0.0 - 1.0
  readonly averageFreshnessMs: number;
  readonly contradictionCount: number;
  readonly sourceDiversityScore: number; // 0.0 - 1.0
  readonly uncertaintyScore: number; // 0.0 - 1.0
  readonly confidenceCeiling: 'HIGH' | 'MED' | 'LOW';
}

export class EvidenceCoverageTracker {
  private readonly envelopes = new Map<string, Map<string, EvidenceEnvelope>>();

  public recordEnvelope(mint: string, field: string, envelope: EvidenceEnvelope): void {
    if (!this.envelopes.has(mint)) {
      this.envelopes.set(mint, new Map());
    }
    this.envelopes.get(mint)!.set(field, envelope);
  }

  public getEnvelope(mint: string, field: string): EvidenceEnvelope | undefined {
    return this.envelopes.get(mint)?.get(field);
  }

  public evaluateCoverage(mint: string, categoryRequirements?: Partial<Record<EvidenceCategory, string[]>>): EvidenceCoverageReport {
    const defaultReqs: Record<EvidenceCategory, string[]> = {
      STRUCTURAL: ['mintAuthority', 'freezeAuthority', 'supply', 'decimals'],
      MARKET: ['price', 'mcap', 'volume24h', 'txCount'],
      ACTOR: ['rawWallets', 'effectiveWallets', 'creatorFunding'],
      CAPITAL: ['freshCapitalRatio', 'netIndependentFlow', 'sourceConcentration'],
      LIQUIDITY: ['executableLiquidity', 'reserves', 'poolType'],
      EXECUTION: ['buyPathValid', 'sellPathValid', 'priceImpact1Sol'],
      PROGRAM: ['programOwner', 'token2022Extensions'],
      HISTORICAL: ['tokenAgeSec', 'historicalAnalogueCount'],
      SIMULATION: ['stressExitCapacity', 'distanceToFailure'],
      ...categoryRequirements,
    };

    const tokenEnvelopes = this.envelopes.get(mint) ?? new Map<string, EvidenceEnvelope>();
    const categories: Record<string, CategoryCoverage> = {};
    let totalFields = 0;
    let knownFields = 0;
    let totalFreshness = 0;
    let freshnessCount = 0;
    let totalConfidence = 0;
    const allSources = new Set<string>();
    let contradictionCount = 0;
    const criticalUnknownsFound: string[] = [];

    const categoryList: EvidenceCategory[] = [
      'STRUCTURAL', 'MARKET', 'ACTOR', 'CAPITAL', 'LIQUIDITY',
      'EXECUTION', 'PROGRAM', 'HISTORICAL', 'SIMULATION'
    ];

    for (const cat of categoryList) {
      const reqFields = defaultReqs[cat];
      let catKnown = 0;
      let catFreshnessSum = 0;
      let catConfSum = 0;
      const catCriticals: string[] = [];

      for (const field of reqFields) {
        totalFields++;
        const env = tokenEnvelopes.get(field);
        if (env) {
          allSources.add(env.source);
          if (env.verificationStatus === 'CONFLICTED') contradictionCount++;
          if (env.verificationStatus === 'KNOWN' && env.value !== VALUE_UNKNOWN) {
            catKnown++;
            knownFields++;
            catFreshnessSum += env.ageMs;
            catConfSum += env.confidence;
            totalFreshness += env.ageMs;
            freshnessCount++;
            totalConfidence += env.confidence;
          } else {
            catCriticals.push(field);
            if (cat === 'STRUCTURAL' || cat === 'EXECUTION' || cat === 'LIQUIDITY') {
              criticalUnknownsFound.push(field);
            }
          }
        } else {
          catCriticals.push(field);
          if (cat === 'STRUCTURAL' || cat === 'EXECUTION' || cat === 'LIQUIDITY') {
            criticalUnknownsFound.push(field);
          }
        }
      }

      const coverageRatio = reqFields.length > 0 ? catKnown / reqFields.length : 1.0;
      const status: VerificationStatus = coverageRatio === 1.0 ? 'KNOWN' : coverageRatio === 0 ? 'UNKNOWN' : 'STALE';

      categories[cat] = {
        category: cat,
        status,
        coverageRatio,
        freshnessMs: catKnown > 0 ? Math.round(catFreshnessSum / catKnown) : 999999,
        confidence: catKnown > 0 ? catConfSum / catKnown : 0.0,
        criticalUnknowns: catCriticals,
      };
    }

    const overallCoverage = totalFields > 0 ? knownFields / totalFields : 0.0;
    const averageFreshnessMs = freshnessCount > 0 ? Math.round(totalFreshness / freshnessCount) : 999999;
    const sourceDiversityScore = Math.min(1.0, allSources.size / 4.0);
    const uncertaintyScore = 1.0 - (overallCoverage * (1.0 - Math.min(1.0, contradictionCount * 0.2)));

    // Part V Confidence Ceiling:
    // Critical UNKNOWN values MUST impose confidence ceilings. A model must NEVER become HIGH confidence when critical evidence is unavailable.
    let confidenceCeiling: 'HIGH' | 'MED' | 'LOW' = 'HIGH';
    if (criticalUnknownsFound.length > 0 || overallCoverage < 0.65) {
      confidenceCeiling = criticalUnknownsFound.length > 2 || overallCoverage < 0.4 ? 'LOW' : 'MED';
    }

    return {
      mint,
      categories: categories as Record<EvidenceCategory, CategoryCoverage>,
      overallCoverage,
      averageFreshnessMs,
      contradictionCount,
      sourceDiversityScore,
      uncertaintyScore,
      confidenceCeiling,
    };
  }
}

