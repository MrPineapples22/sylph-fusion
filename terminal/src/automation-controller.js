import { calculateVelocityBps } from './strategy-math.js';

// The React hook and regression tests use the same controller.
export function createAutomationController() {
  const pending = new Map(), cooldowns = new Map(), rejected = new Map();
  let lastEval = 0;
  return {
    evaluate(state, execution, solPriceUsd) {
      if (!state.running || state.executionMode !== 'external') return 'Paused — positions remain open';
      const now = state.now;
      if (now - lastEval < state.config.interval) return null;
      lastEval = now;
      for (const id of cooldowns.keys()) if (!state.assets.some(a => a.id === id)) cooldowns.delete(id);
      for (const id of rejected.keys()) if (!state.assets.some(a => a.id === id)) rejected.delete(id);
      const skip = (asset, code, reason) => {
        const previous = rejected.get(asset.id);
        if (previous?.code === code && now - previous.at < 30000) return;
        rejected.set(asset.id, {code, at:now});
        execution.recordCandidateRejection?.({asset:asset.id, symbol:asset.symbol || asset.name || asset.id,
          mint:asset.mint, code, reason, timestamp:now});
      };
      const launch = (asset, side, submit, cost = 0) => {
        pending.set(asset, { side, cost });
        Promise.resolve().then(submit).catch(() => {}).finally(() => pending.delete(asset));
      };
      const fresh = a => !state.liveMode || (Number.isFinite(a.observedAt) && now - a.observedAt <= 15000);
      for (const p of state.positions) {
        const a = state.assets.find(a => a.id === p.asset);
        if (!a || !fresh(a) || !(a.price > 0) || pending.has(p.asset) || execution.isPending?.(p.asset)) continue;
        if (a.price <= p.stop) {
          launch(p.asset, 'SELL', () => execution.panicCloseUsd(p.asset, a.mint || p.asset, p.qty, a.tokenDecimals ?? 9));
          continue;
        }
        const tier = [state.config.tp1, state.config.tp2, state.config.tp3].findIndex((tp, i) => !p.tiers.includes(i) && a.price >= p.entry * (1 + tp / 100));
        if (tier >= 0) {
          const qty = tier === 2 ? p.qty : Math.min(p.qty, p.initialQty * .25);
          launch(p.asset, 'SELL', () => execution.submitUsdOrder({ poolAddress: p.asset, tokenMint: a.mint || p.asset, side: 'SELL', tokenQty: qty, tokenDecimals: a.tokenDecimals ?? 9, tier, maxSlippageBps: state.config.slippage * 100 }));
        }
      }
      let waiting = 'Waiting for live pools';
      for (const a of state.assets) {
        const inFlight = [...pending.values()].filter(p => p.side === 'BUY');
        if (state.positions.some(p => p.asset === a.id) || pending.has(a.id) || execution.isPending?.(a.id)) continue;
        if (state.liveMode && !state.eligibleIds?.includes(a.id)) continue;
        if (state.positions.length + inFlight.length >= state.config.maxPositions) { waiting = 'Position limit reached'; skip(a,'POSITION_LIMIT',waiting); continue; }
        if (!fresh(a) || !(a.liquidity > 0)) { waiting = 'Waiting for fresh prices and pool liquidity'; skip(a,!fresh(a)?'STALE_PRICE':'MISSING_LIQUIDITY',!fresh(a)?'Price observation is older than 15 seconds':'Pool liquidity is missing or zero'); continue; }
        if (now - (cooldowns.get(a.id) ?? -Infinity) < 15000) continue;
        const history = a.history || [], latest = history.at(-1);
        const previous = history.slice(0, -1).reverse().find(p => p.time < latest?.time);
        if (!latest || !previous) { waiting = 'Collecting two price observations'; skip(a,'INSUFFICIENT_HISTORY',waiting); continue; }
        const velocity = calculateVelocityBps(latest.value, previous.value, (latest.time - previous.time) * 1000);
        if (velocity < -1000 || velocity > 3500) { waiting = 'Waiting for volatility to settle'; skip(a,'EXCESS_VOLATILITY',`Velocity ${(velocity/100).toFixed(2)}%/sec exceeds safety bounds (-10%/sec to +35%/sec)`); continue; }
        const breakout = velocity >= state.config.velocity * 100 && Number.isFinite(a.volume) && a.volume >= state.config.volume;
        const dip = [a.previousRsi, a.rsi, a.fast, a.slow].every(Number.isFinite) && a.previousRsi < state.config.rsi && a.rsi >= state.config.rsi && a.fast > a.slow;
        if (!(state.config.strategy === 'dip' ? dip : breakout)) {
          waiting = state.config.strategy === 'dip' ? 'Waiting for RSI recovery and bullish moving averages' :
            !Number.isFinite(a.volume) ? 'Waiting for provider volume data (5m and 1h)' :
            `${a.symbol || a.id}: ${(velocity/100).toFixed(2)}%/sec vs ${state.config.velocity}%/sec; volume ${a.volume.toFixed(2)}× vs ${state.config.volume}×`;
          const code = state.config.strategy === 'dip' ? 'DIP_NOT_READY' : !Number.isFinite(a.volume) ? 'MISSING_VOLUME' : velocity < state.config.velocity*100 ? 'LOW_VELOCITY' : 'LOW_VOLUME';
          skip(a,code,waiting);
          continue;
        }
        const cost = state.config.size * solPriceUsd + .01005 * solPriceUsd;
        if (!Number.isFinite(cost) || cost <= 0 || cost + [...pending.values()].reduce((n, p) => n + p.cost, 0) > state.cash) { waiting = 'Insufficient available paper cash'; skip(a,'INSUFFICIENT_CASH',waiting); continue; }
        rejected.delete(a.id);
        cooldowns.set(a.id, now);
        launch(a.id, 'BUY', () => execution.submitUsdOrder({ poolAddress: a.id, tokenMint: a.mint || a.id, side: 'BUY', usdAmount: state.config.size * solPriceUsd, tokenDecimals: a.tokenDecimals ?? 9, maxSlippageBps: state.config.slippage * 100 }), cost);
      }
      return pending.size ? `Confirming ${pending.size} paper order(s)…` : waiting;
    }
  };
}

