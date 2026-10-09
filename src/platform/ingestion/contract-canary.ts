/**
 * SYLPH FUSION — CONTRACTCANARY: External API Semantics & Runtime Validation
 * Specifications: Section 18 (ContractCanary), Section 96 (Market Data Truth)
 *
 * Implements:
 * 1. Five-dimensional health tracking:
 *    TransportHealth, SchemaHealth, SemanticHealth, FreshnessHealth, QuotaHealth.
 * 2. Strict runtime schema validation (replacing `response.json() as T`).
 * 3. Capability-level quarantine: Isolates drifting providers without crashing the engine.
 * 4. Epistemic state preservation: Absence of evidence is never evidence of safety.
 * 5. Payload digest tracking with explicitly declared representation.
 * 6. Durable SQLite WAL persistence & cold-boot rehydration.
 */

import { createHash } from 'node:crypto';

export type HealthDimensionStatus = 'HEALTHY' | 'DEGRADED' | 'QUARANTINED' | 'UNKNOWN';

export type EpistemicState = 'PRESENT' | 'NULL' | 'ABSENT' | 'INVALID' | 'UNKNOWN' | 'STALE';

export interface EpistemicField<T> {
  readonly state: EpistemicState;
  readonly value?: T;
  readonly observedAtMs: number;
  readonly rawField?: string;
}

/** Representation declared by the caller; neither capture nor authenticity is verified. */
export type WirePayloadEncoding =
  | 'UNSPECIFIED'
  | 'JSON_FRAME_BYTES'
  | 'JSON_SERIALIZED_BYTES'
  | 'JSON_CANONICAL'
  | 'DECODED_PROTOBUF_JSON_SERIALIZED_BYTES'
  | 'DECODED_PROTOBUF_JSON_CANONICAL'
  | 'PROTOBUF_WIRE_BYTES';

export interface RawWireWitness {
  readonly witnessId: string;
  readonly providerId: string;
  readonly capabilityId: string;
  readonly transport: 'HTTP_REST' | 'WSS' | 'GRPC' | 'WEBSOCKET' | string;
  readonly receivedAtMs: number;
  readonly payloadHash: string;
  readonly byteLength: number;
  readonly httpStatus?: number;
  readonly contractStatus: 'VALID' | 'MALFORMED' | 'QUARANTINED' | 'UNKNOWN';
  readonly wireEncoding?: WirePayloadEncoding;
}

/**
 * Digests the supplied payload, which may already be decoded or locally serialized.
 * The hash establishes byte equality only, not transport capture, source authenticity,
 * chain inclusion, or a binding between separately supplied bytes and decoded events.
 */
export function createWireWitness(
  providerId: string,
  capabilityId: string,
  transport: 'HTTP_REST' | 'WSS' | 'GRPC' | 'WEBSOCKET' | string,
  payload: string | Buffer | Uint8Array,
  httpStatus?: number,
  contractStatus: 'VALID' | 'MALFORMED' | 'QUARANTINED' | 'UNKNOWN' = 'VALID',
  wireEncoding: WirePayloadEncoding = 'UNSPECIFIED'
): RawWireWitness {
  const buf = typeof payload === 'string'
    ? Buffer.from(payload, 'utf8')
    : Buffer.isBuffer(payload)
    ? payload
    : Buffer.from(payload);
  const hash = createHash('sha256').update(buf).digest('hex');
  const now = Date.now();
  const witnessId = `wit_${providerId}_${now}_${hash.slice(0, 8)}`;

  return {
    witnessId,
    providerId,
    capabilityId,
    transport,
    receivedAtMs: now,
    payloadHash: hash,
    byteLength: buf.length,
    httpStatus,
    contractStatus,
    wireEncoding,
  };
}

export interface ProviderContractHealth {
  readonly providerId: string;
  readonly transportHealth: HealthDimensionStatus;
  readonly schemaHealth: HealthDimensionStatus;
  readonly semanticHealth: HealthDimensionStatus;
  readonly freshnessHealth: HealthDimensionStatus;
  readonly quotaHealth: HealthDimensionStatus;
  readonly isQuarantined: boolean;
  readonly lastValidatedSlot: number;
  readonly lastValidatedAtMs: number;
  readonly failureReason?: string;
  readonly contractEpochId?: string;
  readonly contractFingerprint?: string;
}

