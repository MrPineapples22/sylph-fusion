/**
 * Research-only capital planning, risk observations and wallet set comparisons.
 * Supplied values have no durable or on-chain provenance. This module never
 * grants capital, authoritative leases, entry permission or clean reconciliation.
 */
import { randomUUID } from 'node:crypto';
import { types } from 'node:util';
function requireValue(condition, reason) { if (!condition)
    throw new Error(reason); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function amount(value) { return finite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER; }
function text(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 4096; }
function snapshot(value, depth = 0) {
    requireValue(depth <= 8, 'INPUT_TOO_DEEP');
    if (value === null || ['undefined', 'string', 'number', 'boolean', 'bigint'].includes(typeof value))
        return value;
    requireValue(typeof value === 'object' && !types.isProxy(value), 'INVALID_RESEARCH_INPUT');
    requireValue(Object.getOwnPropertySymbols(value).length === 0, 'SYMBOL_FIELDS_UNSUPPORTED');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
        requireValue(Object.getPrototypeOf(value) === Array.prototype && value.length <= 100_000 && Object.keys(descriptors).length === value.length + 1, 'INVALID_RESEARCH_ARRAY');
        const values = [];
        for (let i = 0; i < value.length; i++) {
            const descriptor = descriptors[String(i)];
            requireValue(!!descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'ACCESSORS_UNSUPPORTED');
            values.push(snapshot(descriptor.value, depth + 1));
        }
        return Object.freeze(values);
    }
    const prototype = Object.getPrototypeOf(value);
    requireValue(prototype === Object.prototype || prototype === null, 'INVALID_RESEARCH_PROTOTYPE');
    const values = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors)) {
        requireValue(Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true, 'ACCESSORS_UNSUPPORTED');
        values[key] = snapshot(descriptor.value, depth + 1);
    }
    return Object.freeze(values);
}
function fields(value, required, optional = []) {
    const values = snapshot(value);
    requireValue(values !== null && typeof values === 'object' && !Array.isArray(values), 'INVALID_RESEARCH_INPUT');
    const result = values;
    requireValue(required.every(key => Object.hasOwn(result, key)) && Object.keys(result).every(key => required.includes(key) || optional.includes(key)), 'INVALID_RESEARCH_FIELDS');
    return result;
}
const denyCapital = () => Object.freeze({ isAuthorized: false, authority: 'RESEARCH_ONLY', reason: 'TRUSTED_DURABLE_CAPITAL_AUTHORITY_UNAVAILABLE' });
function reservationInput(input) {
    const values = fields(input, ['intentId', 'mint', 'amountSol'], ['settlementReserveSol', 'feeReserveSol', 'durationMs']);
    const settlement = Object.hasOwn(values, 'settlementReserveSol') ? values.settlementReserveSol : .01;
    const fee = Object.hasOwn(values, 'feeReserveSol') ? values.feeReserveSol : .005;
    const duration = Object.hasOwn(values, 'durationMs') ? values.durationMs : 30_000;
    requireValue(text(values.intentId) && text(values.mint) && amount(values.amountSol) && values.amountSol > 0 && amount(settlement) && amount(fee), 'INVALID_RESERVATION_VALUES');
    requireValue(typeof duration === 'number' && Number.isSafeInteger(duration) && duration > 0 && duration <= 86_400_000, 'INVALID_RESERVATION_DURATION');
    requireValue(amount(values.amountSol + settlement + fee), 'RESERVATION_OVERFLOW');
    return Object.freeze({ intentId: values.intentId, mint: values.mint, amountSol: values.amountSol, settlementReserveSol: settlement, feeReserveSol: fee, durationMs: duration });
}
export class ClearinghouseEngine {
    #researchBalanceSol;
    #instanceId = randomUUID();
    #hypotheticalHolds = new Map();
    #sequence = 0;
    constructor(initialResearchBalanceSol = 0) {
        requireValue(amount(initialResearchBalanceSol), 'INVALID_RESEARCH_BALANCE');
        this.#researchBalanceSol = initialResearchBalanceSol;
    }
    setCanonicalBalance(balanceSol) { requireValue(amount(balanceSol), 'INVALID_BALANCE'); return denyCapital(); }
    getCanonicalBalance() { return null; }
    getAvailableCapital() { return 0; }
    getResearchCapitalEstimate() {
        let reserved = .05;
        for (const hold of this.#hypotheticalHolds.values())
            reserved += hold.amountSol + hold.settlementReserveSol + hold.feeReserveSol;
        requireValue(amount(reserved), 'RESERVATION_OVERFLOW');
        return Object.freeze({ authority: 'RESEARCH_ONLY', suppliedBalanceSol: this.#researchBalanceSol, hypotheticalAvailableSol: Math.max(0, this.#researchBalanceSol - reserved), persistence: 'NONE' });
    }
    /** Tracks a hypothetical hold; elapsed time never proves settlement or frees it. */
    previewReservation(input) {
        const request = reservationInput(input);
        requireValue(!this.#hypotheticalHolds.has(request.intentId), 'DUPLICATE_RESEARCH_INTENT');
        let reserved = .05;
        for (const hold of this.#hypotheticalHolds.values())
            reserved += hold.amountSol + hold.settlementReserveSol + hold.feeReserveSol;
        requireValue(amount(reserved), 'RESERVATION_OVERFLOW');
        requireValue(request.amountSol + request.settlementReserveSol + request.feeReserveSol <= Math.max(0, this.#researchBalanceSol - reserved), 'RESEARCH_RESERVATION_EXCEEDS_ESTIMATE');
        const now = Date.now();
        requireValue(Number.isSafeInteger(now) && now >= 0 && Number.isSafeInteger(now + request.durationMs), 'INVALID_RESEARCH_CLOCK');
        requireValue(Number.isSafeInteger(this.#sequence + 1), 'RESERVATION_SEQUENCE_EXHAUSTED');
        const hold = Object.freeze({ reservationId: `research_reservation_${this.#instanceId}_${++this.#sequence}`,
            intentId: request.intentId, mint: request.mint, amountSol: request.amountSol,
            settlementReserveSol: request.settlementReserveSol, feeReserveSol: request.feeReserveSol,
            createdAtMs: now, expiresAtMs: now + request.durationMs, authority: 'RESEARCH_ONLY', isAuthorized: false, state: 'HYPOTHETICAL_HOLD' });
        this.#hypotheticalHolds.set(request.intentId, hold);
        return hold;
    }
    acquireLease(input) { reservationInput(input); return denyCapital(); }
    releaseLease(leaseId) { requireValue(text(leaseId), 'INVALID_LEASE_ID'); return denyCapital(); }
    markSettled(leaseId) { requireValue(text(leaseId), 'INVALID_LEASE_ID'); return denyCapital(); }
}
export class FirebreakEngine {
    #state = 'RESEARCH_NO_TRIP_OBSERVED';
    #consecutiveLosses = 0;
    #peakEquitySol = 0;
    #maxConsecutiveLosses;
    #maxDrawdownPct;
    constructor(maxConsecutiveLosses = 3, maxDrawdownPct = 15) {
        requireValue(Number.isSafeInteger(maxConsecutiveLosses) && maxConsecutiveLosses > 0 && finite(maxDrawdownPct) && maxDrawdownPct > 0 && maxDrawdownPct <= 100, 'INVALID_FIREBREAK_POLICY');
        this.#maxConsecutiveLosses = maxConsecutiveLosses;
        this.#maxDrawdownPct = maxDrawdownPct;
    }
    recordTradeOutcome(realizedPnlSol, currentEquitySol) {
        if (!finite(realizedPnlSol) || !amount(currentEquitySol)) {
            this.#state = 'TRIPPED_INVALID_INPUT';
            return this.#state;
        }
        if (this.#state !== 'RESEARCH_NO_TRIP_OBSERVED')
            return this.#state;
        this.#peakEquitySol = Math.max(this.#peakEquitySol, currentEquitySol);
        this.#consecutiveLosses = realizedPnlSol < 0 ? this.#consecutiveLosses + 1 : realizedPnlSol > 0 ? 0 : this.#consecutiveLosses;
        const drawdownPct = this.#peakEquitySol > 0 ? ((this.#peakEquitySol - currentEquitySol) / this.#peakEquitySol) * 100 : 0;
        if (drawdownPct >= this.#maxDrawdownPct)
            this.#state = 'TRIPPED_DRAWDOWN';
        else if (this.#consecutiveLosses >= this.#maxConsecutiveLosses)
            this.#state = 'TRIPPED_CONSECUTIVE_LOSSES';
        return this.#state;
    }
    tripAnomaly(reason) { requireValue(text(reason), 'INVALID_ANOMALY_REASON'); this.#state = 'TRIPPED_ANOMALY'; }
    canEnterNewTrades() { return false; }
    getState() { return this.#state; }
    reset(currentEquitySol) { requireValue(amount(currentEquitySol), 'INVALID_EQUITY'); return denyCapital(); }
}
export class OptimalExecutableSizeEngine {
    static calculateSize(input) {
        try {
            const values = fields(input, ['availableCapitalSol', 'poolReserveSol', 'halfKellyFraction', 'expectedNetReturnPct', 'frictionSol']);
            requireValue(amount(values.availableCapitalSol) && amount(values.poolReserveSol) && amount(values.frictionSol) && finite(values.halfKellyFraction) && values.halfKellyFraction >= 0 && values.halfKellyFraction <= 1 && finite(values.expectedNetReturnPct), 'INVALID_SIZING_INPUT');
            const poolCap = values.poolReserveSol * .05;
            const portfolioCap = values.availableCapitalSol * Math.min(.25, values.halfKellyFraction);
            const proposed = Math.min(poolCap, portfolioCap);
            const profit = proposed * (values.expectedNetReturnPct / 100);
            requireValue(finite(profit), 'SIZING_OVERFLOW');
            const friction = values.frictionSol * 2.5;
            const reason = proposed <= 0 ? 'NO_RESEARCH_CAPACITY' : profit <= 0 || profit < friction ? 'INSUFFICIENT_PROFIT_OVER_FRICTION' : undefined;
            // Floor rather than round upward across the supplied caps.
            const suggested = reason ? 0 : Math.min(proposed, Math.floor(proposed * 10_000) / 10_000);
            requireValue(amount(suggested), 'SIZING_OVERFLOW');
            return Object.freeze({ authority: 'RESEARCH_ONLY', optimalSizeSol: 0, suggestedResearchSizeSol: suggested,
                poolReserveCapSol: poolCap, portfolioCapSol: portfolioCap, suppliedFrictionSol: values.frictionSol, frictionPenaltySol: friction, frictionHurdleMultiplier: 2.5,
                isApproved: false, vetoReason: 'TRUSTED_DURABLE_CAPITAL_AUTHORITY_UNAVAILABLE', ...(reason ? { researchVetoReason: reason } : {}) });
        }
        catch (error) {
            return Object.freeze({ authority: 'RESEARCH_ONLY', optimalSizeSol: 0, suggestedResearchSizeSol: 0,
                poolReserveCapSol: 0, portfolioCapSol: 0, suppliedFrictionSol: 0, frictionPenaltySol: 0, frictionHurdleMultiplier: 2.5, isApproved: false,
                vetoReason: error instanceof Error ? error.message : 'INVALID_SIZING_INPUT' });
        }
    }
}
export class WholeWalletCensusAndReconciler {
    static reconcile(internalOpenMints, onChainAccounts) {
        let internal = [];
        let chain = [];
        let external = [];
        let missing = [];
        let validationError;
        try {
            const internalData = snapshot(internalOpenMints);
            const accountData = snapshot(onChainAccounts);
            requireValue(Array.isArray(internalData) && internalData.every(text) && new Set(internalData).size === internalData.length && Array.isArray(accountData), 'INVALID_WALLET_INPUT');
            const seen = new Set();
            const mints = [];
            for (const account of accountData) {
                const values = fields(account, ['mint', 'tokenAmount']);
                requireValue(text(values.mint) && typeof values.tokenAmount === 'bigint' && values.tokenAmount >= 0n && values.tokenAmount <= 18446744073709551615n, 'INVALID_WALLET_AMOUNT');
                requireValue(!seen.has(values.mint), 'DUPLICATE_MINT_WITHOUT_ACCOUNT_ID');
                seen.add(values.mint);
                if (values.tokenAmount > 0n)
                    mints.push(values.mint);
            }
            internal = Object.freeze([...internalData]);
            chain = Object.freeze(mints);
            const internalSet = new Set(internal);
            const chainSet = new Set(chain);
            external = Object.freeze(chain.filter(mint => !internalSet.has(mint)));
            missing = Object.freeze(internal.filter(mint => !chainSet.has(mint)));
        }
        catch (error) {
            validationError = error instanceof Error ? error.message : 'INVALID_WALLET_INPUT';
        }
        return Object.freeze({ timestampMs: Date.now(), authority: 'RESEARCH_ONLY', status: 'UNKNOWN_UNVERIFIED',
            internalMints: Object.freeze([...internal]), onChainMints: Object.freeze([...chain]),
            unmanagedExternalMints: Object.freeze([...external]), missingMints: Object.freeze([...missing]), isClean: false,
            reason: 'Internal amounts, account identities, durable state and trusted on-chain provenance are unavailable.', ...(validationError ? { validationError } : {}) });
    }
}
//# sourceMappingURL=capital-risk-x.js.map