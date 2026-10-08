export const DISCOVERY_FRESH_MS = 5_000;
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';
const fresh = (at, now, ttl) => Number.isFinite(at) && at > 0 && at <= now && now - at <= ttl;
/**
 * Observation-only discovery projection. It deliberately has no Token Safety
 * Authority and cannot issue VETO or a HardVetoProof; current authority must
 * be supplied by the canonical decision engine.
 */
export function discoverySnapshot(input) {
    const now = input.now ?? Date.now();
    const rows = input.tokens.map(token => {
        const risk = input.risks.get(token.mint), signal = input.signals.get(token.mint);
        const native = token.mint === NATIVE_SOL_MINT;
        const marketFresh = fresh(token.at, now, DISCOVERY_FRESH_MS);
        const riskFresh = !!risk && risk.mint === token.mint && fresh(risk.at, now, 45_000);
        const signalFresh = !!signal && signal.mint === token.mint && !!signal.source && !!signal.version && typeof signal.devDump === 'boolean' && typeof signal.bundler === 'boolean' && fresh(signal.at, now, DISCOVERY_FRESH_MS) && Number.isFinite(signal.highSignalIndex) && signal.highSignalIndex >= 0 && signal.highSignalIndex <= 100 && Number.isFinite(signal.confidence) && signal.confidence >= 0 && signal.confidence <= 1;
        const complete = token.complete === true || token.migrated === true;
        const venueState = complete ? (token.migrated ? 'MIGRATED_AMM_OBSERVED' : token.pair ? 'OTHER_DEX_ACTIVE' : 'PUMP_CURVE_COMPLETE') : 'PUMP_CURVE_ACTIVE';
        const isMigratedAmm = complete && token.migrated === true;
        const structuralFindings = !native ? [
            risk?.rugged === true && 'Provider reports rugged token — canonical proof required',
            risk?.safe === false && 'Provider safety finding (unsafe token) — canonical proof required',
            !!risk?.authorities.freeze && 'Freeze authority reported — Token Safety Authority proof required',
            risk?.holders.top10Status === 'over-limit' && 'Holder concentration finding — interval proof required',
        ].filter(Boolean) : [];
        const actorFindings = !native ? [
            risk?.bundling.state === 'flagged' || (signalFresh && signal.bundler) ? 'Bundler warning — actor proof required' : false,
            signalFresh && signal.devDump ? 'Developer disposition warning — actor proof required' : false,
        ].filter(Boolean) : [];
        const marketFindings = [
            input.feedStale && !isMigratedAmm && 'MARKET FEED STALE — CAPITAL LOCKED',
            token.crossValidationStatus === 'CONFLICTING' && 'Market sources conflict',
            !marketFresh && 'Token market observation stale or unknown',
        ].filter(Boolean);
        const liquidityLocked = (riskFresh && (risk.liquidity.state === 'locked' || risk.liquidity.state === 'burned' || risk.liquidity.state === 'bonding_curve')) || isMigratedAmm;
        const marketComplete = Number.isFinite(token.price) && token.price > 0 && Number.isFinite(token.liquidity) && token.liquidity > 0;
        const distributionComplete = riskFresh && (risk.holders.top10Status === 'within-limit' || (isMigratedAmm && risk.holders.top10Status !== 'over-limit')) && risk.bundling.state === 'clear';
        const prime = !native && marketComplete && distributionComplete && !structuralFindings.length && !actorFindings.length && !marketFindings.length && riskFresh && (risk.safe === true || (isMigratedAmm && risk.safe !== false)) && liquidityLocked && risk.authorities.status === 'revoked' && signalFresh && signal.highSignalIndex >= 80 && signal.pod === 'UP' && signal.confidence >= .8;
        const quarantined = !native && (structuralFindings.length > 0 || actorFindings.length > 0 || (marketFindings.length > 0 && !isMigratedAmm));
        // Discovery has only provider and market observations. It can restrict or
        // quarantine entry, but cannot label a token FAIL/VETO without a sealed
        // Token Safety Authority proof.
        const tier = native ? 'OBSERVED' : quarantined ? 'QUARANTINED' : prime ? 'PRIME' : 'DEVELOPING';
        const quality = native ? 'NOT_APPLICABLE' : 'UNKNOWN';
        const opportunity = prime ? 'ELIGIBLE' : 'PENDING';
        const vetoes = native
            ? (token.crossValidationStatus === 'CONFLICTING' ? ['Market sources conflict — native validation required'] : [])
            : [
                ...structuralFindings,
                ...actorFindings,
                ...(isMigratedAmm ? marketFindings.filter(f => f !== 'MARKET FEED STALE — CAPITAL LOCKED') : marketFindings),
            ];
        const pending = native ? [] : [!marketComplete && 'Price or liquidity depth unavailable', !riskFresh && 'Safety evidence unavailable', !signalFresh && 'Signal evidence unavailable', !liquidityLocked && 'Liquidity protection unverified'].filter(Boolean);
        const constraints = [
            ...marketFindings.map(reason => ({ scope: 'MARKET', effect: 'WAIT', reason })),
            ...structuralFindings.map(reason => ({ scope: 'TOKEN_STRUCTURAL', effect: 'QUARANTINE', reason })),
            ...actorFindings.map(reason => ({ scope: 'ACTOR', effect: 'QUARANTINE', reason })),
            { scope: 'EXECUTION', effect: 'BLOCK_NEW_ENTRY', reason: 'Discovery projection has no execution authority' },
        ];
        const outcome = { tokenSafety: 'UNKNOWN', venue: complete ? (token.pair ? 'READY' : 'UNKNOWN') : 'READY', strategy: prime ? 'READY' : 'NOT_READY', portfolio: 'LIMITED', execution: 'BLOCKED', system: input.feedStale ? 'DEGRADED' : 'HEALTHY', coverage: 'OBSERVATION_ONLY', action: structuralFindings.length || actorFindings.length ? 'QUARANTINE' : marketFindings.length || !riskFresh ? 'WAIT' : 'OBSERVE', constraints };
        const evidence = [
            { evidenceId: `${token.mint}:market`, type: 'Market observation', source: 'MarketHub', provenance: 'DexScreener / PumpPortal', state: marketFresh ? 'CURRENT' : 'STALE', observedAt: token.at || null, ageMs: token.at ? Math.max(0, now - token.at) : null, authority: 'OBSERVED' },
            { evidenceId: `${token.mint}:risk`, type: 'Security scan', source: native ? 'NATIVE_ASSET_POLICY' : 'Risk scanner', provenance: 'RugCheck / RPC', state: native ? 'NOT_APPLICABLE' : !risk ? 'UNAVAILABLE' : riskFresh ? 'CURRENT' : 'STALE', observedAt: risk?.at ?? null, ageMs: risk?.at ? Math.max(0, now - risk.at) : null, authority: 'DERIVED' },
            { evidenceId: `${token.mint}:signal`, type: 'Signal', source: signal?.source || 'UNAVAILABLE', provenance: 'ObservedMarketSignalAdapter', state: native ? 'NOT_APPLICABLE' : signalFresh ? 'CURRENT' : 'UNAVAILABLE', observedAt: signal?.at ?? null, ageMs: signal?.at ? Math.max(0, now - signal.at) : null, authority: 'DERIVED' },
        ];
        // Volume is not a transaction count. Never turn a rough estimate into an
        // observed fact in the operator trace.
        const observedTxs = token.txs ?? token.txCount ?? null;
        const isPaper = input.mode?.toLowerCase() === 'paper' || input.mode?.toLowerCase() === 'shadow';
        const canonicalState = token.crossValidationStatus === 'CONFLICTING' ? 'FAIL'
            : token.crossValidationStatus === 'VERIFIED' ? 'PASS'
                : (isPaper && (token.crossValidationStatus === 'SINGLE_SOURCE' || token.crossValidationStatus === 'PARTIALLY_VERIFIED' || marketFresh)) ? 'PASS'
                    : 'PENDING';
        const securityState = structuralFindings.length ? 'FAIL'
            : riskFresh && risk.safe === true && !risk.rugged && !risk.authorities.freeze ? 'PASS' : 'PENDING';
        const posCount = (input.positions || []).length;
        const atCapacity = posCount >= 3;
        const riskAuthStatus = !isPaper ? 'NOT_RUN' : input.feedStale ? 'BLOCKED' : atCapacity ? 'BLOCKED' : 'PASS';
        const riskAuthObserved = !isPaper ? 'LOCKED' : input.feedStale ? 'FEED_STALE' : atCapacity ? `AT_CAPACITY (${posCount}/3)` : `CAPACITY_OPEN (${posCount}/3)`;
        const riskAuthMeaning = !isPaper ? 'Read-only discovery mode' : input.feedStale ? 'Market feed stale — portfolio capital locked' : atCapacity ? 'Max 3 paper positions reached. Close an open position to free capacity.' : 'Paper risk envelope within limits; capacity and risk verified';
        const execStatus = !isPaper ? 'BLOCKED' : input.feedStale ? 'BLOCKED' : atCapacity ? 'BLOCKED' : prime ? 'PASS' : 'PENDING';
        const execObserved = !isPaper ? 'LOCKED' : input.feedStale ? 'FEED_STALE' : atCapacity ? 'CAPACITY_LOCKED' : prime ? 'SIMULATED_PERMIT' : 'MANUAL_PAPER_ONLY';
        const execMeaning = !isPaper ? (isMigratedAmm ? 'Live execution permits and certification are not connected to this discovery view.' : input.feedStale ? 'Market feed stale — capital locked' : 'Live execution permits and certification are not connected to this discovery view.')
            : input.feedStale ? 'Market feed stale — paper execution locked'
                : atCapacity ? 'Paper execution locked: maximum 3 positions active'
                    : prime ? 'Simulated paper execution permit authorized'
                        : 'Simulated paper execution available via manual ⚡ Paper Buy';
        const decisionTrace = [
            { stage: 'DISCOVERY', label: 'Discovery Stream', status: 'PASS', observed: token.pair || token.mint, requirement: 'Active feed', meaning: 'Token discovered on feed' },
            { stage: 'CANONICAL_STATE', label: 'Canonical State', status: canonicalState, observed: token.crossValidationStatus || (marketFresh ? 'SINGLE_SOURCE' : 'UNKNOWN'), requirement: isPaper ? 'Active market feed (DexScreener)' : 'Cross-provider verified', meaning: canonicalState === 'PASS' ? (isPaper && token.crossValidationStatus !== 'VERIFIED' ? 'Single source observed (DexScreener) — non-blocking for paper simulation' : 'Market state cross-validated') : canonicalState === 'FAIL' ? 'Market sources conflict' : isPaper ? 'Single source observed (DexScreener) — non-blocking for paper simulation' : 'Cross-provider validation incomplete' },
            { stage: 'FRESHNESS', label: 'Observation Freshness', status: marketFresh ? 'PASS' : 'FAIL', observed: token.at ? `${Math.max(0, now - token.at)}ms` : 'Unknown', requirement: `<= ${DISCOVERY_FRESH_MS}ms`, meaning: 'Observation fresh' },
            { stage: 'LIQUIDITY', label: 'Liquidity Depth', status: Number.isFinite(token.liquidity) && token.liquidity > 0 ? 'PASS' : 'PENDING', observed: Number.isFinite(token.liquidity) ? `$${Math.round(token.liquidity)}` : 'Awaiting', requirement: 'Depth > 0', meaning: 'Liquidity depth verified' },
            { stage: 'MARKET_CAP', label: 'Market Cap', status: Number.isFinite(token.cap) && token.cap > 0 ? 'PASS' : 'PENDING', observed: Number.isFinite(token.cap) ? `$${Math.round(token.cap)}` : 'Awaiting', requirement: 'Cap > 0', meaning: 'Market cap calculated' },
            { stage: 'TRANSACTIONS', label: 'Transactions', status: observedTxs != null ? (observedTxs >= 5 ? 'PASS' : 'PENDING') : 'PENDING', observed: observedTxs != null ? `${observedTxs} txs` : 'Awaiting trade count', requirement: 'Tx activity recorded', meaning: 'Observed trade flow' },
            { stage: 'RUG_SECURITY', label: 'Rug & Security', status: securityState, observed: riskFresh ? `Score: ${risk?.score ?? 0}/100, M:${risk?.authorities.mint ? 'ACT' : 'REV'} F:${risk?.authorities.freeze ? 'ACT' : 'REV'}` : 'Pending audit', requirement: 'Verified safe scan and revoked authorities', meaning: structuralFindings.length ? 'Provider findings restrict entry; canonical proof required' : securityState === 'PASS' ? 'Security scan reports safe; token-safety authority remains separate' : 'Security audit incomplete or inconclusive' },
            { stage: 'HSI_SIGNAL', label: 'HSI & Pod Signal', status: signalFresh && signal.highSignalIndex >= 80 ? 'PASS' : 'PENDING', observed: signalFresh ? `HSI: ${signal.highSignalIndex}, PoD: ${signal.pod}` : 'Awaiting', requirement: 'HSI >= 80, PoD UP', meaning: 'Signal evaluated' },
            { stage: 'CURVE_STATE', label: 'Curve Lifecycle', status: 'PASS', observed: venueState, requirement: 'Known curve or DEX', meaning: isMigratedAmm ? 'Graduated curve' : 'Active curve progression' },
            { stage: 'DEX_TRANSITION', label: 'DEX Transition', status: complete ? 'PASS' : 'PENDING', observed: token.pair ? 'Raydium pool identified' : complete ? 'Transitioning' : 'Pre-migration', requirement: 'Verified destination pool', meaning: 'DEX transition verified' },
            { stage: 'OPPORTUNITY', label: 'Opportunity Tier', status: prime ? 'PASS' : 'PENDING', observed: tier, requirement: 'PRIME qualification', meaning: prime ? 'Prime criteria satisfied' : !distributionComplete ? 'Holder distribution or bundling evidence incomplete' : (signalFresh && signal.highSignalIndex < 80) ? `Developing signal (HSI ${signal.highSignalIndex} < 80)` : 'Developing qualification' },
            { stage: 'RISK_AUTHORITY', label: 'Risk Authority', status: riskAuthStatus, observed: riskAuthObserved, requirement: isPaper ? 'Portfolio capacity < 3' : 'Portfolio risk envelope', meaning: riskAuthMeaning },
            { stage: 'EXECUTION', label: 'Execution Permit', status: execStatus, observed: execObserved, requirement: isPaper ? (prime ? 'Paper gateway ready' : 'PRIME qualification or manual ⚡ Buy') : 'Signed execution permit', meaning: execMeaning },
        ];
        return {
            ...token,
            isNativeAsset: native,
            venueState,
            tier,
            quality,
            opportunity,
            execution: 'BLOCKED',
            evidence,
            evidenceCoverage: { current: evidence.filter(e => e.state === 'CURRENT').length, total: evidence.length },
            highSignalIndex: signalFresh ? signal.highSignalIndex : null,
            hsi: signalFresh ? signal.highSignalIndex : null,
            pod: signalFresh ? signal.pod : 'UNKNOWN',
            confidence: signalFresh ? signal.confidence : null,
            safety: native ? 'NOT_APPLICABLE' : 'UNKNOWN',
            liquidityLocked: native ? null : liquidityLocked,
            mintRevoked: native ? null : riskFresh && risk.authorities.status === 'revoked',
            vetoes,
            pending,
            buyAllowed: false,
            refusalReason: constraints[0]?.reason || 'Execution authority unavailable',
            qualityVetoes: structuralFindings,
            executionBlockers: ['Discovery projection has no execution authority'],
            outcome,
            decision: {
                tokenId: token.mint,
                quality,
                opportunity,
                execution: 'BLOCKED',
                vetoReasons: vetoes,
                pendingReasons: pending,
                executionBlockers: ['Discovery projection has no execution authority'],
                trace: decisionTrace,
                summary: quarantined ? 'Observed findings restrict entry; discovery cannot assert token-safety failure.' : prime ? 'Prime criteria satisfied for observation only; token safety remains unknown until a sealed authority decision is supplied.' : !distributionComplete ? 'PENDING — Holder distribution or bundling evidence incomplete.' : 'Token safety remains unknown in the observation-only discovery view.',
                evidence: {
                    liquidityUsd: token.liquidity,
                    marketCapUsd: token.cap,
                    hsi: signalFresh ? signal.highSignalIndex : undefined,
                    curveState: venueState
                }
            },
            decisionTrace
        };
    }).sort((a, b) => ((a.tier === 'PRIME' ? 0 : a.tier === 'DEVELOPING' ? 1 : 2) - (b.tier === 'PRIME' ? 0 : b.tier === 'DEVELOPING' ? 1 : 2)) || (b.highSignalIndex ?? -1) - (a.highSignalIndex ?? -1) || a.mint.localeCompare(b.mint));
    return {
        schemaVersion: 2,
        at: now,
        mode: input.mode.toUpperCase(),
        executionAuthority: 'LOCKED',
        certification: 'UNVERIFIED',
        riskLocked: true,
        feedStale: input.feedStale,
        rows,
        positions: input.positions,
        freshnessGateMs: DISCOVERY_FRESH_MS,
        reconciliationStatus: 'UNKNOWN',
        systemStatus: {
            mode: input.mode.toUpperCase(),
            feedFreshness: input.feedStale ? 'STALE' : 'FRESH',
            executionAuthority: 'LOCKED',
            riskAuthority: 'LOCKED',
            dcveCertification: 'UNVERIFIED',
            executionLockReason: input.feedStale ? 'Market feed stale — capital locked.' : 'Discovery inspection mode — execution authority unavailable.'
        },
        alerts: [...(input.feedStale ? ['MARKET FEED STALE — CAPITAL LOCKED'] : []), 'Discovery is observation-only; no current token-safety authority is connected.'],
        capabilityNote: 'Discovery observations never constitute a current token veto or execution authorization.'
    };
}
//# sourceMappingURL=discovery.js.map