export function handleExecutionFilled(state, action) { const { report, telemetry, order } = action; const pool = order.poolAddress; const positions = { ...(state.positions || {}) }; const overlays = { ...(state.activeOverlays || {}) }; let balance = BigInt(state.balanceLamports ?? 0n); const existing = positions[pool]; if (order.side === 'BUY') {
    balance -= report.inputAmount + report.priorityFeeLamports + report.jitoTipLamports;
    positions[pool] = { poolAddress: pool, tokenMint: order.tokenMint, entryPrice: report.execPrice, totalTokens: report.outputAmount, remainingTokens: report.outputAmount, realizedPnlLamports: 0n, unrealizedPnlLamports: 0n, ladderStep: 0, openedAt: Date.now() };
}
else {
    const net = report.outputAmount - report.priorityFeeLamports - report.jitoTipLamports;
    balance += net;
    if (existing) {
        const costBasis = BigInt(Math.round(Number(report.inputAmount) * existing.entryPrice));
        existing.realizedPnlLamports = (existing.realizedPnlLamports || 0n) + (net - costBasis);
        const remaining = existing.remainingTokens - report.inputAmount;
        if (remaining <= 0n || order.emergency) {
            delete positions[pool];
            delete overlays[pool];
        }
        else
            positions[pool] = { ...existing, remainingTokens: remaining, ladderStep: existing.ladderStep + 1 };
    }
} if (!order.emergency && positions[pool])
    overlays[pool] = { sol: telemetry.postTradeReserves.sol, token: telemetry.postTradeReserves.token, slot: Date.now() }; return { ...state, balanceLamports: balance, positions, activeOverlays: overlays, tape: [{ orderId: report.orderId, timestamp: Date.now(), poolAddress: pool, side: order.side, status: report.status, price: report.execPrice, amount: report.inputAmount, latencySlots: report.slotLatency, impactPct: telemetry.priceImpactPct, emergency: !!order.emergency }, ...(state.tape || []).slice(0, 49)] }; }
export function handleExecutionRejected(state, action) { const { report, order } = action; return { ...state, balanceLamports: BigInt(state.balanceLamports ?? 0n) - report.priorityFeeLamports, tape: [{ orderId: report.orderId, timestamp: Date.now(), poolAddress: order.poolAddress, side: order.side, status: report.status, price: 0, amount: report.inputAmount, latencySlots: report.slotLatency, impactPct: 0, emergency: !!order.emergency, failureReason: report.failureReason }, ...(state.tape || []).slice(0, 49)] }; }
//# sourceMappingURL=terminal-reducer-handlers.js.map