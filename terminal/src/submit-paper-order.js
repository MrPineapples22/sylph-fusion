import { orderFromUsd, fillToTerminal, tokenQtyToBaseUnits } from './execution-bridge.js';

// Converts only confirmed execution amounts to ledger actions.
export async function submitPaperOrder(engine, dispatch, solPriceUsd, input) {
  const { poolAddress, tokenMint, side, usdAmount, tokenQty, tokenDecimals = 9, maxSlippageBps = 300, emergency = false, tier, fallbackPriceSol, allowLocalSimulationFallback = false } = input;
  const orderId = input.orderId || crypto.randomUUID();
  try {
    // 1. Authoritative Command Gateway submission (Sections 5, 43)
    if (typeof fetch === 'function') {
      try {
        const resp = await fetch('/api/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commandId: `cmd_${orderId}`,
            type: 'SUBMIT_ORDER',
            timestamp: Date.now(),
            initiator: 'ui_terminal',
            payload: {
              orderId,
              mint: tokenMint || poolAddress,
              poolAddress,
              side,
              usdAmount,
              tokenQty,
              tokenDecimals,
              maxSlippageBps,
              emergency,
              fallbackPriceSol,
            },
          }),
        });
        if (resp.ok) {
          const cmdRes = await resp.json();
          if (cmdRes.ok && cmdRes.result?.data?.report) {
            const report = cmdRes.result.data.report;
            const telemetry = cmdRes.result.data.telemetry || { priceImpactPct: 0, simulatedSlotLagMs: 200 };
            if (report.status === 'FILLED') {
              const fill = fillToTerminal({ report, solPriceUsd, tokenDecimals });
              dispatch({
                type: 'EXTERNAL_FILL',
                payload: {
                  orderId,
                  asset: poolAddress,
                  side,
                  qty: side === 'BUY' ? fill.outputTokens : Number(report.inputAmount) / 10 ** tokenDecimals,
                  price: fill.priceUsd,
                  totalUsd: side === 'BUY' ? fill.inputUsd : fill.outputUsd,
                  feeUsd: fill.feesUsd,
                  emergency,
                  tier,
                  priceImpactPct: telemetry.priceImpactPct,
                  latency: telemetry.simulatedSlotLagMs,
                },
              });
              return { report, telemetry };
            } else {
              const feeUsd = Number(report.priorityFeeLamports + report.jitoTipLamports) / 1e9 * solPriceUsd;
              dispatch({ type: 'REJECT', payload: { orderId, asset: poolAddress, side, feeUsd, reason: report.failureReason || report.status } });
              return { report, telemetry };
            }
          }
        }
        throw new Error('COMMAND_GATEWAY_UNAVAILABLE');
      } catch (error) {
        // A browser client must never silently create a second execution ledger.
        // Test harnesses can opt into the local simulator explicitly.
        if (!allowLocalSimulationFallback) {
          dispatch({ type: 'REJECT', payload: { orderId, asset: poolAddress, side, feeUsd: 0, reason: 'COMMAND_GATEWAY_UNAVAILABLE' } });
          return null;
        }
      }
    } else if (!allowLocalSimulationFallback) {
      dispatch({ type: 'REJECT', payload: { orderId, asset: poolAddress, side, feeUsd: 0, reason: 'COMMAND_GATEWAY_UNAVAILABLE' } });
      return null;
    }

    // 2. Explicit test-only local simulator fallback.
    const request = side === 'BUY'
      ? orderFromUsd({ orderId, tokenMint, poolAddress, side, usdAmount, solPriceUsd, tokenDecimals, maxSlippageBps, emergency })
      : { orderId, tokenMint, poolAddress, side: 'SELL', amountLamports: tokenQtyToBaseUnits(tokenQty, tokenDecimals), amountDecimals: tokenDecimals, maxSlippageBps, triggerTimestamp: Date.now(), emergency, fallbackPriceSol };
    const result = await engine.execute(request);
    const { report, telemetry } = result;
    if (report.status === 'FILLED') {
      const fill = fillToTerminal({ report, solPriceUsd, tokenDecimals });
      dispatch({ type: 'EXTERNAL_FILL', payload: { orderId, asset: poolAddress, side,
        qty: side === 'BUY' ? fill.outputTokens : Number(report.inputAmount) / 10 ** tokenDecimals,
        price: fill.priceUsd, totalUsd: side === 'BUY' ? fill.inputUsd : fill.outputUsd,
        feeUsd: fill.feesUsd, emergency, tier, priceImpactPct: telemetry.priceImpactPct, latency: telemetry.simulatedSlotLagMs } });
    } else {
      const feeUsd = Number(report.priorityFeeLamports + report.jitoTipLamports) / 1e9 * solPriceUsd;
      dispatch({ type: 'REJECT', payload: { orderId, asset: poolAddress, side, feeUsd, reason: report.failureReason || report.status } });
    }
    return result;
  } catch (error) {
    dispatch({ type: 'REJECT', payload: { orderId, asset: poolAddress, side, feeUsd: 0, reason: error.message || 'Execution unavailable' } });
    return null;
  }
}