export interface ValidatedRugCheckReport {
  readonly score: number;
  readonly rugged: boolean;
  readonly epistemicRugged: EpistemicField<boolean>;
  readonly epistemicMintAuthority: EpistemicField<string | null>;
  readonly epistemicFreezeAuthority: EpistemicField<string | null>;
  readonly risks: readonly { readonly name: string; readonly level: string; readonly score: number }[];
  readonly mintAuthority: string | null;
  readonly freezeAuthority: string | null;
  readonly rawWitness?: RawWireWitness;
}

export interface ValidatedDexScreenerPair {
  readonly pairAddress: string;
  readonly priceUsd: number;
  readonly liquidityUsd: number;
  readonly baseToken: string;
  readonly quoteToken: string;
  readonly epistemicLiquidity: EpistemicField<number>;
  readonly epistemicPrice: EpistemicField<number>;
}

export class ContractCanaryAuthority {
  private healthByProvider = new Map<string, ProviderContractHealth>();

  public getHealth(providerId: string): ProviderContractHealth | undefined {
    return this.healthByProvider.get(providerId);
  }

  public isProviderHealthy(providerId: string): boolean {
    const h = this.healthByProvider.get(providerId);
    if (!h) return false;
    return !h.isQuarantined && h.transportHealth === 'HEALTHY' && h.schemaHealth === 'HEALTHY' && h.semanticHealth === 'HEALTHY';
  }

  public isProviderEligible(providerId: string): boolean {
    const h = this.healthByProvider.get(providerId);
    if (!h) return true;
    return !h.isQuarantined;
  }

  /**
   * Digests caller-supplied data without inferring its representation or authenticity.
   */
  public createWireWitness(
    providerId: string,
    capabilityId: string,
    transport: 'HTTP_REST' | 'WSS' | 'GRPC' | 'WEBSOCKET' | string,
    payload: string | Buffer | Uint8Array | object,
    httpStatus = 200,
    contractStatus?: 'VALID' | 'MALFORMED' | 'QUARANTINED' | 'UNKNOWN',
    wireEncoding: WirePayloadEncoding = 'UNSPECIFIED'
  ): RawWireWitness {
    const isWireBytes = Buffer.isBuffer(payload) || payload instanceof Uint8Array;
    const rawPayload = isWireBytes || typeof payload === 'string'
      ? payload
      : JSON.stringify(payload);
    return createWireWitness(
      providerId,
      capabilityId,
      transport,
      rawPayload,
      httpStatus,
      contractStatus ?? (httpStatus >= 400 ? 'MALFORMED' : 'VALID'),
      wireEncoding
    );
  }

  /**
   * Runtime validator for RugCheck reports enforcing explicit epistemic completeness.
   */
  public validateRugCheckResponse(data: unknown, rawWitness?: RawWireWitness): {
    readonly isValid: boolean;
    readonly report?: ValidatedRugCheckReport;
    readonly error?: string;
  } {
    if (!data || typeof data !== 'object') {
      return { isValid: false, error: 'RugCheck response must be a non-null object' };
    }

    const d = data as Record<string, unknown>;
    if (typeof d.score !== 'number' || !Number.isFinite(d.score) || d.score < 0) {
      return { isValid: false, error: 'RugCheck report missing finite non-negative score' };
    }
    if (!Array.isArray(d.risks)) {
      return { isValid: false, error: 'RugCheck report missing risks array' };
    }

    const now = Date.now();
    const risks = d.risks.map((r: unknown) => {
      const rec = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return {
        name: String(rec.name ?? 'unknown'),
        level: String(rec.level ?? 'unknown'),
        score: typeof rec.score === 'number' ? rec.score : 0,
      };
    });

    // 1. Epistemic extraction of 'rugged' flag: Never convert missing into false
    const hasRuggedProp = 'rugged' in d;
    const isRuggedBoolean = typeof d.rugged === 'boolean';
    const epistemicRugged: EpistemicField<boolean> = isRuggedBoolean
      ? { state: 'PRESENT', value: d.rugged as boolean, observedAtMs: now, rawField: 'rugged' }
      : hasRuggedProp && d.rugged === null
      ? { state: 'NULL', observedAtMs: now, rawField: 'rugged' }
      : hasRuggedProp
      ? { state: 'INVALID', observedAtMs: now, rawField: 'rugged' }
      : { state: 'ABSENT', observedAtMs: now, rawField: 'rugged' };

    // 2. Epistemic extraction of authorities
    const token = (d.token && typeof d.token === 'object' ? d.token : {}) as Record<string, unknown>;
    const hasMintProp = 'mintAuthority' in token || 'mintAuthority' in d;
    const mintVal = token.mintAuthority !== undefined ? token.mintAuthority : d.mintAuthority;
    const epistemicMintAuthority: EpistemicField<string | null> = typeof mintVal === 'string'
      ? { state: 'PRESENT', value: mintVal, observedAtMs: now, rawField: 'mintAuthority' }
      : mintVal === null
      ? { state: 'NULL', value: null, observedAtMs: now, rawField: 'mintAuthority' }
      : hasMintProp
      ? { state: 'INVALID', observedAtMs: now, rawField: 'mintAuthority' }
      : { state: 'ABSENT', observedAtMs: now, rawField: 'mintAuthority' };

    const hasFreezeProp = 'freezeAuthority' in token || 'freezeAuthority' in d;
    const freezeVal = token.freezeAuthority !== undefined ? token.freezeAuthority : d.freezeAuthority;
    const epistemicFreezeAuthority: EpistemicField<string | null> = typeof freezeVal === 'string'
      ? { state: 'PRESENT', value: freezeVal, observedAtMs: now, rawField: 'freezeAuthority' }
      : freezeVal === null
      ? { state: 'NULL', value: null, observedAtMs: now, rawField: 'freezeAuthority' }
      : hasFreezeProp
      ? { state: 'INVALID', observedAtMs: now, rawField: 'freezeAuthority' }
      : { state: 'ABSENT', observedAtMs: now, rawField: 'freezeAuthority' };

    const mintAuthority = typeof mintVal === 'string' ? mintVal : null;
    const freezeAuthority = typeof freezeVal === 'string' ? freezeVal : null;

    return {
      isValid: true,
      report: {
        score: d.score,
        rugged: d.rugged === true,
        epistemicRugged,
        epistemicMintAuthority,
        epistemicFreezeAuthority,
        risks,
        mintAuthority,
        freezeAuthority,
        rawWitness,
      },
    };
  }

