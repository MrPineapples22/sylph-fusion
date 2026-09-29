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
function simulatedNetworkFeeUsd(report, solPriceUsd) {
    const feeLamports = report.priorityFeeLamports + report.jitoTipLamports;
    return Number(feeLamports) / 1e9 * solPriceUsd;
}
export class CommandGateway {
    static instance = null;
    mode = 'paper';
    automationEnabled = false;
    entriesHalted = false;
    cashUsd = Number(process.env.SIMULATED_CAPITAL_USD) > 0 ? Number(process.env.SIMULATED_CAPITAL_USD) : 10_000.0;
    initialPaperCapitalUsd = this.cashUsd;
    solPriceUsd = 150.0;
    stateVersion = 1;
    paperRealizedPnlUsd = 0;
    paperClosedFillCount = 0;
    paperWinningFillCount = 0;
    paperLosingFillCount = 0;
    paperEntryEvidenceProvider = null;
    // This gateway owns paper state only. It never claims chain reconciliation.
    lastReconciledAt = 0;
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
    updateSolPriceUsd(price) {
        if (Number.isFinite(price) && price > 0) {
            this.solPriceUsd = price;
        }
    }
    setPaperEntryEvidenceProvider(provider) {
        this.paperEntryEvidenceProvider = provider;
    }
    async requireFreshEntryEvidence(mint, poolAddress) {
        return this.requireFreshMarketEvidence(mint, poolAddress, true);
    }
    async requireFreshMarketEvidence(mint, poolAddress, requireEntryAuthorization) {
        if (!this.paperEntryEvidenceProvider) {
            throw new Error('ENTRY_BLOCKED: No authoritative paper-entry evidence provider is connected.');
        }
        const evidence = await this.paperEntryEvidenceProvider(mint, poolAddress);
        const now = Date.now();
        if (!evidence || evidence.verified !== true || (requireEntryAuthorization && evidence.entryAllowed !== true) ||
            evidence.mint !== mint || evidence.poolAddress !== poolAddress ||
            !Number.isFinite(evidence.priceUsd) || evidence.priceUsd <= 0 ||
            !Number.isFinite(evidence.liquidityUsd) || evidence.liquidityUsd <= 0 ||
            !Number.isFinite(evidence.solPriceUsd) || evidence.solPriceUsd <= 0 ||
            !Number.isSafeInteger(evidence.observedAt) || evidence.observedAt > now || now - evidence.observedAt > 5_000 ||
            !Number.isSafeInteger(evidence.solObservedAt) || evidence.solObservedAt > now || now - evidence.solObservedAt > 5_000) {
            throw new Error(`${requireEntryAuthorization ? 'ENTRY_BLOCKED' : 'EXIT_BLOCKED'}: Fresh verified price, liquidity, and SOL/USD evidence are required${requireEntryAuthorization ? ' with basket authorization' : ''}.`);
        }
        this.updateSolPriceUsd(evidence.solPriceUsd);
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
            entriesHalted: this.entriesHalted,
            mode: this.mode,
            automationEnabled: this.automationEnabled,
            cashUsd: this.cashUsd,
            initialPaperCapitalUsd: this.initialPaperCapitalUsd,
            reservedCashUsd: [...this.pendingBuys.values()].reduce((sum, value) => sum + value, 0),
            solPriceUsd: this.solPriceUsd,
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
            if (!match || !Number.isSafeInteger(match.at) || match.at > now || now - match.at > globalConfigAuthority.getConfig().feedStaleMs)
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
                pos.lastMarkAt = now;
                if (!pos.peak || effectivePrice > pos.peak) {
                    pos.peak = effectivePrice;
                    pos.lastPeakAt = now;
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
        const now = Date.now();
        for (const [poolAddress, pos] of this.positions.entries()) {
            if (this.inFlight.has(poolAddress))
                continue;
            const match = tokens.find(t => t.mint === pos.mint || t.pair === pos.asset || t.mint === pos.asset);
            const matchAt = match?.at;
            const isMatchFresh = typeof matchAt === 'number' && Number.isSafeInteger(matchAt) && matchAt <= now && now - matchAt <= globalConfigAuthority.getConfig().feedStaleMs;
            let currentPrice = isMatchFresh && typeof match?.price === 'number' && match.price > 0
                ? match.price
                : isMatchFresh && typeof match?.priceUsd === 'number' && match.priceUsd > 0
                    ? match.priceUsd
                    : null;
            if ((currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0) && typeof pos.lastMark === 'number' && pos.lastMark > 0 && Number.isSafeInteger(pos.lastMarkAt) && pos.lastMarkAt <= now && now - pos.lastMarkAt <= globalConfigAuthority.getConfig().feedStaleMs) {
                currentPrice = pos.lastMark;
            }
            if (currentPrice === null || !Number.isFinite(currentPrice) || currentPrice <= 0)
                continue;
            // Anti-Phantom Price Spike Clamp for autonomous exits
            const positionAgeMs = now - (pos.openedAt || now);
            if (positionAgeMs < 3000 && currentPrice > pos.entry * 1.50) {
                currentPrice = pos.entry;
            }
            const markAt = isMatchFresh ? matchAt : pos.lastMarkAt;
            if (!Number.isSafeInteger(markAt) || markAt > now || now - markAt > globalConfigAuthority.getConfig().feedStaleMs)
                continue;
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
                    });
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
                    return this.handleEmergencyStop(command);
                case 'PANIC_CLOSE_ALL':
                    return await this.handlePanicCloseAll(command);
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
                stateVersion: this.stateVersion,
            };
        }
    }
    async handleSubmitOrder(cmd) {
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
        if (isBuy && this.entriesHalted) {
            throw new Error('ENTRY_BLOCKED: Paper emergency stop is latched.');
        }
        const entryEvidence = isBuy ? await this.requireFreshEntryEvidence(payload.mint, payload.poolAddress) : null;
        const exitEvidence = (!isBuy && this.paperEntryEvidenceProvider) ? await this.requireFreshMarketEvidence(payload.mint, payload.poolAddress, false) : null;
        // 1. Idempotency check (Section 27)
        if (this.executedIntentIds.has(orderId)) {
            throw new Error(`DUPLICATE_INTENT: Order ${orderId} has already been executed or is in flight.`);
        }
        // 2. Lifecycle & Entry Safety (Sections 10, 11)
        // This handler already rejects live mode above. Paper/shadow orders are
        // isolated simulator actions and must not inherit live certification gates.
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
        let effectiveUsdAmount = payload.usdAmount;
        if (isBuy) {
            if (this.positions.size + this.pendingBuys.size >= config.maxPositions) {
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
            if (!(maxAuthorizedUsd > 0))
                throw new Error('ENTRY_BLOCKED: Risk sizing returned no authorized position size.');
            effectiveUsdAmount = effectiveUsdAmount === undefined ? maxAuthorizedUsd : Math.min(effectiveUsdAmount, maxAuthorizedUsd);
            if (!(effectiveUsdAmount > 0))
                throw new Error('ENTRY_BLOCKED: Requested size is outside the authorized risk budget.');
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
                emergency: payload.emergency ?? false,
                fallbackPriceSol: payload.fallbackPriceSol,
            };
            // 6. Execute through the isolated simulator. No network delivery exists here.
            const result = await this.executionEngine.execute(request);
            const { report, telemetry } = result;
            let committed = false;
            try {
                // Cancellation can race a simulator completion. No paper entry may be
                // committed after the operator's stop, even if the adapter reports a fill.
                if (isBuy && this.entriesHalted) {
                    throw new Error('ENTRY_BLOCKED: Paper emergency stop occurred during execution.');
                }
                if (isBuy) {
                    const fillEvidence = await this.requireFreshEntryEvidence(payload.mint, payload.poolAddress);
                    if (this.entriesHalted) {
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
                        this.positions.set(payload.poolAddress, {
                            asset: payload.poolAddress,
                            mint: payload.mint,
                            symbol: payload.symbol,
                            qty: filledQty,
                            entry: execPriceUsd,
                            stop: execPriceUsd * (1 - config.stopBps / 10_000),
                            peak: execPriceUsd,
                            trough: execPriceUsd,
                            openedAt: Date.now(),
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
    async handleClosePosition(cmd) {
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
        });
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
        if (cmd.payload.enabled && (this.entriesHalted || !globalLifecycle.isEntryPermitted())) {
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
    handleEmergencyStop(cmd) {
        // The local stop must succeed even when the shared lifecycle is already
        // stopped or cannot transition (for example during shutdown).
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
        return {
            success: true,
            commandId: cmd.commandId,
            timestamp: Date.now(),
            data: {
                entriesHalted: this.entriesHalted,
                lifecycleState: globalLifecycle.getState(),
                automationEnabled: this.automationEnabled,
                reason: cmd.payload.reason,
            },
            stateVersion: this.stateVersion,
        };
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
        return {
            success: true,
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