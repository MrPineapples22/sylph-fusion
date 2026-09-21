/**
 * MENDELEEV: Universal Data Ontology & Semantic Contract Engine
 * Blueprint Engine #1
 * 
 * Defines canonical semantics, units, freshness, and evidence types for all market features.
 * Invariant: ZERO !== UNKNOWN !== MISSING.
 * Explicitly distinguishes OBSERVED, ESTIMATED, DERIVED, PREDICTED, SIMULATED, CONFIRMED.
 */

export type MendeleevEvidenceType = 
  | 'OBSERVED'    // Directly witnessed on-chain or raw WS feed
  | 'ESTIMATED'   // Statistically approximated from sample windows
  | 'DERIVED'     // Deterministically calculated from observed values
  | 'PREDICTED'   // Forward-looking projection from an inference model
  | 'SIMULATED'   // Output of digital twin / counterfactual simulation
  | 'CONFIRMED';  // Verified ex-post after settlement or confirmation

export type MendeleevUnit = 
  | 'USD'
  | 'SOL'
  | 'LAMPORTS'
  | 'RAW_TOKENS'
  | 'DECIMAL_TOKENS'
  | 'RATIO'
  | 'PERCENTAGE'
  | 'PROBABILITY'
  | 'BPS'
  | 'MILLISECONDS'
  | 'SLOT'
  | 'COUNT'
  | 'SCORE_0_100'
  | 'NORMALIZED_Z';

export type MendeleevNullBehavior = 
  | 'REJECT'            // Missing value causes feature validation failure
  | 'PRESERVE_UNKNOWN'  // Explicitly assign EpistemicUnknown (never coerce to 0)
  | 'FALLBACK_PRIOR'    // Fall back to historical prior with penalty
  | 'ZERO_IMPUTED';     // Allow zero only if mathematically identical to null (rare)

export interface FeatureSpecification<T = number | string | boolean> {
  readonly name: string;
  readonly definition: string;
  readonly unit: MendeleevUnit;
  readonly window_ms: number;
  readonly time_basis: 'WALL_CLOCK' | 'SLOT_INDEX' | 'BLOCK_TIME';
  readonly source: string;
  readonly version: string;
  readonly null_behavior: MendeleevNullBehavior;
  readonly freshness_max_ms: number;
  readonly evidence_type: MendeleevEvidenceType;
  readonly min_valid?: number;
  readonly max_valid?: number;
  readonly validate: (val: T) => boolean;
}

export interface MendeleevFeatureValue<T = number | string | boolean> {
  readonly spec: FeatureSpecification<T>;
  readonly raw_value: T | null;
  readonly is_null: boolean;
  readonly is_unknown: boolean;
  readonly evidence_type: MendeleevEvidenceType;
  readonly observed_at_ms: number;
  readonly evaluated_at_ms: number;
  readonly confidence: number; // 0.0 to 1.0
  readonly provenance_id: string;
}

export class MendeleevDataOntology {
  public static readonly VERSION = '1.0.0';
  private static readonly registry: Map<string, FeatureSpecification<any>> = new Map();