  /**
   * Runtime validator for DexScreener pair responses with explicit empty-set tracking.
   */
  public validateDexScreenerPairs(data: unknown, rawWitness?: RawWireWitness): {
    readonly isValid: boolean;
    readonly pairs?: readonly ValidatedDexScreenerPair[];
    readonly hasPairs: boolean;
    readonly epistemicState: EpistemicState;
    readonly error?: string;
  } {
    if (!data || typeof data !== 'object') {
      return { isValid: false, hasPairs: false, epistemicState: 'INVALID', error: 'DexScreener response must be an object' };
    }

    const d = data as Record<string, unknown>;
    if (!Array.isArray(d.pairs)) {
      return { isValid: false, hasPairs: false, epistemicState: 'ABSENT', error: 'DexScreener response missing pairs array' };
    }

    const now = Date.now();
    const validatedPairs: ValidatedDexScreenerPair[] = [];

    for (const p of d.pairs) {
      if (!p || typeof p !== 'object') continue;
      const pair = p as Record<string, unknown>;
      if (typeof pair.pairAddress !== 'string' || pair.pairAddress.length < 32) continue;

      const hasPrice = 'priceUsd' in pair && pair.priceUsd !== null && pair.priceUsd !== undefined;
      const parsedPrice = Number(pair.priceUsd ?? 0);
      const isPriceValid = hasPrice && Number.isFinite(parsedPrice) && parsedPrice >= 0;

      const liqObj = (pair.liquidity && typeof pair.liquidity === 'object' ? pair.liquidity : {}) as Record<string, unknown>;
      const hasLiq = 'usd' in liqObj && liqObj.usd !== null && liqObj.usd !== undefined;
      const parsedLiq = Number(liqObj.usd ?? 0);
      const isLiqValid = hasLiq && Number.isFinite(parsedLiq) && parsedLiq >= 0;

      const baseObj = (pair.baseToken && typeof pair.baseToken === 'object' ? pair.baseToken : {}) as Record<string, unknown>;
      const quoteObj = (pair.quoteToken && typeof pair.quoteToken === 'object' ? pair.quoteToken : {}) as Record<string, unknown>;

      if (Number.isFinite(parsedPrice) && Number.isFinite(parsedLiq)) {
        validatedPairs.push({
          pairAddress: pair.pairAddress,
          priceUsd: parsedPrice,
          liquidityUsd: parsedLiq,
          baseToken: String(baseObj.address ?? ''),
          quoteToken: String(quoteObj.address ?? ''),
          epistemicPrice: {
            state: isPriceValid ? 'PRESENT' : 'ABSENT',
            value: isPriceValid ? parsedPrice : undefined,
            observedAtMs: now,
          },
          epistemicLiquidity: {
            state: isLiqValid ? 'PRESENT' : 'ABSENT',
            value: isLiqValid ? parsedLiq : undefined,
            observedAtMs: now,
          },
        });
      }
    }

    const hasPairs = validatedPairs.length > 0;
    const epistemicState: EpistemicState = hasPairs ? 'PRESENT' : 'ABSENT';

    return { isValid: true, pairs: validatedPairs, hasPairs, epistemicState };
  }

