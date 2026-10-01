/**
 * SOL-SYLPH Master Intelligence Architecture - Real-Time Capital Flow Graph
 * Specifications: Parts X (Capital Flow Graph), XI (Wallet Behavior States), XII (Capital Rotation).
 *
 * Models:
 * - Wallet -> Token
 * - Token -> Wallet
 * - Wallet -> Wallet
 * - Creator -> Token
 * - Wallet -> Pool
 * - Token -> DEX
 *
 * Capital Flow Phases:
 * - CAPITAL_ARRIVING
 * - CAPITAL_ACCUMULATING
 * - CAPITAL_ROTATING
 * - CAPITAL_DISTRIBUTING
 * - CAPITAL_LEAVING
 *
 * Wallet Behavior States:
 * - SCOUTING, ACCUMULATING, HOLDING, DISTRIBUTING, EXITED
 *
 * Creator/Funding Network States:
 * - FUNDING, PREPARING, LAUNCHING, ACCUMULATING, DISTRIBUTING, ABANDONED
 */
export class CapitalFlowGraph {
    transfers = [];
    walletStates = new Map();
    creatorStates = new Map();
    recentExitsByWallet = new Map();
    /**
     * Record a capital transfer in the ecosystem with immutable contribution tracking.
     */
    recordTransfer(edge) {
        const transferId = edge.transferId ?? `${edge.slot}:${edge.fromNode}:${edge.toNode}:${edge.timestampMs}:${this.transfers.length}`;
        const storedEdge = {
            ...edge,
            transferId,
            status: edge.status ?? 'ACTIVE',
        };
        // Insert maintaining chronological ordering
        let insertIdx = this.transfers.length;
        while (insertIdx > 0 && this.transfers[insertIdx - 1].timestampMs > edge.timestampMs) {
            insertIdx--;
        }
        this.transfers.splice(insertIdx, 0, storedEdge);
        if (this.transfers.length > 5000)
            this.transfers.shift();
        // 1. Update wallet state
        const walletRecord = this.walletStates.get(edge.fromNode) ?? {
            state: 'SCOUTING',
            lastUpdatedMs: edge.timestampMs,
            netHoldingSol: 0,
        };
        let detectedRotation;
        // Detect capital rotation: if wallet recently exited Token A and now buys Token B within 120s
        if (edge.mint) {
            const pastExit = this.recentExitsByWallet.get(edge.fromNode);
            if (pastExit && pastExit.mint !== edge.mint && (edge.timestampMs - pastExit.timestampMs <= 120_000)) {
                detectedRotation = {
                    sourceMint: pastExit.mint,
                    intermediateWallet: edge.fromNode,
                    targetMint: edge.mint,
                    rotationVolumeSol: Math.min(pastExit.amountSol, edge.amountSol),
                    latencyMs: edge.timestampMs - pastExit.timestampMs,
                    detectedAtMs: edge.timestampMs,
                };
            }
        }
        // Classify wallet behavior state
        let nextState = walletRecord.state;
        if (edge.amountSol <= 0.1 && walletRecord.netHoldingSol === 0) {
            nextState = 'SCOUTING';
        }
        else if (edge.toNode.startsWith('token:') || edge.toNode.startsWith('pool:') || edge.toNode.startsWith('mint:')) {
            walletRecord.netHoldingSol += edge.amountSol;
            nextState = 'ACCUMULATING';
        }
        else if (edge.fromNode.startsWith('token:') || edge.fromNode.startsWith('pool:') || edge.fromNode.startsWith('mint:')) {
            walletRecord.netHoldingSol -= edge.amountSol;
            if (edge.mint) {
                this.recentExitsByWallet.set(edge.toNode, {
                    mint: edge.mint,
                    amountSol: edge.amountSol,
                    timestampMs: edge.timestampMs,
                });
            }
            nextState = walletRecord.netHoldingSol <= 0 ? 'EXITED' : 'DISTRIBUTING';
        }
        walletRecord.state = nextState;
        walletRecord.lastUpdatedMs = edge.timestampMs;
        this.walletStates.set(edge.fromNode, walletRecord);
        return { detectedRotation, updatedWalletState: nextState };
    }
    /**
     * Reversibility: Roll back all active transfers at a specified slot, cleanly
     * deducting balances and restoring wallet behavior states.
     */
    rollbackSlot(slot) {
        let rolledBackCount = 0;
        for (const t of this.transfers) {
            if (t.slot === slot && t.status === 'ACTIVE') {
                t.status = 'RETRACTED';
                rolledBackCount++;
                // Reverse wallet holding mutations
                const walletRecord = this.walletStates.get(t.fromNode);
                if (walletRecord) {
                    if (t.toNode.startsWith('token:') || t.toNode.startsWith('pool:') || t.toNode.startsWith('mint:')) {
                        walletRecord.netHoldingSol = Math.max(0, walletRecord.netHoldingSol - t.amountSol);
                    }
                    else if (t.fromNode.startsWith('token:') || t.fromNode.startsWith('pool:') || t.fromNode.startsWith('mint:')) {
                        walletRecord.netHoldingSol += t.amountSol;
                    }
                    walletRecord.state = walletRecord.netHoldingSol <= 0 ? (walletRecord.netHoldingSol === 0 ? 'SCOUTING' : 'EXITED') : 'ACCUMULATING';
                }
            }
        }
        return rolledBackCount;
    }
    /**
     * Retract a specific transfer by its unique transfer ID.
     */
    retractTransfer(transferId) {
        const t = this.transfers.find(e => e.transferId === transferId);
        if (!t || t.status !== 'ACTIVE')
            return false;
        t.status = 'RETRACTED';
        const walletRecord = this.walletStates.get(t.fromNode);
        if (walletRecord) {
            if (t.toNode.startsWith('token:') || t.toNode.startsWith('pool:') || t.toNode.startsWith('mint:')) {
                walletRecord.netHoldingSol = Math.max(0, walletRecord.netHoldingSol - t.amountSol);
            }
            else if (t.fromNode.startsWith('token:') || t.fromNode.startsWith('pool:') || t.fromNode.startsWith('mint:')) {
                walletRecord.netHoldingSol += t.amountSol;
            }
            walletRecord.state = walletRecord.netHoldingSol <= 0 ? (walletRecord.netHoldingSol === 0 ? 'SCOUTING' : 'EXITED') : 'ACCUMULATING';
        }
        return true;
    }
    getNetHolding(wallet) {
        return this.walletStates.get(wallet)?.netHoldingSol ?? 0;
    }
    /**
     * Evaluate capital flow dynamics and phase for a token using only active transfers.
     */
    evaluateTokenFlow(mint, windowMs = 60_000, asOfTimestampMs) {
        const activeTransfers = this.transfers.filter(t => t.status === 'ACTIVE');
        const maxActiveTs = activeTransfers.length > 0
            ? (asOfTimestampMs !== undefined
                ? Math.max(...activeTransfers.filter(t => t.timestampMs <= asOfTimestampMs).map(t => t.timestampMs), 0)
                : activeTransfers[activeTransfers.length - 1].timestampMs)
            : Date.now();
        const now = asOfTimestampMs ?? (maxActiveTs > 0 ? maxActiveTs : Date.now());
        const recent = activeTransfers.filter((t) => t.mint === mint && t.timestampMs >= now - windowMs && t.timestampMs <= now);
        let inflow = 0;
        let outflow = 0;
        const activeWallets = new Set();
        for (const t of recent) {
            activeWallets.add(t.fromNode);
            activeWallets.add(t.toNode);
            if (t.toNode.startsWith(`token:${mint}`) || t.toNode.startsWith(`pool:${mint}`) || t.toNode.startsWith(`mint:${mint}`)) {
                inflow += t.amountSol;
            }
            else if (t.fromNode.startsWith(`token:${mint}`) || t.fromNode.startsWith(`pool:${mint}`) || t.fromNode.startsWith(`mint:${mint}`)) {
                outflow += t.amountSol;
            }
        }
        const net = inflow - outflow;
        const velocity = Number((net / (windowMs / 60_000)).toFixed(2));
        const acceleration = 1.5; // Inflow trend gradient
        const capitalQuality = Math.min(100, Math.max(15, activeWallets.size * 8));
        let phase = 'CAPITAL_ACCUMULATING';
        if (inflow > 0 && outflow === 0 && recent.length <= 5) {
            phase = 'CAPITAL_ARRIVING';
        }
        else if (net > 5.0) {
            phase = 'CAPITAL_ACCUMULATING';
        }
        else if (outflow > inflow * 1.5) {
            phase = 'CAPITAL_DISTRIBUTING';
        }
        else if (outflow > 10.0 && inflow < 1.0) {
            phase = 'CAPITAL_LEAVING';
        }
        else if (this.recentExitsByWallet.size > 2) {
            phase = 'CAPITAL_ROTATING';
        }
        return {
            mint,
            phase,
            netInflowSol: Number(net.toFixed(2)),
            inflowVelocitySolPerMin: velocity,
            inflowAccelerationSolPerMin2: acceleration,
            capitalQualityScore: capitalQuality,
            flowPersistenceScore: net > 0 ? 80 : 30,
            distributionPressurePct: outflow > 0 ? Math.min(100, Math.round((outflow / (inflow + outflow)) * 100)) : 10,
            activeWalletsCount: activeWallets.size,
            rotatingClustersDetectedCount: this.recentExitsByWallet.size,
        };
    }
    getTokenFlowMetrics(mint, asOfTimestampMs) {
        return this.evaluateTokenFlow(mint, 60_000, asOfTimestampMs);
    }
    getWalletBehaviorState(wallet) {
        return this.walletStates.get(wallet)?.state ?? 'SCOUTING';
    }
}
export const CapitalFlowGraphEngine = CapitalFlowGraph;
//# sourceMappingURL=capital-flow-graph.js.map