  static {
    // Register canonical core feature specifications
    MendeleevDataOntology.register<number>({
      name: 'price_usd',
      definition: 'Authoritative token exchange rate in USD',
      unit: 'USD',
      window_ms: 5000,
      time_basis: 'WALL_CLOCK',
      source: 'ON_CHAIN_DEX_RECONCILED',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 15000,
      evidence_type: 'DERIVED',
      min_valid: 0.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    });

    MendeleevDataOntology.register<number>({
      name: 'price_sol',
      definition: 'Token price denominated in Solana native currency',
      unit: 'SOL',
      window_ms: 5000,
      time_basis: 'WALL_CLOCK',
      source: 'AMM_POOL_RATIO',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 10000,
      evidence_type: 'DERIVED',
      min_valid: 0.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    });

    MendeleevDataOntology.register<number>({
      name: 'liquidity_usd',
      definition: 'Total active pool reserve depth converted to USD',
      unit: 'USD',
      window_ms: 15000,
      time_basis: 'WALL_CLOCK',
      source: 'POOL_VAULTS_RECONCILED',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 30000,
      evidence_type: 'DERIVED',
      min_valid: 0.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    });

    MendeleevDataOntology.register<number>({
      name: 'liquidity_sol',
      definition: 'Pooled SOL reserve depth in liquidity pool vaults',
      unit: 'SOL',
      window_ms: 15000,
      time_basis: 'WALL_CLOCK',
      source: 'POOL_VAULTS',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 30000,
      evidence_type: 'OBSERVED',
      min_valid: 0.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    });

    MendeleevDataOntology.register<number>({
      name: 'market_cap',
      definition: 'Fully diluted market capitalization in USD based on circulating supply',
      unit: 'USD',
      window_ms: 10000,
      time_basis: 'WALL_CLOCK',
      source: 'PRICE_SUPPLY_PRODUCT',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 30000,
      evidence_type: 'DERIVED',
      min_valid: 0.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0
    });

    MendeleevDataOntology.register<number>({
      name: 'lamports',
      definition: 'Integer balance of native Solana lamports (1 SOL = 1,000,000,000 lamports)',
      unit: 'LAMPORTS',
      window_ms: 0,
      time_basis: 'SLOT_INDEX',
      source: 'RPC_GET_BALANCE',
      version: '1.0.0',
      null_behavior: 'REJECT',
      freshness_max_ms: 10000,
      evidence_type: 'OBSERVED',
      min_valid: 0,
      validate: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0
    });

    MendeleevDataOntology.register<number>({
      name: 'hsi',
      definition: 'Holder Structure Integrity score measuring holder decentralization',
      unit: 'SCORE_0_100',
      window_ms: 30000,
      time_basis: 'WALL_CLOCK',
      source: 'HOLDER_DISTRIBUTION_ANALYSIS',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 60000,
      evidence_type: 'ESTIMATED',
      min_valid: 0.0,
      max_valid: 100.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
    });

    MendeleevDataOntology.register<number>({
      name: 'pumpscore',
      definition: 'Algorithmic momentum and velocity probability indicator',
      unit: 'SCORE_0_100',
      window_ms: 15000,
      time_basis: 'WALL_CLOCK',
      source: 'MOMENTUM_MODEL',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 30000,
      evidence_type: 'PREDICTED',
      min_valid: 0.0,
      max_valid: 100.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
    });

    MendeleevDataOntology.register<number>({
      name: 'pod',
      definition: 'Probability of Dump within a 5-minute horizon',
      unit: 'PROBABILITY',
      window_ms: 15000,
      time_basis: 'WALL_CLOCK',
      source: 'CHANDRASEKHAR_CRITICALITY',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 20000,
      evidence_type: 'PREDICTED',
      min_valid: 0.0,
      max_valid: 1.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0
    });

    MendeleevDataOntology.register<number>({
      name: 'exitability',
      definition: 'Simulation-tested percentage of position liquidatable within max slippage',
      unit: 'PROBABILITY',
      window_ms: 10000,
      time_basis: 'WALL_CLOCK',
      source: 'HAWKING_TWIN_SIMULATION',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 20000,
      evidence_type: 'SIMULATED',
      min_valid: 0.0,
      max_valid: 1.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0
    });

    MendeleevDataOntology.register<number>({
      name: 'structural_integrity',
      definition: 'Noether invariant conservation score across pool state and mint auth',
      unit: 'SCORE_0_100',
      window_ms: 30000,
      time_basis: 'WALL_CLOCK',
      source: 'NOETHER_INVARIANT_ENGINE',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 60000,
      evidence_type: 'DERIVED',
      min_valid: 0.0,
      max_valid: 100.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100
    });

    MendeleevDataOntology.register<number>({
      name: 'uncertainty',
      definition: 'Curie composite epistemic + aleatoric uncertainty mass',
      unit: 'PROBABILITY',
      window_ms: 10000,
      time_basis: 'WALL_CLOCK',
      source: 'CURIE_UNCERTAINTY_ENGINE',
      version: '1.0.0',
      null_behavior: 'PRESERVE_UNKNOWN',
      freshness_max_ms: 30000,
      evidence_type: 'DERIVED',
      min_valid: 0.0,
      max_valid: 1.0,
      validate: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1.0
    });
  }

  public static register<T>(spec: FeatureSpecification<T>): void {
    this.registry.set(spec.name, spec);
  }

  public static getSpec<T = number>(name: string): FeatureSpecification<T> | undefined {
    return this.registry.get(name) as FeatureSpecification<T> | undefined;
  }

  public static createValue<T>(
    featureName: string,
    value: T | null,
    observedAtMs: number,
    provenanceId: string,
    confidence: number = 1.0,
    evidenceTypeOverride?: MendeleevEvidenceType
  ): MendeleevFeatureValue<T> {
    const spec = this.getSpec<T>(featureName);
    if (!spec) {
      throw new Error(`[Mendeleev] Unregistered feature name: "${featureName}". Canonical ontology violation.`);
    }

    const now = Date.now();
    const isNull = value === null || value === undefined;
    const isUnknown = isNull && spec.null_behavior === 'PRESERVE_UNKNOWN';

    if (isNull && spec.null_behavior === 'REJECT') {
      throw new Error(`[Mendeleev] Feature "${featureName}" rejects null or missing values.`);
    }

    if (!isNull && !spec.validate(value as T)) {
      throw new Error(`[Mendeleev] Value "${value}" failed validation for feature "${featureName}" (${spec.unit}).`);
    }

    return {
      spec,
      raw_value: isNull ? null : value,
      is_null: isNull,
      is_unknown: isUnknown,
      evidence_type: evidenceTypeOverride ?? spec.evidence_type,
      observed_at_ms: observedAtMs,
      evaluated_at_ms: now,
      confidence: isNull ? 0.0 : Math.max(0.0, Math.min(1.0, confidence)),
      provenance_id: provenanceId
    };
  }

  public static isFresh(val: MendeleevFeatureValue<any>, nowMs: number = Date.now()): boolean {
    return (nowMs - val.observed_at_ms) <= val.spec.freshness_max_ms;
  }
}