  /**
   * Updates health metrics and isolates drifting providers.
   */
  public recordValidationResult(params: {
    providerId: string;
    isTransportOk: boolean;
    isSchemaOk: boolean;
    isSemanticOk: boolean;
    isFresh: boolean;
    quotaAvailable: boolean;
    slot: number;
    errorReason?: string;
    contractEpochId?: string;
    contractFingerprint?: string;
  }): ProviderContractHealth {
    const {
      providerId, isTransportOk, isSchemaOk, isSemanticOk, isFresh, quotaAvailable,
      slot, errorReason, contractEpochId, contractFingerprint
    } = params;

    const transportHealth: HealthDimensionStatus = isTransportOk ? 'HEALTHY' : 'DEGRADED';
    const schemaHealth: HealthDimensionStatus = isSchemaOk ? 'HEALTHY' : 'QUARANTINED';
    const semanticHealth: HealthDimensionStatus = isSemanticOk ? 'HEALTHY' : 'QUARANTINED';
    const freshnessHealth: HealthDimensionStatus = isFresh ? 'HEALTHY' : 'DEGRADED';
    const quotaHealth: HealthDimensionStatus = quotaAvailable ? 'HEALTHY' : 'DEGRADED';

    const isQuarantined = schemaHealth === 'QUARANTINED' || semanticHealth === 'QUARANTINED' || !isTransportOk;

    const health: ProviderContractHealth = {
      providerId,
      transportHealth,
      schemaHealth,
      semanticHealth,
      freshnessHealth,
      quotaHealth,
      isQuarantined,
      lastValidatedSlot: slot,
      lastValidatedAtMs: Date.now(),
      failureReason: errorReason,
      contractEpochId,
      contractFingerprint,
    };

    this.healthByProvider.set(providerId, health);
    return health;
  }

  /**
   * Records validation result and persists durable state to SQLite WAL Store.
   */
  public async recordValidationResultAndPersist(
    params: {
      providerId: string;
      isTransportOk: boolean;
      isSchemaOk: boolean;
      isSemanticOk: boolean;
      isFresh: boolean;
      quotaAvailable: boolean;
      slot: number;
      errorReason?: string;
      contractEpochId?: string;
      contractFingerprint?: string;
    },
    store?: { saveContractCanary: (health: Record<string, unknown>) => Promise<void> }
  ): Promise<ProviderContractHealth> {
    const health = this.recordValidationResult(params);
    if (store && typeof store.saveContractCanary === 'function') {
      await store.saveContractCanary(health as unknown as Record<string, unknown>);
    }
    return health;
  }

  /**
   * Rehydrates durable provider canary state from SQLite WAL Store on engine boot.
   */
  public async loadPersistedCanaries(store: {
    getAllContractCanaries: () => Promise<any[]>;
  }): Promise<number> {
    const rows = await store.getAllContractCanaries();
    let rehydratedCount = 0;

    for (const r of rows) {
      const providerId = r.provider_id ?? r.providerId;
      if (!providerId) continue;

      const health: ProviderContractHealth = {
        providerId,
        transportHealth: r.transport_health ?? r.transportHealth ?? 'HEALTHY',
        schemaHealth: r.schema_health ?? r.schemaHealth ?? 'HEALTHY',
        semanticHealth: r.semantic_health ?? r.semanticHealth ?? 'HEALTHY',
        freshnessHealth: r.freshness_health ?? r.freshnessHealth ?? 'HEALTHY',
        quotaHealth: r.quota_health ?? r.quotaHealth ?? 'HEALTHY',
        isQuarantined: r.is_quarantined === 1 || r.isQuarantined === true,
        lastValidatedSlot: Number(r.last_validated_slot ?? r.lastValidatedSlot ?? 0),
        lastValidatedAtMs: Number(r.last_validated_at_ms ?? r.lastValidatedAtMs ?? Date.now()),
        failureReason: r.failure_reason ?? r.failureReason,
        contractEpochId: r.contract_epoch_id ?? r.contractEpochId,
        contractFingerprint: r.contract_fingerprint ?? r.contractFingerprint,
      };

      this.healthByProvider.set(providerId, health);
      rehydratedCount++;
    }

    return rehydratedCount;
  }

