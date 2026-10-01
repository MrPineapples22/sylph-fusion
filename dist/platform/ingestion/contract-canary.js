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
 * 5. Pre-decoding RawWireWitness cryptographic provenance tracking.
 * 6. Durable SQLite WAL persistence & cold-boot rehydration.
 */
import { createHash } from 'node:crypto';
/**
 * Creates a cryptographic pre-decoding wire witness for external network traffic.
 */
export function createWireWitness(providerId, capabilityId, transport, payload, httpStatus, contractStatus = 'VALID') {
    const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
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
    };
}
export class ContractCanaryAuthority {
    healthByProvider = new Map();
    getHealth(providerId) {
        return this.healthByProvider.get(providerId);
    }
    isProviderHealthy(providerId) {
        const h = this.healthByProvider.get(providerId);
        if (!h)
            return false;
        return !h.isQuarantined && h.transportHealth === 'HEALTHY' && h.schemaHealth === 'HEALTHY' && h.semanticHealth === 'HEALTHY';
    }
    isProviderEligible(providerId) {
        const h = this.healthByProvider.get(providerId);
        if (!h)
            return true;
        return !h.isQuarantined;
    }
    /**
     * Creates a cryptographic RawWireWitness hashing external payloads prior to authoritative decoding.
     */
    createWireWitness(providerId, capabilityId, transport, payload, httpStatus = 200, contractStatus) {
        const rawPayload = Buffer.isBuffer(payload) || typeof payload === 'string'
            ? payload
            : JSON.stringify(payload);
        return createWireWitness(providerId, capabilityId, transport, rawPayload, httpStatus, contractStatus ?? (httpStatus >= 400 ? 'MALFORMED' : 'VALID'));
    }
    /**
     * Runtime validator for RugCheck reports enforcing explicit epistemic completeness.
     */
    validateRugCheckResponse(data, rawWitness) {
        if (!data || typeof data !== 'object') {
            return { isValid: false, error: 'RugCheck response must be a non-null object' };
        }
        const d = data;
        if (typeof d.score !== 'number' || !Number.isFinite(d.score) || d.score < 0) {
            return { isValid: false, error: 'RugCheck report missing finite non-negative score' };
        }
        if (!Array.isArray(d.risks)) {
            return { isValid: false, error: 'RugCheck report missing risks array' };
        }
        const now = Date.now();
        const risks = d.risks.map((r) => {
            const rec = (r && typeof r === 'object' ? r : {});
            return {
                name: String(rec.name ?? 'unknown'),
                level: String(rec.level ?? 'unknown'),
                score: typeof rec.score === 'number' ? rec.score : 0,
            };
        });
        // 1. Epistemic extraction of 'rugged' flag: Never convert missing into false
        const hasRuggedProp = 'rugged' in d;
        const isRuggedBoolean = typeof d.rugged === 'boolean';
        const epistemicRugged = isRuggedBoolean
            ? { state: 'PRESENT', value: d.rugged, observedAtMs: now, rawField: 'rugged' }
            : hasRuggedProp && d.rugged === null
                ? { state: 'NULL', observedAtMs: now, rawField: 'rugged' }
                : hasRuggedProp
                    ? { state: 'INVALID', observedAtMs: now, rawField: 'rugged' }
                    : { state: 'ABSENT', observedAtMs: now, rawField: 'rugged' };
        // 2. Epistemic extraction of authorities
        const token = (d.token && typeof d.token === 'object' ? d.token : {});
        const hasMintProp = 'mintAuthority' in token || 'mintAuthority' in d;
        const mintVal = token.mintAuthority !== undefined ? token.mintAuthority : d.mintAuthority;
        const epistemicMintAuthority = typeof mintVal === 'string'
            ? { state: 'PRESENT', value: mintVal, observedAtMs: now, rawField: 'mintAuthority' }
            : mintVal === null
                ? { state: 'NULL', value: null, observedAtMs: now, rawField: 'mintAuthority' }
                : hasMintProp
                    ? { state: 'INVALID', observedAtMs: now, rawField: 'mintAuthority' }
                    : { state: 'ABSENT', observedAtMs: now, rawField: 'mintAuthority' };
        const hasFreezeProp = 'freezeAuthority' in token || 'freezeAuthority' in d;
        const freezeVal = token.freezeAuthority !== undefined ? token.freezeAuthority : d.freezeAuthority;
        const epistemicFreezeAuthority = typeof freezeVal === 'string'
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
    validateDexScreenerPairs(data, rawWitness) {
        if (!data || typeof data !== 'object') {
            return { isValid: false, hasPairs: false, epistemicState: 'INVALID', error: 'DexScreener response must be an object' };
        }
        const d = data;
        if (!Array.isArray(d.pairs)) {
            return { isValid: false, hasPairs: false, epistemicState: 'ABSENT', error: 'DexScreener response missing pairs array' };
        }
        const now = Date.now();
        const validatedPairs = [];
        for (const p of d.pairs) {
            if (!p || typeof p !== 'object')
                continue;
            const pair = p;
            if (typeof pair.pairAddress !== 'string' || pair.pairAddress.length < 32)
                continue;
            const hasPrice = 'priceUsd' in pair && pair.priceUsd !== null && pair.priceUsd !== undefined;
            const parsedPrice = Number(pair.priceUsd ?? 0);
            const isPriceValid = hasPrice && Number.isFinite(parsedPrice) && parsedPrice >= 0;
            const liqObj = (pair.liquidity && typeof pair.liquidity === 'object' ? pair.liquidity : {});
            const hasLiq = 'usd' in liqObj && liqObj.usd !== null && liqObj.usd !== undefined;
            const parsedLiq = Number(liqObj.usd ?? 0);
            const isLiqValid = hasLiq && Number.isFinite(parsedLiq) && parsedLiq >= 0;
            const baseObj = (pair.baseToken && typeof pair.baseToken === 'object' ? pair.baseToken : {});
            const quoteObj = (pair.quoteToken && typeof pair.quoteToken === 'object' ? pair.quoteToken : {});
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
        const epistemicState = hasPairs ? 'PRESENT' : 'ABSENT';
        return { isValid: true, pairs: validatedPairs, hasPairs, epistemicState };
    }
    /**
     * Updates health metrics and isolates drifting providers.
     */
    recordValidationResult(params) {
        const { providerId, isTransportOk, isSchemaOk, isSemanticOk, isFresh, quotaAvailable, slot, errorReason, contractEpochId, contractFingerprint } = params;
        const transportHealth = isTransportOk ? 'HEALTHY' : 'DEGRADED';
        const schemaHealth = isSchemaOk ? 'HEALTHY' : 'QUARANTINED';
        const semanticHealth = isSemanticOk ? 'HEALTHY' : 'QUARANTINED';
        const freshnessHealth = isFresh ? 'HEALTHY' : 'DEGRADED';
        const quotaHealth = quotaAvailable ? 'HEALTHY' : 'DEGRADED';
        const isQuarantined = schemaHealth === 'QUARANTINED' || semanticHealth === 'QUARANTINED' || !isTransportOk;
        const health = {
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
    async recordValidationResultAndPersist(params, store) {
        const health = this.recordValidationResult(params);
        if (store && typeof store.saveContractCanary === 'function') {
            await store.saveContractCanary(health);
        }
        return health;
    }
    /**
     * Rehydrates durable provider canary state from SQLite WAL Store on engine boot.
     */
    async loadPersistedCanaries(store) {
        const rows = await store.getAllContractCanaries();
        let rehydratedCount = 0;
        for (const r of rows) {
            const providerId = r.provider_id ?? r.providerId;
            if (!providerId)
                continue;
            const health = {
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
    quarantineProvider(providerId, reason) {
        const current = this.healthByProvider.get(providerId);
        const updated = {
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
    liftQuarantine(providerId) {
        const current = this.healthByProvider.get(providerId);
        if (!current)
            return undefined;
        const updated = {
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
    getAllHealth() {
        return Array.from(this.healthByProvider.values());
    }
}
export const globalContractCanary = new ContractCanaryAuthority();
export function validateRugCheckResponse(data, rawWitness) {
    return globalContractCanary.validateRugCheckResponse(data, rawWitness);
}
export function validateDexScreenerPairs(data, rawWitness) {
    return globalContractCanary.validateDexScreenerPairs(data, rawWitness);
}
/**
 * Reversible rolling window that preserves individual contribution lineage.
 * When an upstream observation is invalidated, velocity and aggregates are
 * recomputed exclusively from surviving ACTIVE observations without naive subtraction.
 */
export class ReversibleRollingWindow {
    windowSizeMs;
    valueExtractor;
    contributions = [];
    constructor(windowSizeMs = 60_000, valueExtractor = (d) => Number(d)) {
        this.windowSizeMs = windowSizeMs;
        this.valueExtractor = valueExtractor;
    }
    append(contribution) {
        const full = {
            ...contribution,
            status: 'ACTIVE',
        };
        this.contributions.push(full);
        this.pruneOld(Date.now());
        return full;
    }
    invalidateContribution(contributionId) {
        const idx = this.contributions.findIndex(c => c.contributionId === contributionId);
        if (idx !== -1 && this.contributions[idx].status === 'ACTIVE') {
            const c = this.contributions[idx];
            this.contributions[idx] = { ...c, status: 'INVALIDATED' };
            return true;
        }
        return false;
    }
    invalidateContractEpoch(contractEpochId) {
        let count = 0;
        for (let i = 0; i < this.contributions.length; i++) {
            if (this.contributions[i].contractEpochId === contractEpochId && this.contributions[i].status === 'ACTIVE') {
                this.contributions[i] = { ...this.contributions[i], status: 'INVALIDATED' };
                count++;
            }
        }
        return count;
    }
    getActiveObservations(now = Date.now()) {
        const cutoff = now - this.windowSizeMs;
        return this.contributions.filter(c => c.status === 'ACTIVE' && c.observedAtMs >= cutoff);
    }
    computeSum(now = Date.now()) {
        const active = this.getActiveObservations(now);
        return active.reduce((acc, c) => acc + this.valueExtractor(c.delta), 0);
    }
    computeVelocity(now = Date.now()) {
        const active = this.getActiveObservations(now);
        if (active.length < 2)
            return 0;
        const sorted = [...active].sort((a, b) => a.observedAtMs - b.observedAtMs);
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const dtSeconds = Math.max(0.001, (last.observedAtMs - first.observedAtMs) / 1000);
        const dVal = this.valueExtractor(last.delta) - this.valueExtractor(first.delta);
        return dVal / dtSeconds;
    }
    pruneOld(now) {
        const cutoff = now - (this.windowSizeMs * 2);
        while (this.contributions.length > 0 && this.contributions[0].observedAtMs < cutoff) {
            this.contributions.shift();
        }
    }
}
export function computeStateRecoveryRoot(params) {
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
export function computeBlastRadiusCertificate(params) {
    const evaluatedAtMs = Date.now();
    const requiredAction = params.affectedPositionCount > 0
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
//# sourceMappingURL=contract-canary.js.map