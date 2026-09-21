export const SLOT_DURATION_MS = 400;

export function assetToPoolState(asset, solPriceUsd, now = Date.now(), tokenDecimals = 9) {
  const solPrice = Number(solPriceUsd), assetPrice = Number(asset?.price);
  if (!Number.isFinite(solPrice) || solPrice <= 0 || !Number.isFinite(assetPrice) || assetPrice <= 0) return null;
  const decimals = Number.isInteger(tokenDecimals) && tokenDecimals >= 0 && tokenDecimals <= 18 ? tokenDecimals : 9;
  const liq = Number.isFinite(asset?.liquidity) && asset.liquidity > 0 ? asset.liquidity : 200_000;
  const half = liq / 2;
  return { timestamp: now, slot: Math.floor(now / SLOT_DURATION_MS),
    reserves: { sol: BigInt(Math.max(1, Math.round(half / solPrice * 1e9))), token: BigInt(Math.max(1, Math.round(half / assetPrice * 10 ** decimals))) },
    price: assetPrice / solPrice, volatility: Number.isFinite(asset?.sigma) ? asset.sigma : 0.05, migrated: Boolean(asset?.migrated) };
}

export function syncAssetsToEngine(engine, assets, solPriceUsd, now = Date.now()) {
  if (!engine || !Array.isArray(assets) || !assets.length || typeof engine.pushState !== 'function') return 0;
  const solPrice = solPriceUsd ?? assets[0]?.price ?? 150; let synced = 0;
  for (const asset of assets) {
    if (!(asset.liquidity > 0)) continue;
    const observedAt = Number.isFinite(asset.observedAt) ? asset.observedAt : now;
    if (now - observedAt > 15000) continue;
    const existing = engine.statesByPool?.get?.(asset.id);
    if ((!existing || existing.length === 0) && Array.isArray(asset.history) && asset.history.length >= 2) {
      const prevPoint = asset.history[asset.history.length - 2];
      const prevTime = Math.round(Number(prevPoint.time) * 1000);
      if (Number.isFinite(prevTime) && prevTime > 0 && prevTime < observedAt && Number(prevPoint.value) > 0) {
        const prevState = assetToPoolState({ ...asset, price: Number(prevPoint.value) }, solPrice, prevTime, asset.tokenDecimals ?? 9);
        if (prevState) engine.pushState(prevState, asset.id);
      }
    }
    const state = assetToPoolState(asset, solPrice, observedAt, asset.tokenDecimals ?? 9);
    if (!state) continue;
    engine.pushState(state, asset.id);
    synced++;
  }
  return synced;
}

export function evaluateDualSnapshotDrift(states, maxPriceDriftBps = 200, maxLiquidityDropBps = 200) {
  if (!Array.isArray(states) || states.length < 2) return null;
  const s1 = states[states.length - 2];
  const s2 = states[states.length - 1];
  if (!s1?.reserves?.sol || !s1?.reserves?.token || !s2?.reserves?.sol || !s2?.reserves?.token) return null;
  const r1 = Number(s1.reserves.sol), r2 = Number(s2.reserves.sol);
  const t1 = Number(s1.reserves.token), t2 = Number(s2.reserves.token);
  if (r1 <= 0 || r2 <= 0 || t1 <= 0 || t2 <= 0) return null;

  const p1 = r1 / t1;
  const p2 = r2 / t2;
  const priceDriftPct = p1 > 0 ? ((p2 - p1) / p1) * 100 : 0;
  const priceDriftBps = Math.round(priceDriftPct * 100);

  let liquidityDropBps = 0;
  if (r2 < r1) {
    liquidityDropBps = Math.round(((r1 - r2) / r1) * 10_000);
  }

  const direction = p2 > p1 ? 'up' : r2 < r1 ? 'down' : 'none';
  const driftBps = direction === 'up' ? priceDriftBps : direction === 'down' ? liquidityDropBps : 0;
  const isExcessivePriceDrift = priceDriftBps > maxPriceDriftBps;
  const isExcessiveLiquidityDrop = liquidityDropBps > maxLiquidityDropBps;
  const passed = !isExcessivePriceDrift && !isExcessiveLiquidityDrop;

  return {
    priceDriftPct,
    priceDriftBps,
    liquidityDropBps,
    driftBps,
    direction,
    passed,
    reason: isExcessivePriceDrift ? 'EXCESSIVE_PRICE_DRIFT' : isExcessiveLiquidityDrop ? 'EXCESSIVE_LIQUIDITY_DROP' : null,
    reconciledAtSlot: s2.slot,
  };
}

