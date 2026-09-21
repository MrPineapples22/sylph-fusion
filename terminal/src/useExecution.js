import { useCallback, useRef, useState } from 'react';
import { executeOrderWithDispatch } from '../../src/terminal-execution.ts';
import { submitPaperOrder } from './submit-paper-order.js';
export function useExecution(engine, dispatch, solPriceUsd = 150, state) {
  const inFlight = useRef(new Map()), latest = useRef(state);
  latest.current = state;
  const [pendingAssets, setPendingAssets] = useState([]);
  const submitOrder = useCallback(order => executeOrderWithDispatch(engine, order, dispatch), [engine, dispatch]);
  const submitUsdOrder = useCallback(async input => {
    const id = input.poolAddress, snapshot = latest.current;
    if (inFlight.current.has(id)) return null;
    const reserve = input.side === 'BUY' ? input.usdAmount + .01005 * solPriceUsd : 0;
    if (snapshot && input.side === 'BUY') {
      const outstanding = [...inFlight.current.values()];
      const reserved = outstanding.reduce((n, o) => n + o.reserve, 0);
      const asset = snapshot.assets.find(a => a.id === id);
      const invalid = snapshot.positions.some(p => p.asset === id) ||
        snapshot.positions.length + outstanding.filter(o => o.side === 'BUY').length >= snapshot.config.maxPositions ||
        snapshot.cash < reserve + reserved || !(asset?.liquidity > 0) ||
        (snapshot.liveMode && (!snapshot.eligibleIds?.includes(id) || Date.now() - asset.observedAt > 15000));
      if (invalid) { dispatch({ type: 'REJECT', payload: { asset: id, side: 'BUY', reason: 'Entry requires fresh liquidity, available cash and a free position slot.' } }); return null; }
    }
    inFlight.current.set(id, { side: input.side, reserve });
    setPendingAssets([...inFlight.current.keys()]);
    try { return await submitPaperOrder(engine, dispatch, solPriceUsd, input); }
    finally { inFlight.current.delete(id); setPendingAssets([...inFlight.current.keys()]); }
  }, [engine, dispatch, solPriceUsd]);
  const panicCloseUsd = useCallback((poolAddress, tokenMint, tokenQty, tokenDecimals = 9) => {
    const snapshot = latest.current;
    const pos = snapshot?.positions?.find(p => p.asset === poolAddress);
    const asset = snapshot?.assets?.find(a => a.id === poolAddress);
    const priceUsd = Number.isFinite(asset?.price) && asset.price > 0 ? asset.price : (pos?.entry || 0.00001);
    const solPrice = Number.isFinite(solPriceUsd) && solPriceUsd > 0 ? solPriceUsd : 150;
    const fallbackPriceSol = priceUsd / solPrice;
    const qty = tokenQty || pos?.qty || 0;
    return submitUsdOrder({
      poolAddress,
      tokenMint: tokenMint || poolAddress,
      side: 'SELL',
      tokenQty: qty,
      tokenDecimals,
      maxSlippageBps: 10000,
      emergency: true,
      fallbackPriceSol,
    });
  }, [submitUsdOrder, solPriceUsd]);
  const isPending = useCallback(id => inFlight.current.has(id), []);
  const recordCandidateRejection = useCallback(payload => dispatch({type:'CANDIDATE_REJECTED',payload}),[dispatch]);
  return { submitOrder, submitUsdOrder, panicCloseUsd, pendingAssets, isPending, recordCandidateRejection };
}

