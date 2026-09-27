import { randomUUID, createHash } from 'node:crypto';
import { DISCOVERY_FRESH_MS } from './discovery.js';
import { globalConfigAuthority } from './config-authority.js';
/** Default time-to-live for a projection before UI must consider it stale. */
export const PROJECTION_STALE_FENCE_MS = 4_000;
const capability = (state, reasonCodes = [], eligibility, mode) => ({
    state,
    reasonCodes,
    ...(eligibility ? { eligibility } : {}),
    ...(mode ? { mode } : {}),
});
/** One process generation and ordered projection stream. No live authority is inferred from paper state. */
export class OperatorReadModel {
    generation = randomUUID();
    version = 0;
    incidents = new Map();
    /** Compute a deterministic digest of positions + capital state for fast UI comparison. */
    computeReconciliationDigest(positions, cashUsd, reservedCashUsd) {
        const h = createHash('sha256');
        h.update(JSON.stringify({ p: positions.map((p) => ({ m: p.mint, q: p.qty, e: p.entry, r: p.reconciliationState })), c: cashUsd, r: reservedCashUsd }));
        return h.digest('hex').slice(0, 16);
    }
    /** Build the full blocker chain for a capability action. */
    buildBlockerChain(cap, marketState, halted) {
        const chain = [];
        if (halted)
            chain.push('SYSTEM_HALTED');
        if (marketState !== 'CURRENT')
            chain.push('MARKET_DATA_' + marketState);
        for (const rc of cap.reasonCodes)
            chain.push(rc);
        return chain;
    }
    project({ discovery, gateway, health, lifecycle, runtimeContext, now = Date.now() }) {
        const providers = Object.values(health.providers).map(p => ({
            id: p.providerId, state: p.state, role: p.role, configured: p.configured,
            authority: p.isAuthoritative, freshness: p.freshness,
            ageMs: p.lastValidatedObservation > 0 && p.lastValidatedObservation <= now ? now - p.lastValidatedObservation : null,
            latencyMs: p.lastSuccess > 0 && Number.isFinite(p.avgLatencyMs) ? p.avgLatencyMs : null,
            circuit: p.circuitState, reason: p.failureReason, capabilityAvailable: p.capabilityAvailable,
        }));
        const feed = providers.find(p => p.id === 'PUMPPORTAL_WS');
        const conflicts = discovery.rows.filter(row => row.crossValidationStatus === 'CONFLICTING').map(row => ({ mint: row.mint, reasonCode: 'MARKET_SOURCES_CONFLICT' }));
        const marketState = conflicts.length ? 'CONFLICTING' : feed?.ageMs == null ? 'UNKNOWN' : discovery.feedStale || feed.ageMs > DISCOVERY_FRESH_MS ? 'STALE' : 'CURRENT';
        const halted = ['SAFETY_LOCKED', 'SHUTTING_DOWN'].includes(lifecycle);
        // Live adapters are absent. The simulator is nevertheless an explicit,
        // isolated paper capability and must not be presented as a live readiness.
        const paperSimulation = gateway.mode === 'paper' || gateway.mode === 'shadow';
        const paperAction = (marketRequired) => !halted && paperSimulation && (!marketRequired || marketState === 'CURRENT');
        const paperEntry = paperAction(true) && !gateway.entriesHalted;
        const hasPositions = (discovery.positions || []).length > 0;
        const config = globalConfigAuthority.getConfig();
        const maxPositions = runtimeContext?.publicConfig.maxPositions ?? config.maxPositions;
        const atPositionCapacity = (discovery.positions || []).length >= maxPositions;
        const capabilities = {
            observe: capability(marketState === 'CURRENT' ? 'READY' : 'UNKNOWN', marketState === 'CURRENT' ? [] : ['MARKET_EVIDENCE_' + marketState], 'ELIGIBLE', gateway.mode),
            score: capability('BLOCKED', ['SIGNAL_ADAPTER_UNAVAILABLE'], 'INELIGIBLE', gateway.mode),
            open: paperEntry && !atPositionCapacity
                ? capability('READY', ['PAPER_SIMULATION_ONLY'], 'ELIGIBLE', 'PAPER')
                : atPositionCapacity
                    ? capability('BLOCKED', ['MAX_POSITIONS_REACHED'], 'AT_CAPACITY', 'PAPER')
                    : capability('BLOCKED', [...(gateway.entriesHalted ? ['PAPER_EMERGENCY_STOP'] : ['EXECUTION_REVIEW_UNAVAILABLE']), ...(marketState === 'CURRENT' ? [] : ['MARKET_EVIDENCE_' + marketState])], 'INELIGIBLE', gateway.mode),
            increase: paperEntry && hasPositions
                ? capability('READY', ['PAPER_SIMULATION_ONLY'], 'ELIGIBLE', 'PAPER')
                : !hasPositions
                    ? capability('BLOCKED', ['NO_POSITION'], 'NO_POSITION', 'PAPER')
                    : capability('BLOCKED', [...(gateway.entriesHalted ? ['PAPER_EMERGENCY_STOP'] : ['EXECUTION_REVIEW_UNAVAILABLE'])], 'INELIGIBLE', gateway.mode),
            reduce: paperAction(false) && hasPositions
                ? capability('READY', ['PAPER_SIMULATION_ONLY'], 'ELIGIBLE', 'PAPER')
                : !hasPositions
                    ? capability('BLOCKED', ['NO_POSITION'], 'NO_POSITION', 'PAPER')
                    : capability('BLOCKED', ['EXIT_REVIEW_UNAVAILABLE'], 'INELIGIBLE', gateway.mode),
            close: paperAction(false) && hasPositions
                ? capability('READY', ['PAPER_SIMULATION_ONLY'], 'ELIGIBLE', 'PAPER')
                : !hasPositions
                    ? capability('BLOCKED', ['NO_POSITION'], 'NO_POSITION', 'PAPER')
                    : capability('BLOCKED', ['EXIT_REVIEW_UNAVAILABLE'], 'INELIGIBLE', gateway.mode),
            reconcile: capability('BLOCKED', ['LIVE_RECONCILIATION_UNAVAILABLE'], 'INELIGIBLE', gateway.mode),
            persist: capability('BLOCKED', ['DURABLE_OPERATOR_LEDGER_UNAVAILABLE'], 'INELIGIBLE', gateway.mode),
        };
        // Derive aggregate system state from actual capability readiness — never hardcode BLOCKED.
        const operationalCaps = [capabilities.open, capabilities.increase, capabilities.reduce, capabilities.close];
        const anyReady = operationalCaps.some(c => c.state === 'READY');
        const allBlocked = operationalCaps.every(c => c.state === 'BLOCKED');
        // Exit-only paper capability is not evidence that the entire system is
        // operational.  A stale/unknown market feed leaves the system degraded
        // even when reduction and close remain deliberately available.
        const systemState = halted ? 'HALTED' : marketState !== 'CURRENT' ? (allBlocked ? 'BLOCKED' : 'DEGRADED') : anyReady ? 'OPERATIONAL' : 'BLOCKED';
        const reasons = [...(paperSimulation ? [] : ['EXECUTION_REVIEW_UNAVAILABLE', 'LIVE_RECONCILIATION_UNAVAILABLE']), ...(gateway.entriesHalted ? ['PAPER_EMERGENCY_STOP'] : []), ...(marketState === 'CURRENT' ? [] : ['MARKET_EVIDENCE_' + marketState])];
        for (const incident of this.incidents.values())
            if (!reasons.includes(incident.reasonCode))
                incident.state = 'RESOLVED';
        for (const reason of reasons) {
            const prior = this.incidents.get(reason);
            this.incidents.set(reason, { incidentId: reason, detectedAt: prior?.state === 'ACTIVE' ? prior.detectedAt : now,
                updatedAt: now, reasonCode: reason, state: 'ACTIVE', priority: 'A3',
                operatorAction: reason === 'PAPER_EMERGENCY_STOP' ? 'Paper entries and automation are stopped. Inspect the stop cause; existing paper positions may still be reduced or closed.' : reason.startsWith('MARKET_') ? 'Inspect provider evidence; wait for validated observations.' : 'Required adapter must be connected and verified before this capability is available.' });
        }
        const positions = discovery.positions.map(raw => ({ ...raw, ledgerScope: 'PAPER', closeCapability: capabilities.close }));
        const marketConstraint = { id: 'market-freshness', label: 'Market freshness', current: feed?.ageMs ?? null, boundary: DISCOVERY_FRESH_MS,
            margin: feed?.ageMs == null ? null : DISCOVERY_FRESH_MS - feed.ageMs, unit: 'ms', state: marketState === 'CURRENT' ? 'SAFE' : marketState === 'UNKNOWN' ? 'UNKNOWN' : 'BREACHED', source: 'Provider health' };
        const positionMargin = maxPositions - positions.length;
        const positionConstraint = { id: 'positions', label: 'Paper position capacity', current: positions.length, boundary: maxPositions, margin: positionMargin, unit: 'positions', state: positionMargin <= 0 ? 'BREACHED' : positionMargin === 1 ? 'APPROACHING' : 'SAFE', source: 'Paper ledger / policy authority' };
        const reviewConstraint = paperSimulation
            ? { id: 'review', label: 'Paper simulation review', current: 1, boundary: 1, margin: 0, unit: '', state: 'SAFE', source: 'Local paper simulator' }
            : { id: 'review', label: 'Verified execution review', current: null, boundary: null, margin: null, unit: '', state: 'UNKNOWN', source: 'Review adapter unavailable' };
        const projectionVersion = ++this.version;
        const validUntil = now + PROJECTION_STALE_FENCE_MS;
        const reconciliationDigest = this.computeReconciliationDigest(discovery.positions, gateway.cashUsd, gateway.reservedCashUsd);
        const buildEnvelope = (action, cap, actionConstraints) => {
            const breached = actionConstraints.find(c => c.state === 'BREACHED');
            const unknown = actionConstraints.find(c => c.state === 'UNKNOWN');
            const approaching = actionConstraints.find(c => c.state === 'APPROACHING');
            const dominant = breached?.label ?? (cap.state === 'BLOCKED' ? (cap.reasonCodes[0] ?? 'Capability blocked') : unknown?.label ?? approaching?.label ?? (paperSimulation ? 'Paper simulation constraints satisfied' : 'All execution constraints satisfied'));
            const state = breached ? 'BREACHED' : cap.state === 'BLOCKED' ? 'BLOCKED' : unknown ? 'UNKNOWN' : approaching ? 'APPROACHING' : 'SAFE';
            return {
                state,
                dominantConstraint: dominant,
                constraints: actionConstraints,
                capability: cap,
                blockerChain: this.buildBlockerChain(cap, marketState, halted),
            };
        };
        return {
            schemaVersion: 1, authorityGeneration: this.generation, projectionVersion,
            runtime: runtimeContext ? { generation: runtimeContext.runtimeGeneration, configHash: runtimeContext.configHash, mode: runtimeContext.mode } : null,
            generatedAt: now, validUntil, staleFenceMs: PROJECTION_STALE_FENCE_MS, reconciliationDigest,
            environment: { mode: gateway.mode === 'paper' ? 'SIMULATION' : gateway.mode.toUpperCase(), cluster: 'UNKNOWN', signerState: 'UNAVAILABLE', ledgerScope: 'PAPER' },
            system: { state: systemState, lifecycle, reasonCodes: reasons },
            marketData: { state: marketState, ageMs: feed?.ageMs ?? null, authoritativeSources: providers.filter(p => p.authority && p.role === 'DISCOVERY_STREAM').map(p => p.id), conflicts, conflictVerification: 'PARTIAL' },
            capabilities,
            risk: { state: 'UNKNOWN', utilization: null, blockers: ['PORTFOLIO_RISK_PROJECTION_UNAVAILABLE'] },
            capital: {
                state: 'PARTIAL',
                denomination: 'USD',
                available: Number.isFinite(gateway.reservedCashUsd) ? gateway.cashUsd - gateway.reservedCashUsd : null,
                reserved: gateway.reservedCashUsd ?? null,
                emergencyReserve: Number.isFinite(gateway.cashUsd) ? Number((gateway.cashUsd * ((systemState === 'HALTED' || gateway.entriesHalted) ? 0.50 : 0.20)).toFixed(2)) : null,
                emergencyReservePolicy: (systemState === 'HALTED' || gateway.entriesHalted) ? '50% Zone 0 Defensive Freeze' : '20% Zone 0 Capital Preservation Floor',
                ledgerScope: 'PAPER'
            },
            positions, executions: { state: gateway.inFlightOrdersCount ? 'ACTIVE' : 'UNKNOWN', inFlightCount: gateway.inFlightOrdersCount, items: [], reasonCode: 'EXECUTION_LEDGER_UNAVAILABLE' },
            incidents: [...this.incidents.values()].filter(i => i.state === 'ACTIVE'), providers,
            verification: { state: 'UNVERIFIED', buildVersion: null, policyVersion: config.version, reasonCodes: ['RELEASE_GATES_INCOMPLETE'] },
            envelopes: Object.fromEntries(['open', 'increase', 'reduce', 'close', 'reconcile'].map(action => [action,
                buildEnvelope(action, capabilities[action], action === 'open' || action === 'increase' ? [marketConstraint, positionConstraint, reviewConstraint] : [reviewConstraint]),
            ])),
            capabilityBlockers: Object.fromEntries(Object.entries(capabilities).map(([key, cap]) => [
                key, this.buildBlockerChain(cap, marketState, halted),
            ])),
            automation: { discovery: 'AUTO', scoring: 'UNAVAILABLE', entry: 'BLOCKED', exitProtection: 'UNVERIFIED', recovery: 'PROVIDER_MANAGED' },
            tokens: discovery.rows,
        };
    }
}
//# sourceMappingURL=operator-read-model.js.map