  public quarantineProvider(providerId: string, reason: string): ProviderContractHealth {
    const current = this.healthByProvider.get(providerId);
    const updated: ProviderContractHealth = {
      providerId,
      transportHealth: current?.transportHealth ?? 'DEGRADED',
      schemaHealth: 'QUARANTINED',
      semanticHealth: 'QUARANTINED',
      freshnessHealth: current?.freshnessHealth ?? 'DEGRADED',
      quotaHealth: current?.quotaHealth ?? 'HEALTHY',
      isQuarantined: true,
      lastValidatedSlot: current?.lastValidatedSlot ?? 0,
      lastValidatedAtMs: Date.now(),
      failureReason: reason,
      contractEpochId: current?.contractEpochId,
      contractFingerprint: current?.contractFingerprint,
    };
    this.healthByProvider.set(providerId, updated);
    return updated;
  }

  public liftQuarantine(providerId: string): ProviderContractHealth | undefined {
    const current = this.healthByProvider.get(providerId);
    if (!current) return undefined;
    const updated: ProviderContractHealth = {
      ...current,
      schemaHealth: 'HEALTHY',
      semanticHealth: 'HEALTHY',
      isQuarantined: false,
      failureReason: undefined,
      lastValidatedAtMs: Date.now(),
    };
    this.healthByProvider.set(providerId, updated);
    return updated;
  }

  public getAllHealth(): readonly ProviderContractHealth[] {
    return Array.from(this.healthByProvider.values());
  }
}

export const globalContractCanary = new ContractCanaryAuthority();

export function validateRugCheckResponse(data: unknown, rawWitness?: RawWireWitness) {
  return globalContractCanary.validateRugCheckResponse(data, rawWitness);
}

export function validateDexScreenerPairs(data: unknown, rawWitness?: RawWireWitness) {
  return globalContractCanary.validateDexScreenerPairs(data, rawWitness);
}

export interface DerivedContribution<T> {
  readonly contributionId: string;
  readonly targetStateId: string;
  readonly sourceEventId: string;
  readonly evidenceId: string;
  readonly contractEpochId: string;
  readonly observedAtMs: number;
  readonly delta: T;
  readonly status: 'ACTIVE' | 'INVALIDATED' | 'SUPERSEDED';
}

/**
 * Reversible rolling window that preserves individual contribution lineage.
 * When an upstream observation is invalidated, velocity and aggregates are
 * recomputed exclusively from surviving ACTIVE observations without naive subtraction.
 */
export class ReversibleRollingWindow<T> {
  private readonly contributions: DerivedContribution<T>[] = [];

  constructor(
    private readonly windowSizeMs: number = 60_000,
    private readonly valueExtractor: (delta: T) => number = (d) => Number(d)
  ) {}

  public append(contribution: Omit<DerivedContribution<T>, 'status'>): DerivedContribution<T> {
    const full: DerivedContribution<T> = {
      ...contribution,
      status: 'ACTIVE',
    };
    this.contributions.push(full);
    this.pruneOld(Date.now());
    return full;
  }

  public invalidateContribution(contributionId: string): boolean {
    const idx = this.contributions.findIndex(c => c.contributionId === contributionId);
    if (idx !== -1 && this.contributions[idx].status === 'ACTIVE') {
      const c = this.contributions[idx];
      this.contributions[idx] = { ...c, status: 'INVALIDATED' };
      return true;
    }
    return false;
  }

  public invalidateContractEpoch(contractEpochId: string): number {
    let count = 0;
    for (let i = 0; i < this.contributions.length; i++) {
      if (this.contributions[i].contractEpochId === contractEpochId && this.contributions[i].status === 'ACTIVE') {
        this.contributions[i] = { ...this.contributions[i], status: 'INVALIDATED' };
        count++;
      }
    }
    return count;
  }

  public getActiveObservations(now = Date.now()): readonly DerivedContribution<T>[] {
    const cutoff = now - this.windowSizeMs;
    return this.contributions.filter(c => c.status === 'ACTIVE' && c.observedAtMs >= cutoff);
  }

