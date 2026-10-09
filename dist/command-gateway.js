/**
 * SOL-SYLPH Authoritative Command Gateway
 * Specifications: Sections 5, 23, 26, 27, 28, 43, 44, 45.
 *
 * All consequential operator and automation actions MUST flow through this gateway.
 * Directly mutating positions or calling raw swaps from UI or models is strictly prohibited.
 */
import { globalConfigAuthority } from './config-authority.js';
import { globalLifecycle } from './lifecycle/system-lifecycle.js';
import { SimulatedEngine } from './execution-engine.js';
import { LeaderScheduleTracker } from './platform/execution/solaris/leader-schedule.js';
import { DynamicTipAndContentionOracle } from './platform/execution/solaris/tip-oracle.js';
import { BimodalExecutionRouter } from './platform/execution/solaris/bimodal-router.js';
import { PostGraduationAmmBridge } from './platform/execution/solaris/amm-bridge.js';
import { SpieEngine, KellyAllocator } from './intelligence/spie/index.js';
import { globalTradeLearningService } from './intelligence/attribution/trade-learning-service.js';
import { decideExit, protectiveStop } from './exit-policy.js';
import { PaperAuthorityPolicy } from './platform/paper/paper-authority-policy.js';
function simulatedNetworkFeeUsd(report, solPriceUsd) {
    const feeLamports = report.priorityFeeLamports + report.jitoTipLamports;
    return Number(feeLamports) / 1e9 * solPriceUsd;
}
export class CommandGateway {
    static instance = null;
    mode = 'paper';
    automationEnabled = false;
    entriesHalted = false;
    emergencyStop = null;
    emergencyStopPersistence = null;
    stopStorageTail = Promise.resolve();
    pendingStopClears = 0;
    stopEpoch = 0;
    panicClosesInProgress = 0;
    /** Startup wiring only; an attached store cannot be detached or replaced. */
    setEmergencyStopPersistence(persistence) {
        if (this.emergencyStopPersistence || this.stateVersion !== 1 || this.stopEpoch !== 0 || this.pendingStopClears !== 0) {
            throw new Error('EMERGENCY_STOP_PERSISTENCE_ALREADY_INITIALIZED');
        }
        if (!persistence || typeof persistence.save !== 'function' || typeof persistence.clearSync !== 'function') {
            throw new Error('EMERGENCY_STOP_PERSISTENCE_INVALID_ADAPTER');
        }
        this.emergencyStopPersistence = Object.freeze({
            save: persistence.save.bind(persistence),
            clearSync: persistence.clearSync.bind(persistence),
        });
    }
    entryHalted() {
        return this.entriesHalted || this.pendingStopClears > 0;
    }
    queueStopStorage(operation) {
        const result = this.stopStorageTail.then(operation);
        // A failed operation must not poison recovery attempts behind it.
        this.stopStorageTail = result.then(() => undefined, () => undefined);
        return result;
    }
    persistEmergencyStop() {
        const record = this.emergencyStop;
        return this.queueStopStorage(async () => {
            try {
                if (!this.emergencyStopPersistence)
                    throw new Error('NO_STORE');
                await this.emergencyStopPersistence.save(record);
            }
            catch {
                throw new Error(`EMERGENCY_STOP_PERSISTENCE_FAILED: ${this.emergencyStopPersistence ? 'Storage was not confirmed' : 'NO_STORE'}; entries remain halted.`);
            }
        });
    }
    cashUsd = Number(process.env.SIMULATED_CAPITAL_USD) > 0 ? Number(process.env.SIMULATED_CAPITAL_USD) : 10_000.0;
    initialPaperCapitalUsd = this.cashUsd;
    solPriceUsd = 150.0;
    solPriceUpdatedAtMs = null;
    stateVersion = 1;
    paperRealizedPnlUsd = 0;
    paperClosedFillCount = 0;
    paperWinningFillCount = 0;
    paperLosingFillCount = 0;
    paperEntryEvidenceProvider = null;
    paperPolicy = new PaperAuthorityPolicy('PAPER_STANDARD');
    // This gateway owns paper state only. It never claims chain reconciliation.
    lastReconciledAt = 0;
    setPaperPolicy(policy) {
        this.paperPolicy = policy;
    }
    getPaperPolicy() {
        return this.paperPolicy;
    }
    setCashUsd(amount) {
        if (Number.isFinite(amount) && amount >= 0) {
            this.cashUsd = amount;
            if (this.positions.size === 0 && this.pendingBuys.size === 0 && this.paperClosedFillCount === 0) {
                this.initialPaperCapitalUsd = amount;
            }
            this.stateVersion++;
        }
    }
    clearPositions() {
        this.positions.clear();
        this.pendingBuys.clear();
        this.inFlight.clear();
        this.stateVersion++;
    }
    updateSolPriceUsd(price, observedAtMs) {
        const now = Date.now();
        if (Number.isFinite(price) && price > 0 && Number.isSafeInteger(observedAtMs) &&
            observedAtMs <= now && now - observedAtMs <= 5_000) {
            this.solPriceUsd = price;
            this.solPriceUpdatedAtMs = observedAtMs;
        }
    }
    setPaperEntryEvidenceProvider(provider) {
        this.paperEntryEvidenceProvider = provider;
    }
    async requireFreshEntryEvidence(mint, poolAddress) {
        return this.requireFreshMarketEvidence(mint, poolAddress, true);
    }
    async requireFreshMarketEvidence(mint, poolAddress, requireEntryAuthorization, updateSolPrice = true) {
        if (!this.paperEntryEvidenceProvider) {
            throw new Error('ENTRY_BLOCKED: No authoritative paper-entry evidence provider is connected.');
        }
        const evidence = await this.paperEntryEvidenceProvider(mint, poolAddress);
        const now = Date.now();
        if (!evidence || evidence.marketObservationValid !== true || !evidence.source?.trim() ||
            (requireEntryAuthorization && evidence.entryAllowed !== true) ||
            evidence.mint !== mint || evidence.poolAddress !== poolAddress ||
            !Number.isFinite(evidence.priceUsd) || evidence.priceUsd <= 0 ||
            !Number.isFinite(evidence.liquidityUsd) || evidence.liquidityUsd <= 0 ||
            !Number.isFinite(evidence.solPriceUsd) || evidence.solPriceUsd <= 0 ||
            !Number.isSafeInteger(evidence.observedAt) || evidence.observedAt > now || now - evidence.observedAt > 5_000 ||
            !Number.isSafeInteger(evidence.solObservedAt) || evidence.solObservedAt > now || now - evidence.solObservedAt > 5_000) {
            throw new Error(`${requireEntryAuthorization ? 'ENTRY_BLOCKED' : 'EXIT_BLOCKED'}: Fresh, identity-matched market price, liquidity, and SOL/USD observations are required${requireEntryAuthorization ? ' with basket authorization' : ''}.`);
        }
        if (updateSolPrice)
            this.updateSolPriceUsd(evidence.solPriceUsd, evidence.solObservedAt);
        return evidence;
    }
    positions = new Map();
    inFlight = new Set();
    executedIntentIds = new Set();
    pendingBuys = new Map();
    executionEngine;
    leaderTracker;
    tipOracle;
    bimodalRouter;
    ammBridge;
    spie;
    kellyAllocator;
    constructor() {
        this.executionEngine = new SimulatedEngine(7, 100000n, 10000000n);
        this.leaderTracker = new LeaderScheduleTracker();
        this.tipOracle = new DynamicTipAndContentionOracle();
        this.bimodalRouter = new BimodalExecutionRouter(this.leaderTracker, this.tipOracle);
        this.ammBridge = new PostGraduationAmmBridge();
        this.spie = new SpieEngine();
        this.kellyAllocator = new KellyAllocator();
    }
    static getInstance() {
        if (!CommandGateway.instance) {
            CommandGateway.instance = new CommandGateway();
        }
        return CommandGateway.instance;
    }
    static resetInstance() {
        CommandGateway.instance = new CommandGateway();
        return CommandGateway.instance;
    }
    getSnapshot() {
        return {
            entriesHalted: this.entryHalted(),
            emergencyStop: this.emergencyStop,
            mode: this.mode,
            automationEnabled: this.automationEnabled,
            cashUsd: this.cashUsd,
            initialPaperCapitalUsd: this.initialPaperCapitalUsd,
            reservedCashUsd: [...this.pendingBuys.values()].reduce((sum, value) => sum + value, 0),
            solPriceUsd: this.solPriceUsd,
            solPriceUpdatedAtMs: this.solPriceUpdatedAtMs,
            positions: Array.from(this.positions.values(), position => ({ ...position })),
            inFlightOrdersCount: this.inFlight.size,
            stateVersion: this.stateVersion,
            operationalMode: globalLifecycle.getState(),
            lastReconciledAt: this.lastReconciledAt,
            paperPerformance: Object.freeze({
                realizedPnlUsd: Number(this.paperRealizedPnlUsd.toFixed(6)),
                closedFillCount: this.paperClosedFillCount,
                winningFillCount: this.paperWinningFillCount,
                losingFillCount: this.paperLosingFillCount,
            }),
        };
    }
    /** Restore a durable stop before the terminal accepts operator commands. Stops cannot be cleared here. */
    restoreEmergencyStop(record) {
        if (this.entriesHalted)
            return;
        this.stopEpoch++;
        this.emergencyStop = Object.freeze({ ...record });
        this.entriesHalted = true;
        this.automationEnabled = false;
        this.executionEngine.cancelAllBuys();
        this.stateVersion++;
        try {
            if (globalLifecycle.getState() !== 'REDUCE_ONLY') {
                globalLifecycle.transition('REDUCE_ONLY', `Restored emergency stop: ${record.reason}`, record.initiator);
            }
        }
        catch {
            // The independent paper-entry latch remains authoritative if lifecycle recovery is already in progress.
        }
    }
    planRoute(req) {
        return this.bimodalRouter.planRoute(req);
    }
    /**
     * Update high-water mark peak prices and calculate dynamic trailing stop floors.
     * Tracks pump peaks in real time so gains are locked in before price retraces.
     */
    updatePositionMarks(tokens) {
        if (!tokens || !Array.isArray(tokens))
            return;
        for (const pos of this.positions.values()) {
            const match = tokens.find(t => t.mint === pos.mint || t.pair === pos.asset || t.mint === pos.asset);
            const now = Date.now();
            if (!match || !Number.isSafeInteger(match.at) || match.at < 0 || match.at > now || now - match.at > globalConfigAuthority.getConfig().feedStaleMs)
                continue;
            if (Number.isSafeInteger(pos.lastMarkAt) && match.at < pos.lastMarkAt)
                continue;
            const price = typeof match?.price === 'number' && match.price > 0
                ? match.price
                : typeof match?.priceUsd === 'number' && match.priceUsd > 0
                    ? match.priceUsd
                    : null;
            if (price !== null && Number.isFinite(price) && price > 0) {
                // Anti-Phantom Price Spike Clamp: If age < 3s and price spikes > +50% without trade velocity, clamp to entry
                const positionAgeMs = now - (pos.openedAt || now);
                const effectivePrice = (positionAgeMs < 3000 && price > pos.entry * 1.50) ? pos.entry : price;
                pos.lastMark = effectivePrice;
                pos.lastMarkAt = match.at;
                if (!pos.peak || effectivePrice > pos.peak) {
                    pos.peak = effectivePrice;
                    pos.lastPeakAt = match.at;
                }
                if (!pos.lastPeakAt) {
                    pos.lastPeakAt = pos.openedAt || now;
                }
                if (!pos.trough || price < pos.trough) {
                    pos.trough = price;
                }
                // Display precisely the same floor the guardian will enforce.
                // Monotonic Profit Ratchet (Control 17 & 21): Stop can ONLY ratchet UPWARDS, never loosen downwards
                const computedStop = protectiveStop({ entry: pos.entry, peak: pos.peak, stopBps: globalConfigAuthority.getConfig().stopBps });
                if (computedStop !== null && Number.isFinite(computedStop) && computedStop > 0) {
                    pos.stop = typeof pos.stop === 'number' && pos.stop > 0 ? Math.max(pos.stop, computedStop) : computedStop;
                }
            }
        }
    }
    /**
     * Evaluates and executes autonomous exits:
     * 1. Trailing Stop Exit: Peak >= +4% and current price fell to dynamic stop floor (locks in profit)
     * 2. Hard Take-Profit Target: Gain >= +15%
     * 3. Hard Stop-Loss: Current price <= entry * 0.88 (-12%)
     * 4. Stagnation / Time-Decay Exit: Open > 2 min and flat (<2.5%), freeing capacity for active pumps
     */
    async tickAutonomousExits(tokens) {
        const exited = [];
        // REDUCE_ONLY stops entries, never protection for already-held paper positions.
        if (this.positions.size === 0)
            return exited;
        this.updatePositionMarks(tokens);
        for (const [poolAddress, pos] of this.positions.entries()) {
            if (this.inFlight.has(poolAddress))
                continue;
            // Mark updates retain the provider timestamp and reject older evidence.
            // Read the cached price and timestamp together, including on fallback.
            let currentPrice = pos.lastMark;
            let markAt = pos.lastMarkAt;
            if (typeof currentPrice !== 'number' || !Number.isFinite(currentPrice) || currentPrice <= 0)
                continue;
            // A previous position's awaited close may have consumed this mark's remaining lifetime.
            const refreshRequestedAt = Date.now();
            if (!Number.isSafeInteger(markAt) || markAt > refreshRequestedAt || refreshRequestedAt - markAt > globalConfigAuthority.getConfig().feedStaleMs) {
                if (this.paperEntryEvidenceProvider) {
                    try {
                        const fresh = await this.requireFreshMarketEvidence(pos.mint, poolAddress, false, false);
                        if (Number.isFinite(fresh.priceUsd) && fresh.priceUsd > 0) {
                            currentPrice = fresh.priceUsd;
                            markAt = fresh.observedAt;
                            pos.lastMark = fresh.priceUsd;
                            pos.lastMarkAt = fresh.observedAt;
                        }
                    }
                    catch { }
                }
            }
            // A quote can arrive while the evidence provider is awaited. Validate
            // and evaluate it against the post-fetch clock so it is not rejected as
            // future-dated relative to a timestamp captured before the request.
            const now = Date.now();
            if (!Number.isSafeInteger(markAt) || markAt > now || now - markAt > globalConfigAuthority.getConfig().feedStaleMs)
                continue;
            // Anti-Phantom Price Spike Clamp for autonomous exits
            const positionAgeMs = now - (pos.openedAt || now);
            if (positionAgeMs < 3000 && currentPrice > pos.entry * 1.50) {
                currentPrice = pos.entry;
            }
            const decision = decideExit({ entry: pos.entry, mark: currentPrice, peak: pos.peak, stage: pos.stage, openedAt: pos.openedAt, now, stopBps: globalConfigAuthority.getConfig().stopBps, markAt: markAt, maxMarkAgeMs: globalConfigAuthority.getConfig().feedStaleMs, lastPeakAt: pos.lastPeakAt ?? pos.openedAt, partialExitBps: 5_000 });
            if (decision) {
                try {
                    const res = await this.handleClosePosition({
                        commandId: `auto_exit_${now}_${Math.floor(Math.random() * 1000)}`,
                        type: 'CLOSE_POSITION',
                        timestamp: now,
                        initiator: 'autonomous_exit_guardian',
                        payload: {
                            mint: pos.mint,
                            poolAddress: pos.asset,
                            tokenQty: pos.qty * decision.fractionBps / 10_000,
                            emergency: decision.emergency,
                            priceUsd: currentPrice,
                            fallbackPriceSol: currentPrice / this.solPriceUsd,
                            exitTrigger: decision.emergency ? 'EMERGENCY_UNWIND' : decision.reason === 'STAGNATION' ? 'OPERATOR_CLOSE' : 'TRAILING_TARGET',
                        }
                    }, { reason: decision.reason, fractionBps: decision.fractionBps, emergency: decision.emergency, nextStage: decision.nextStage });
                    if (res.success) {
                        const active = this.positions.get(poolAddress);
                        if (active)
                            active.stage = Math.max(active.stage, decision.nextStage);
                        exited.push({ mint: pos.mint, action: decision.reason, reason: `${decision.reason} @ stop ${decision.protectiveStop.toFixed(8)}` });
                    }
                }
                catch {
                    // Non-blocking exit attempt
                }
            }
        }
        return exited;
    }
    getSolarisSnapshot(currentSlot = 250_000) {
        const leader = this.leaderTracker.getSlotLeader(currentSlot);
        const chunk = this.leaderTracker.calculateChunkInfo(currentSlot);
        const nextSlot = chunk.chunkEndSlot + 1;
        const nextLeader = this.leaderTracker.getSlotLeader(nextSlot);
        const tipFloor = this.tipOracle.getTipFloor();
        const contention = this.tipOracle.estimateContention([]);
        return {
            currentSlot,
            activeLeaderPubkey: leader?.leaderPubkey,
            activeLeaderIsJito: leader?.isJitoLeader,
            activeLeaderStakeBps: leader?.clusterStakeShareBps,
            remainingSlotsInChunk: chunk.remainingSlotsInChunk,
            nextLeaderPubkey: nextLeader?.leaderPubkey,
            nextLeaderIsJito: nextLeader?.isJitoLeader,
            leaderScheduleStatus: leader && nextLeader ? 'VERIFIED' : 'UNAVAILABLE',
            tipFloor: tipFloor.isFresh ? {
                p25: tipFloor.p25Lamports.toString(),
                p50: tipFloor.p50Lamports.toString(),
                p75: tipFloor.p75Lamports.toString(),
                p95: tipFloor.p95Lamports.toString(),
            } : undefined,
            contentionTier: contention.contentionTier,
            recommendedPriorityMicroLamports: contention.recommendedMicroLamportsPerCu.toString(),
            activeGraduationCount: this.ammBridge.getAllActiveGraduations().length,
            resolvedGapsCount: 0,
            timestampMs: Date.now(),
            // Direct delivery is deliberately unavailable from this paper-only gateway.
            helios: {
                directTransmissionsCount: 0,
                pipelinedTransmissionsCount: 0,
                fallbackTransmissionsCount: 0,
                avgTransmissionDurationMs: 0,
                activeTpuEndpointsCount: 0,
            },
        };
    }
    setSolPriceUsd(price) {
        if (Number.isFinite(price) && price > 0) {
            this.solPriceUsd = price;
        }
    }
    async executeCommand(command) {
        const now = Date.now();
        try {
            switch (command.type) {
                case 'SUBMIT_ORDER':
                    return await this.handleSubmitOrder(command);
                case 'CLOSE_POSITION':
                    return await this.handleClosePosition(command);
                case 'CHANGE_MODE':
                    return this.handleChangeMode(command);
                case 'SET_AUTOMATION':
                    return this.handleSetAutomation(command);
                case 'EMERGENCY_STOP':
                    return await this.handleEmergencyStop(command);
                case 'CLEAR_EMERGENCY_STOP':
                    return await this.handleClearEmergencyStop(command);
                case 'PANIC_CLOSE_ALL':
                    this.panicClosesInProgress++;
                    try {
                        return await this.handlePanicCloseAll(command);
                    }
                    finally {
                        this.panicClosesInProgress--;
                    }
                case 'SET_PAPER_CAPITAL':
                    return this.handleSetPaperCapital(command);
                default:
                    return {
                        success: false,
                        commandId: command.commandId || 'unknown',
                        timestamp: now,
                        error: `Unsupported command type: ${command.type}`,
                        stateVersion: this.stateVersion,
                    };
            }
        }
        catch (err) {
            return {
                success: false,
                commandId: command.commandId,
                timestamp: now,
                error: err.message || 'Internal command execution failure',
                ...(String(err.message).startsWith('EMERGENCY_STOP_PERSISTENCE_FAILED') ? { emergencyStopPersistence: 'PERSISTENCE_FAILED' } : {}),
                ...(String(err.message).startsWith('EMERGENCY_STOP_CLEAR_FAILED') ? { emergencyStopPersistence: 'CLEAR_FAILED' } : {}),
                ...(String(err.message).startsWith('EMERGENCY_STOP_CLEAR_SUPERSEDED') ? { emergencyStopPersistence: 'CLEAR_SUPERSEDED' } : {}),
                stateVersion: this.stateVersion,
            };
        }
    }
    async handleSubmitOrder(cmd, autonomousExit) {
        const { payload } = cmd;
        if (this.mode !== 'paper' && this.mode !== 'shadow') {
            throw new Error('LIVE_UNAVAILABLE: Terminal command gateway is paper-only.');
        }
        // A transport retry must resolve to the same economic intent even when the caller omits orderId.
        const orderId = payload.orderId || cmd.commandId;
        if (!orderId || typeof orderId !== 'string' || !payload.mint || !payload.poolAddress || !['BUY', 'SELL'].includes(payload.side)) {
            throw new Error('INVALID_ORDER: Identity, mint, pool and side are required.');
        }
        if (payload.usdAmount !== undefined && (!Number.isFinite(payload.usdAmount) || payload.usdAmount <= 0) ||
            payload.tokenQty !== undefined && (!Number.isFinite(payload.tokenQty) || payload.tokenQty <= 0) ||
            payload.tokenDecimals !== undefined && (!Number.isInteger(payload.tokenDecimals) || payload.tokenDecimals < 0 || payload.tokenDecimals > 18)) {
            throw new Error('INVALID_ORDER: Amounts must be positive and decimals valid.');
        }
        const isBuy = payload.side === 'BUY';
        if (isBuy && !globalLifecycle.isEntryPermitted()) {
            throw new Error(`ENTRY_BLOCKED: Paper/shadow entries require lifecycle permission (${globalLifecycle.getState()}).`);
        }
        const entryStopEpoch = this.stopEpoch;
        if (isBuy && (this.entryHalted() || entryStopEpoch !== this.stopEpoch)) {
            throw new Error('ENTRY_BLOCKED: Paper emergency stop is latched.');
        }
        const entryEvidence = isBuy ? await this.requireFreshEntryEvidence(payload.mint, payload.poolAddress) : null;
        const exitEvidence = (!isBuy && this.paperEntryEvidenceProvider) ? await this.requireFreshMarketEvidence(payload.mint, payload.poolAddress, false, !autonomousExit) : null;
        if (isBuy && (this.entryHalted() || entryStopEpoch !== this.stopEpoch)) {
            throw new Error('ENTRY_BLOCKED: Emergency stop changed during entry authorization.');
        }
        // 1. Idempotency check (Section 27)
        if (this.executedIntentIds.has(orderId)) {
            throw new Error(`DUPLICATE_INTENT: Order ${orderId} has already been executed or is in flight.`);
        }
        // 2. Entry lifecycle safety (Sections 10, 11). Live authority remains
        // unavailable; simulated BUYs still require explicit lifecycle permission.
        // 3. Concurrency / In-flight fence (Section 44)
        if (this.inFlight.has(payload.poolAddress)) {
            throw new Error(`IN_FLIGHT_CONFLICT: Asset ${payload.poolAddress} already has an active order in flight.`);
        }
        const existingPosition = this.positions.get(payload.poolAddress);
        if (isBuy && existingPosition)
            throw new Error('POSITION_EXISTS: An entry cannot overwrite existing exposure.');
        if (!isBuy && (!existingPosition || existingPosition.mint !== payload.mint))
            throw new Error('POSITION_NOT_FOUND: Sell must reference the recorded mint and pool.');
        if (!isBuy && payload.tokenQty !== undefined && payload.tokenQty > existingPosition.qty)
            throw new Error('INVALID_QUANTITY: Sell exceeds recorded position.');
        if (!isBuy && payload.tokenDecimals !== undefined && payload.tokenDecimals !== (existingPosition.tokenDecimals ?? 9))
            throw new Error('INVALID_DECIMALS: Sell must use recorded token decimals.');
        const tokenDecimals = isBuy ? payload.tokenDecimals ?? 9 : existingPosition.tokenDecimals ?? 9;
        // 4. Capacity & Cash validation
        const config = globalConfigAuthority.getConfig();
        let effectiveEmergency = payload.emergency ?? false;
        if (autonomousExit) {
            const position = existingPosition;
            const decisionNow = Math.max(cmd.timestamp || 0, exitEvidence?.observedAt || 0, Date.now());
            const decisionAgeOffset = (autonomousExit.reason === 'FALSE_BREAKOUT' && cmd.timestamp && (cmd.timestamp - position.openedAt) <= 45_000)
                ? decisionNow - cmd.timestamp
                : 0;
            const refreshedDecision = exitEvidence && decideExit({
                entry: position.entry, mark: exitEvidence.priceUsd, peak: position.peak,
                stage: position.stage, openedAt: position.openedAt + decisionAgeOffset, now: decisionNow,
                stopBps: config.stopBps, markAt: exitEvidence.observedAt, maxMarkAgeMs: config.feedStaleMs,
                lastPeakAt: position.lastPeakAt ?? position.openedAt, partialExitBps: 5_000,
            });
            const isFullExit = (r) => ['STOP_LOSS', 'FALSE_BREAKOUT', 'DEV_DUMP_BAILOUT', 'LIQUIDITY_SHOCK', 'ADVERSE_FLOW_TOXICITY', 'STAGNATION', 'TRAILING_PROFIT', 'MOMENTUM_EXHAUSTION'].includes(r);
            const isBothFullExit = isFullExit(autonomousExit.reason) && isFullExit(refreshedDecision?.reason || '') &&
                autonomousExit.fractionBps === 10_000 && refreshedDecision?.fractionBps === 10_000;
            const compatibleReason = refreshedDecision && (refreshedDecision.reason === autonomousExit.reason ||
                isBothFullExit);
            const emergencyCompatible = refreshedDecision && (refreshedDecision.emergency === autonomousExit.emergency ||
                (isBothFullExit && refreshedDecision.emergency === true));
            if (!refreshedDecision || !compatibleReason || !emergencyCompatible ||
                refreshedDecision.fractionBps !== autonomousExit.fractionBps ||
                refreshedDecision.nextStage !== autonomousExit.nextStage ||
                payload.tokenQty !== position.qty * refreshedDecision.fractionBps / 10_000) {
                // The guardian evaluates each position once per tick, so this emits at most one skip per position/tick.
                console.warn('[CommandGateway] Autonomous exit skipped', {
                    reasonCode: 'AUTONOMOUS_EXIT_DECISION_CHANGED',
                    mint: position.mint, poolAddress: position.asset,
                    requestedReason: autonomousExit.reason, refreshedReason: refreshedDecision?.reason ?? null,
                });
                throw new Error('EXIT_BLOCKED: Fresh verified evidence changed the autonomous exit decision.');
            }
            if (refreshedDecision.emergency)
                effectiveEmergency = true;
            this.updateSolPriceUsd(exitEvidence.solPriceUsd, exitEvidence.solObservedAt);
        }
        let effectiveUsdAmount = payload.usdAmount;
        if (isBuy) {
            const posCapRule = this.paperPolicy.evaluateRule({
                rule: 'MAX_POSITIONS_LIMIT',
                check: () => ({
                    allowed: this.positions.size + this.pendingBuys.size < config.maxPositions,
                    reason: `Cannot open more than ${config.maxPositions} positions.`,
                }),
                mint: payload.mint,
            });
            if (!posCapRule.paperAllowed) {
                throw new Error(`MAX_POSITIONS_REACHED: Cannot open more than ${config.maxPositions} positions.`);
            }
            const reservedUsd = [...this.pendingBuys.values()].reduce((sum, value) => sum + value, 0);
            const markedHoldingsUsd = [...this.positions.values()].reduce((sum, position) => {
                const markIsFresh = Number.isFinite(position.lastMarkAt) && Date.now() - (position.lastMarkAt || 0) <= 45_000;
                const conservativeMark = markIsFresh && Number.isFinite(position.lastMark) && (position.lastMark || 0) > 0
                    ? Math.min(position.costBasisUsd, (position.lastMark || 0) * position.qty)
                    : Math.min(position.costBasisUsd, position.stop * position.qty);
                return sum + Math.max(0, conservativeMark);
            }, 0);
            const equityUsd = this.cashUsd + markedHoldingsUsd;
            const maxSpeculativeRiskUsd = equityUsd * config.maxSpeculativeRiskBps / 10_000;
            const stopRate = config.stopBps / 10_000;
            const reservedStopRiskUsd = [...this.positions.values()].reduce((sum, position) => sum + Math.max(0, position.costBasisUsd - position.stop * position.qty), 0);
            const incrementalRiskUsd = Math.max(0, maxSpeculativeRiskUsd - reservedStopRiskUsd);
            const riskSizedCapUsd = stopRate > 0 ? incrementalRiskUsd / stopRate : 0;
            const maxAuthorizedUsd = Math.min(riskSizedCapUsd, this.cashUsd - reservedUsd);
            const riskCapRule = this.paperPolicy.evaluateRule({
                rule: 'MAX_SPECULATIVE_RISK_LIMIT',
                check: () => ({
                    allowed: maxAuthorizedUsd > 0,
                    reason: 'Risk sizing returned no authorized position size.',
                }),
                mint: payload.mint,
            });
            if (this.paperPolicy.isMaxRisk()) {
                const availableCash = Math.max(0, this.cashUsd - reservedUsd);
                effectiveUsdAmount = payload.usdAmount !== undefined ? Math.min(payload.usdAmount, availableCash) : availableCash;
            }
            else {
                if (!riskCapRule.paperAllowed)
                    throw new Error('ENTRY_BLOCKED: Risk sizing returned no authorized position size.');
                effectiveUsdAmount = effectiveUsdAmount === undefined ? maxAuthorizedUsd : Math.min(effectiveUsdAmount, maxAuthorizedUsd);
                if (!(effectiveUsdAmount > 0))
                    throw new Error('ENTRY_BLOCKED: Requested size is outside the authorized risk budget.');
            }
            const requiredUsd = effectiveUsdAmount;
            if (this.cashUsd - reservedUsd < requiredUsd) {
                throw new Error(`INSUFFICIENT_CASH: Available ${this.cashUsd.toFixed(2)} USD < required ${requiredUsd.toFixed(2)} USD.`);
            }
        }
        this.inFlight.add(payload.poolAddress);
        this.executedIntentIds.add(orderId);
        if (isBuy)
            this.pendingBuys.set(payload.poolAddress, effectiveUsdAmount);
        try {
            // 5. Paper execution request construction. This boundary deliberately does
            // not mint live permits, signatures, slots, or chain-reconciliation claims.
            const amountLamports = isBuy
                ? BigInt(Math.round(((effectiveUsdAmount) / this.solPriceUsd) * 1e9))
                : BigInt(Math.round((payload.tokenQty ?? existingPosition.qty) * 10 ** tokenDecimals));
            // Ensure fresh pool state exists in executionEngine calibrated to actual token market price
            const candidatePriceUsd = entryEvidence?.priceUsd ?? exitEvidence?.priceUsd;
            if (candidatePriceUsd && candidatePriceUsd > 0) {
                const tokenPriceSol = candidatePriceUsd / this.solPriceUsd;
                // Use the verified provider-reported pool liquidity to seed the paper
                // AMM. Liquidity is total USD TVL, so a balanced pool has half on SOL.
                // This remains a paper depth estimate, not an executable quote.
                const poolSol = ((entryEvidence ?? exitEvidence).liquidityUsd / 2) / this.solPriceUsd;
                const poolSolLamports = BigInt(Math.floor(poolSol * 1e9));
                if (poolSolLamports <= 0n)
                    throw new Error('ENTRY_BLOCKED: Verified pool depth is not positive.');
                const totalTokens = poolSol / tokenPriceSol;
                const poolTokenUnits = BigInt(Math.max(1, Math.round(totalTokens * (10 ** tokenDecimals))));
                this.executionEngine.pushState({
                    timestamp: Date.now() + 1000,
                    slot: 250000,
                    reserves: { sol: poolSolLamports, token: poolTokenUnits },
                    price: tokenPriceSol,
                    volatility: 0.05,
                }, payload.poolAddress);
            }
            else {
                if (isBuy)
                    throw new Error('ENTRY_BLOCKED: Verified market price is unavailable.');
                throw new Error('EXIT_BLOCKED: Verified market price is unavailable.');
            }
            const request = {
                orderId,
                tokenMint: payload.mint,
                poolAddress: payload.poolAddress,
                side: payload.side,
                amountLamports,
                amountDecimals: tokenDecimals,
                maxSlippageBps: payload.maxSlippageBps ?? config.slippageBps,
                triggerTimestamp: Date.now(),
                emergency: effectiveEmergency,
                fallbackPriceSol: payload.fallbackPriceSol,
            };
            // 6. Execute through the isolated simulator. No network delivery exists here.
            const result = await this.executionEngine.execute(request);
            const { report, telemetry } = result;
            let committed = false;
            try {
                // Cancellation can race a simulator completion. No paper entry may be
                // committed after the operator's stop, even if the adapter reports a fill.
                if (isBuy && (this.entryHalted() || entryStopEpoch !== this.stopEpoch)) {
                    throw new Error('ENTRY_BLOCKED: Paper emergency stop occurred during execution.');
                }
                if (isBuy) {
                    const fillEvidence = await this.requireFreshEntryEvidence(payload.mint, payload.poolAddress);
                    if (this.entryHalted() || entryStopEpoch !== this.stopEpoch) {
                        throw new Error('ENTRY_BLOCKED: Paper emergency stop occurred during fill authorization.');
                    }
                    const driftBps = Math.abs(fillEvidence.priceUsd / entryEvidence.priceUsd - 1) * 10_000;
                    if (driftBps > (payload.maxSlippageBps ?? config.slippageBps)) {
                        throw new Error('ENTRY_BLOCKED: Verified market price moved beyond the authorized slippage bound.');
                    }
                }
                // 7. Authoritative paper-state mutation (ONLY within backend gateway)
                if (report.status === 'FILLED') {
                    if (isBuy) {
                        const filledQty = Number(report.outputAmount) / 10 ** tokenDecimals;
                        const costUsd = effectiveUsdAmount;
                        const networkFeeUsd = simulatedNetworkFeeUsd(report, this.solPriceUsd);
                        const execPriceUsd = candidatePriceUsd && filledQty > 0
                            ? (costUsd / filledQty)
                            : (report.execPrice || 0.00001) * this.solPriceUsd;
                        const openedAt = Date.now();
                        const processEvidenceRef = `evidence:paper_entry_${payload.mint}_${openedAt}`;
                        this.positions.set(payload.poolAddress, {
                            asset: payload.poolAddress,
                            mint: payload.mint,
                            symbol: payload.symbol,
                            qty: filledQty,
                            entry: execPriceUsd,
                            stop: execPriceUsd * (1 - config.stopBps / 10_000),
                            peak: execPriceUsd,
                            trough: execPriceUsd,
                            openedAt,
                            processEvidenceRef,
                            // Network costs are paid in addition to the swap input and must
                            // be recovered before this lot can be profitable.
                            costBasisUsd: costUsd + networkFeeUsd,
                            stage: 0,
                            reconciliationState: 'SIMULATED',
                            tokenDecimals,
                        });
                        this.cashUsd -= costUsd + networkFeeUsd;
                    }
                    else {
                        // SELL / Exit
                        const pos = this.positions.get(payload.poolAddress);
                        const proceedSol = Number(report.outputAmount) / 1e9;
                        const grossProceedUsd = proceedSol * this.solPriceUsd;
                        const networkFeeUsd = simulatedNetworkFeeUsd(report, this.solPriceUsd);
                        const proceedUsd = grossProceedUsd - networkFeeUsd;
                        if (pos) {
                            const soldQty = Number(report.inputAmount) / 10 ** tokenDecimals;
                            const remaining = Math.max(0, pos.qty - soldQty);
                            const closedFraction = pos.qty > 0 ? Math.min(1, soldQty / pos.qty) : 1;
                            const basisCostClosedUsd = pos.costBasisUsd * closedFraction;
                            let realizedPnlUsd = proceedUsd - basisCostClosedUsd;
                            let realizedPnlPct = basisCostClosedUsd > 0 ? (realizedPnlUsd / basisCostClosedUsd) * 100 : 0;
                            this.paperRealizedPnlUsd += realizedPnlUsd;
                            this.paperClosedFillCount++;
                            if (realizedPnlUsd > 0)
                                this.paperWinningFillCount++;
                            else
                                this.paperLosingFillCount++;
                            const holdDurationMs = Math.max(0, Date.now() - (pos.openedAt || Date.now()));
                            const exitTrigger = payload.exitTrigger
                                || (payload.emergency
                                    ? 'EMERGENCY_UNWIND'
                                    : (cmd.initiator === 'auto_exit_guardian' || cmd.initiator === 'autonomous_exit_guardian'
                                        ? 'TRAILING_TARGET'
                                        : 'OPERATOR_CLOSE'));
                            // A paper fill is still an accounting fact. Never rewrite its
                            // proceeds to force a profit floor or loss ceiling: that would
                            // contaminate cash, P&L, and learning data derived from it.
                            // Execution assumptions belong in the fill model before a report
                            // is produced, never in settlement accounting afterwards.
                            const exitPriceUsd = soldQty > 0 ? grossProceedUsd / soldQty : pos.entry;
                            // Pavlov Attribution: record closed trade and update decision credit & adaptive hurdles
                            try {
                                const processEvidenceRef = pos.processEvidenceRef || `evidence:paper_entry_${pos.mint}_${pos.openedAt || Date.now()}`;
                                globalTradeLearningService.recordClosedTrade({
                                    tokenMint: pos.mint,
                                    symbol: pos.symbol || (pos.asset ? pos.asset.slice(0, 8) : 'UNKNOWN'),
                                    entryPriceUsd: pos.entry,
                                    exitPriceUsd,
                                    costBasisUsd: basisCostClosedUsd,
                                    proceedsUsd: proceedUsd,
                                    realizedPnlUsd,
                                    realizedPnlPct,
                                    holdDurationMs,
                                    exitTrigger,
                                    wasDecisionSound: true,
                                    processEvidenceRef,
                                    decisionSoundnessReason: 'SOUND_DECISION_PROCESS',
                                    mfePriceUsd: pos.peak,
                                    maePriceUsd: pos.trough,
                                });
                            }
                            catch {
                                // Learning recording is non-blocking to execution
                            }
                            if (remaining <= 1 / 10 ** tokenDecimals)
                                this.positions.delete(payload.poolAddress);
                            else {
                                pos.costBasisUsd *= remaining / pos.qty;
                                pos.qty = remaining;
                            }
                        }
                        this.cashUsd += proceedUsd;
                    }
                    this.stateVersion++;
                }
                committed = true;
                return {
                    success: report.status === 'FILLED',
                    commandId: cmd.commandId,
                    timestamp: Date.now(),
                    data: {
                        orderId,
                        report,
                        telemetry,
                        executionMode: 'PAPER',
                    },
                    error: report.status !== 'FILLED' ? report.failureReason || 'Order rejected by execution engine' : undefined,
                    stateVersion: this.stateVersion,
                };
            }
            finally {
                // A fill can be rejected by the final authorization check. Roll back
                // the simulator's speculative reserve overlay before releasing the pool.
                if (isBuy && !committed)
                    this.executionEngine.clearOverlay(payload.poolAddress);
            }
        }
        finally {
            this.inFlight.delete(payload.poolAddress);
            this.pendingBuys.delete(payload.poolAddress);
        }
    }
    async handleClosePosition(cmd, autonomousExit) {
        const { payload } = cmd;
        const pos = this.positions.get(payload.poolAddress);
        if (!pos) {
            throw new Error(`POSITION_NOT_FOUND: No active position found for asset ${payload.poolAddress}.`);
        }
        return await this.handleSubmitOrder({
            commandId: cmd.commandId,
            type: 'SUBMIT_ORDER',
            timestamp: cmd.timestamp,
            initiator: cmd.initiator,
            payload: {
                mint: payload.mint || pos.mint,
                poolAddress: payload.poolAddress,
                symbol: pos.symbol,
                side: 'SELL',
                tokenQty: payload.tokenQty || pos.qty,
                tokenDecimals: pos.tokenDecimals,
                emergency: payload.emergency ?? true,
                maxSlippageBps: 10_000, // 100% emergency slippage ceiling for close
                priceUsd: payload.priceUsd,
                fallbackPriceSol: payload.fallbackPriceSol || (payload.priceUsd ? payload.priceUsd / this.solPriceUsd : pos.entry / this.solPriceUsd),
                exitTrigger: payload.exitTrigger,
            },
        }, autonomousExit);
    }
    handleChangeMode(cmd) {
        if (cmd.payload.mode !== 'paper' && cmd.payload.mode !== 'shadow') {
            throw new Error('LIVE_UNAVAILABLE: This gateway is backed by a simulator, not a live signer.');
        }
        if (this.inFlight.size > 0) {
            throw new Error(`MODE_CHANGE_LOCKED: Cannot change mode while ${this.inFlight.size} orders are in flight.`);
        }
        const previousMode = this.mode;
        this.mode = cmd.payload.mode;
        this.stateVersion++;
        return {
            success: true,
            commandId: cmd.commandId,
            timestamp: Date.now(),
            data: { previousMode, currentMode: this.mode },
            stateVersion: this.stateVersion,
        };
    }
    handleSetAutomation(cmd) {
        if (typeof cmd.payload.enabled !== 'boolean') {
            throw new Error('INVALID_AUTOMATION: enabled must be a boolean.');
        }
        if (cmd.payload.enabled && (this.entryHalted() || !globalLifecycle.isEntryPermitted())) {
            throw new Error('ENTRY_BLOCKED: Automation requires entry readiness and a clear emergency stop.');
        }
        // Automation here controls only the simulator; live mode is rejected by the gateway.
        this.automationEnabled = cmd.payload.enabled;
        this.stateVersion++;
        return {
            success: true,
            commandId: cmd.commandId,
            timestamp: Date.now(),
            data: { automationEnabled: this.automationEnabled },
            stateVersion: this.stateVersion,
        };
    }
    async handleEmergencyStop(cmd) {
        // The local stop must succeed even when the shared lifecycle is already
        // stopped or cannot transition (for example during shutdown).
        this.stopEpoch++;
        if (!this.emergencyStop) {
            this.emergencyStop = Object.freeze({
                commandId: cmd.commandId,
                initiator: cmd.initiator || 'unknown',
                triggeredAt: Date.now(),
                triggerType: 'OPERATOR_STOP',
                reason: typeof cmd.payload?.reason === 'string' && cmd.payload.reason.trim()
                    ? cmd.payload.reason.trim().slice(0, 500)
                    : 'No stop reason was supplied.',
            });
        }
        this.entriesHalted = true;
        this.automationEnabled = false;
        this.executionEngine.cancelAllBuys();
        this.stateVersion++;
        try {
            if (globalLifecycle.getState() !== 'REDUCE_ONLY') {
                globalLifecycle.transition('REDUCE_ONLY', `Emergency Stop: ${cmd.payload.reason}`);
            }
        }
        catch { /* The independently latched paper stop remains authoritative. */ }
        await this.persistEmergencyStop();
        return {
            ...(this.emergencyStopPersistence ? { emergencyStopPersistence: 'PERSISTED' } : {}),
            success: true,
            commandId: cmd.commandId,
            timestamp: Date.now(),
            data: {
                entriesHalted: this.entryHalted(),
                lifecycleState: globalLifecycle.getState(),
                automationEnabled: this.automationEnabled,
                reason: cmd.payload.reason,
            },
            stateVersion: this.stateVersion,
        };
    }
    async handleClearEmergencyStop(cmd) {
        if (cmd.payload?.confirmClear !== true) {
            throw new Error('CONFIRMATION_REQUIRED: confirmClear must be true to clear emergency stop.');
        }
        if (this.panicClosesInProgress > 0) {
            throw new Error('EMERGENCY_STOP_CLEAR_SUPERSEDED: Panic reductions are still in progress.');
        }
        if (!this.emergencyStopPersistence) {
            throw new Error('EMERGENCY_STOP_CLEAR_FAILED: NO_STORE; entries remain halted.');
        }
        const expectedEpoch = this.stopEpoch;
        const expectedRecord = this.emergencyStop;
        this.pendingStopClears++;
        try {
            return await this.queueStopStorage(async () => {
                if (expectedEpoch !== this.stopEpoch) {
                    throw new Error('EMERGENCY_STOP_CLEAR_SUPERSEDED: A newer stop requires a new clear command.');
                }
                // A duplicate clear for the same epoch is idempotent. It must not
                // issue a second deletion or invent an unrecorded latch on failure.
                if (this.emergencyStop !== null || this.entriesHalted) {
                    if (!expectedRecord || this.emergencyStop !== expectedRecord) {
                        throw new Error('EMERGENCY_STOP_CLEAR_SUPERSEDED: The stop identity changed.');
                    }
                    try {
                        // No await from identity revalidation through disk commit and
                        // memory release: a new JS stop cannot enter a deletion window.
                        this.emergencyStopPersistence.clearSync(expectedRecord);
                    }
                    catch {
                        throw new Error('EMERGENCY_STOP_CLEAR_FAILED: Entries remain halted; stop deletion was not confirmed.');
                    }
                }
                this.entriesHalted = false;
                this.emergencyStop = null;
                this.stateVersion++;
                try {
                    if (globalLifecycle.getState() === 'REDUCE_ONLY') {
                        globalLifecycle.transition('HEALTHY', `Emergency Stop Cleared: ${cmd.payload.reason || 'Operator cleared stop'}`);
                    }
                }
                catch { /* The independent paper-entry latch owns admission. */ }
                return {
                    success: true,
                    commandId: cmd.commandId,
                    timestamp: Date.now(),
                    ...(this.emergencyStopPersistence ? { emergencyStopPersistence: 'CLEARED' } : {}),
                    data: {
                        entriesHalted: false,
                        lifecycleState: globalLifecycle.getState(),
                        automationEnabled: this.automationEnabled,
                        reason: cmd.payload.reason,
                    },
                    stateVersion: this.stateVersion,
                };
            });
        }
        finally {
            this.pendingStopClears--;
        }
    }
    handleSetPaperCapital(cmd) {
        const { capitalUsd, resetPositions } = cmd.payload;
        if (!Number.isFinite(capitalUsd) || capitalUsd < 0) {
            throw new Error('INVALID_CAPITAL: capitalUsd must be a non-negative number.');
        }
        this.cashUsd = capitalUsd;
        if (resetPositions) {
            this.positions.clear();
            this.pendingBuys.clear();
            this.inFlight.clear();
            this.paperRealizedPnlUsd = 0;
            this.paperClosedFillCount = 0;
            this.paperWinningFillCount = 0;
            this.paperLosingFillCount = 0;
            this.initialPaperCapitalUsd = capitalUsd;
        }
        this.stateVersion++;
        return {
            success: true,
            commandId: cmd.commandId,
            timestamp: Date.now(),
            data: {
                cashUsd: this.cashUsd,
                positionsCount: this.positions.size,
            },
            stateVersion: this.stateVersion,
        };
    }
    /**
     * PANIC_CLOSE_ALL: Global Emergency Liquidation Handler (Upgrade 75).
     * Freezes all new buys, cancels open/in-flight orders, and submits parallel
     * emergency sell orders for 100% of all held positions.
     */
    async handlePanicCloseAll(cmd) {
        this.stopEpoch++;
        if (!this.emergencyStop) {
            this.emergencyStop = Object.freeze({
                commandId: cmd.commandId,
                initiator: cmd.initiator || 'unknown',
                triggeredAt: Date.now(),
                triggerType: 'PANIC_CLOSE_ALL',
                reason: typeof cmd.payload?.reason === 'string' && cmd.payload.reason.trim()
                    ? cmd.payload.reason.trim().slice(0, 500)
                    : 'Operator requested panic close all.',
            });
        }
        this.entriesHalted = true;
        this.automationEnabled = false;
        this.pendingBuys.clear();
        this.executionEngine.cancelAllBuys();
        this.stateVersion++;
        try {
            if (globalLifecycle.getState() !== 'REDUCE_ONLY') {
                globalLifecycle.transition('REDUCE_ONLY', 'Panic Close All: ' + (cmd.payload?.reason || 'Operator panic requested'));
            }
        }
        catch { /* Independently latched paper stop remains authoritative */ }
        // Begin saving before reductions; failed storage must not prevent exits.
        const persistence = this.persistEmergencyStop().then(() => null, error => error);
        const closedResults = [];
        const openPositions = [...this.positions.values()];
        for (const pos of openPositions) {
            try {
                const closeCmd = {
                    commandId: 'panic_' + pos.mint + '_' + Date.now(),
                    type: 'CLOSE_POSITION',
                    timestamp: Date.now(),
                    initiator: cmd.initiator || 'emergency_panic_handler',
                    payload: {
                        mint: pos.mint,
                        poolAddress: pos.asset,
                        tokenQty: pos.qty,
                        emergency: true,
                        fallbackPriceSol: (pos.lastMark || pos.entry) / this.solPriceUsd,
                        priceUsd: pos.lastMark || pos.entry,
                        exitTrigger: 'EMERGENCY_UNWIND',
                    },
                };
                const res = await this.handleClosePosition(closeCmd);
                closedResults.push({ mint: pos.mint, poolAddress: pos.asset, success: res.success, error: res.error });
            }
            catch (err) {
                closedResults.push({ mint: pos.mint, poolAddress: pos.asset, success: false, error: err.message });
            }
        }
        const persistenceError = await persistence;
        return {
            success: persistenceError === null,
            ...(persistenceError ? { error: persistenceError.message, emergencyStopPersistence: 'PERSISTENCE_FAILED' }
                : this.emergencyStopPersistence ? { emergencyStopPersistence: 'PERSISTED' } : {}),
            commandId: cmd.commandId,
            timestamp: Date.now(),
            data: {
                totalPositionsTargeted: openPositions.length,
                closedCount: closedResults.filter(r => r.success).length,
                results: closedResults,
                entriesHalted: true,
            },
            stateVersion: this.stateVersion,
        };
    }
    getLearningSnapshot() {
        return globalTradeLearningService.getSnapshot();
    }
}
export const globalCommandGateway = CommandGateway.getInstance();
//# sourceMappingURL=command-gateway.js.map