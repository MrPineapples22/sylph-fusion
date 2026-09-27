/** Research simulation: modeled fills are not executable-liquidity evidence. */
export function evaluateTrial(ticks, p, options = {}) {
  const finite = Number.isFinite;
  if (!Array.isArray(ticks) || ticks.length < 2) throw new Error('At least two chronological frames required');
  if (!p || !finite(p.velocity) || p.velocity <= 0 || !finite(p.trailing) || p.trailing < 1 || p.trailing > 50 || !Number.isInteger(p.slippageBps) || p.slippageBps < 0 || p.slippageBps > 5000 || !Array.isArray(p.tp) || p.tp.length !== 3 || !p.tp.every(x => finite(x) && x > 0) || !(p.tp[0] < p.tp[1] && p.tp[1] < p.tp[2])) throw new Error('Invalid parameters');
  const { feeBps = 125, fixedFeeUsd = 0.01, initialCashUsd = 100, maxPositionPct = 10, maxDrawdownPct = 20 } = options;
  if (![feeBps, fixedFeeUsd, initialCashUsd, maxPositionPct, maxDrawdownPct].every(finite) || feeBps < 0 || feeBps >= 10000 || fixedFeeUsd < 0 || initialCashUsd <= 0 || maxPositionPct <= 0 || maxPositionPct > 100 || maxDrawdownPct <= 0 || maxDrawdownPct > 100) throw new Error('Invalid model options');
  let previous = -Infinity;
  const frames = ticks.map(frame => {
    if (!Number.isSafeInteger(frame.timestamp) || frame.timestamp <= previous || !Array.isArray(frame.assets)) throw new Error('Invalid chronological frame');
    previous = frame.timestamp;
    const assets = new Map();
    for (const a of frame.assets) {
      if (!a || typeof a.id !== 'string' || !a.id || assets.has(a.id) || !finite(a.price) || a.price <= 0 || !finite(a.velocity) || !finite(a.volume) || a.volume < 0) throw new Error('Invalid asset observation');
      assets.set(a.id, a);
    }
    return assets;
  });
  const slip = p.slippageBps / 10000, fee = feeBps / 10000, budget = initialCashUsd * maxPositionPct / 100;
  let cash = initialCashUsd, peak = initialCashUsd, maxDd = 0, wins = 0, trades = 0, totalFees = 0, entries = 0, missingLiquidations = 0, halted = false;
  const positions = new Map(), pending = new Map();
  const close = (id, price) => {
    const pos = positions.get(id), gross = pos.qty * price * (1 - slip);
    if (!finite(gross)) throw new Error('Numeric overflow in liquidation');
    const costs = price === 0 ? 0 : Math.min(gross, gross * fee + fixedFeeUsd), proceeds = gross - costs;
    cash += proceeds; totalFees += costs; trades++; if (proceeds > pos.spent) wins++;
    positions.delete(id);
  };
  const mark = assets => {
    let equity = cash;
    for (const [id, pos] of positions) {
      const price = assets.get(id)?.price ?? 0, gross = pos.qty * price * (1 - slip);
      equity += price === 0 ? 0 : Math.max(0, gross * (1 - fee) - fixedFeeUsd);
    }
    if (!finite(equity)) throw new Error('Numeric overflow in equity');
    peak = Math.max(peak, equity); maxDd = Math.max(maxDd, (peak - equity) / peak * 100);
    if (maxDd >= maxDrawdownPct) halted = true;
  };
  for (let index = 0; index < frames.length; index++) {
    const assets = frames[index];
    // A signal can fill only in a later frame for the identical asset.
    for (const [id, side] of [...pending].sort(([a], [b]) => a.localeCompare(b))) {
      const a = assets.get(id);
      if (!a) { if (side === 'buy') pending.delete(id); continue; }
      if (side === 'sell') close(id, a.price);
      else if (!halted && cash >= budget && !positions.has(id)) {
        const notional = (budget - fixedFeeUsd) / (1 + fee);
        if (notional > 0) {
          if (!finite(notional / (a.price * (1 + slip)))) throw new Error('Numeric overflow in quantity');
          positions.set(id, { qty: notional / (a.price * (1 + slip)), spent: budget, entry: a.price * (1 + slip), high: a.price });
          cash -= budget; totalFees += budget - notional; entries++;
        }
      }
      pending.delete(id);
    }
    mark(assets);
    if (index === frames.length - 1) break;
    for (const [id, a] of assets) {
      if (pending.has(id)) continue;
      const pos = positions.get(id);
      if (pos) {
        pos.high = Math.max(pos.high, a.price);
        if (halted || a.price <= pos.high * (1 - p.trailing / 100) || (a.price / pos.entry - 1) * 100 >= p.tp[0]) pending.set(id, 'sell');
      } else if (!halted && a.velocity >= p.velocity && a.volume >= 1) pending.set(id, 'buy');
    }
  }
  for (const id of [...positions.keys()]) {
    const price = frames.at(-1).get(id)?.price;
    if (price === undefined) missingLiquidations++;
    close(id, price ?? 0);
  }
  mark(frames.at(-1));
  return {
    netReturnPct: (cash / initialCashUsd - 1) * 100, netPnlUsd: cash - initialCashUsd, maxDrawdownPct: maxDd, closedTrades: trades, trades, entries, wins,
    winRate: trades ? wins / trades * 100 : 0, endingEquityUsd: cash, totalFeesUsd: totalFees,
    missingLiquidations, unfilledSignals: pending.size, halted, evidenceClass: 'MODELED', profitabilityProven: false,
    costModel: { feeBps, fixedFeeUsd, slippageBps: p.slippageBps },
    assumptions: { initialCashUsd, allocationUsd: budget, maxPositionPct, maxDrawdownPct, minimumExecutionLagFrames: 1, takeProfit: 'Full exit at first target; later targets unused', terminalInventory: 'Final-frame liquidation; missing assets assigned zero recovery', liquidity: 'Not verified; no partial fills or failed transactions modeled', halt: 'Stops entries and signals liquidation after marked drawdown threshold; cannot guarantee loss cap' },
  };
}