  public computeSum(now = Date.now()): number {
    const active = this.getActiveObservations(now);
    return active.reduce((acc, c) => acc + this.valueExtractor(c.delta), 0);
  }

  public computeVelocity(now = Date.now()): number {
    const active = this.getActiveObservations(now);
    if (active.length < 2) return 0;
    const sorted = [...active].sort((a, b) => a.observedAtMs - b.observedAtMs);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const dtSeconds = Math.max(0.001, (last.observedAtMs - first.observedAtMs) / 1000);
    const dVal = this.valueExtractor(last.delta) - this.valueExtractor(first.delta);
    return dVal / dtSeconds;
  }

  private pruneOld(now: number): void {
    const cutoff = now - (this.windowSizeMs * 2);
    while (this.contributions.length > 0 && this.contributions[0].observedAtMs < cutoff) {
      this.contributions.shift();
    }
  }
}

export interface StateRecoveryRoot {
  readonly rootDigest: string;
  readonly recoverySlot: number;
  readonly recoveryEpoch: number;
  readonly rawEvidenceRoot: string;
  readonly contractEpochRoot: string;
  readonly canonicalEventRoot: string;
  readonly rollingStateRoot: string;
  readonly featureSnapshotRoot: string;
  readonly modelEpochRoot: string;
  readonly calibrationRoot: string;
  readonly positionReconciliationRoot: string;
  readonly verifiedAtMs: number;
}

export function computeStateRecoveryRoot(params: Omit<StateRecoveryRoot, 'rootDigest' | 'verifiedAtMs'>): StateRecoveryRoot {
  const verifiedAtMs = Date.now();
  const canonicalString = [
    params.recoverySlot,
    params.recoveryEpoch,
    params.rawEvidenceRoot,
    params.contractEpochRoot,
    params.canonicalEventRoot,
    params.rollingStateRoot,
    params.featureSnapshotRoot,
    params.modelEpochRoot,
    params.calibrationRoot,
    params.positionReconciliationRoot,
    verifiedAtMs,
  ].join(':');

  const rootDigest = createHash('sha256').update(canonicalString).digest('hex');
  return {
    ...params,
    rootDigest,
    verifiedAtMs,
  };
}

export type BlastRadiusAction =
  | 'NO_ACTION'
  | 'RECOMPUTE'
  | 'REVOKE'
  | 'QUARANTINE'
  | 'RECONCILE_POSITION'
  | 'FORENSIC_REVIEW';

export interface BlastRadiusCertificate {
  readonly certificateId: string;
  readonly invalidatedContractEpochId: string;
  readonly evaluatedAtMs: number;
  readonly affectedRawWitnessCount: number;
  readonly affectedCanonicalEventsCount: number;
  readonly affectedSnapshotCount: number;
  readonly affectedPositionCount: number;
  readonly requiredAction: BlastRadiusAction;
  readonly certificateDigest: string;
}

export function computeBlastRadiusCertificate(params: {
  invalidatedContractEpochId: string;
  affectedRawWitnessCount: number;
  affectedCanonicalEventsCount: number;
  affectedSnapshotCount: number;
  affectedPositionCount: number;
}): BlastRadiusCertificate {
  const evaluatedAtMs = Date.now();
  const requiredAction: BlastRadiusAction = params.affectedPositionCount > 0
    ? 'RECONCILE_POSITION'
    : params.affectedSnapshotCount > 0
    ? 'RECOMPUTE'
    : params.affectedCanonicalEventsCount > 0
    ? 'REVOKE'
    : 'NO_ACTION';

  const certId = `brc_${params.invalidatedContractEpochId}_${evaluatedAtMs}`;
  const canonicalString = `${certId}:${params.invalidatedContractEpochId}:${params.affectedRawWitnessCount}:${params.affectedCanonicalEventsCount}:${params.affectedSnapshotCount}:${params.affectedPositionCount}:${requiredAction}:${evaluatedAtMs}`;
  const certificateDigest = createHash('sha256').update(canonicalString).digest('hex');

  return {
    certificateId: certId,
    invalidatedContractEpochId: params.invalidatedContractEpochId,
    evaluatedAtMs,
    affectedRawWitnessCount: params.affectedRawWitnessCount,
    affectedCanonicalEventsCount: params.affectedCanonicalEventsCount,
    affectedSnapshotCount: params.affectedSnapshotCount,
    affectedPositionCount: params.affectedPositionCount,
    requiredAction,
    certificateDigest,
  };
}
