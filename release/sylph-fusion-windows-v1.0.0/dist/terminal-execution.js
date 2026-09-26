export async function executeOrderWithDispatch(engine, order, dispatch) {
    try {
        const result = await engine.execute(order);
        if (result.report.status === 'FILLED')
            dispatch({ type: 'EXECUTION_FILLED', report: result.report, telemetry: result.telemetry, side: order.side, order });
        else
            dispatch({ type: 'EXECUTION_REJECTED', report: result.report, order });
        return result;
    }
    catch {
        const report = { orderId: order.orderId, status: 'EXPIRED', execPrice: 0, inputAmount: order.amountLamports, outputAmount: 0n, priorityFeeLamports: 0n, jitoTipLamports: 0n, slotLatency: 0, failureReason: 'STALE_STATE' };
        dispatch({ type: 'EXECUTION_REJECTED', report, order });
        return { report, telemetry: { engineMode: 'PAPER', simulatedSlotLagMs: 0, priceImpactPct: 0, preTradeReserves: { sol: 0n, token: 0n }, postTradeReserves: { sol: 0n, token: 0n } } };
    }
}
//# sourceMappingURL=terminal-execution.js.map