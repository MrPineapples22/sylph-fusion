const MAX_HISTORY = 8;
const HISTORY_TTL_MS = 60_000;

/** Collects only values directly present in the live market/risk adapters. */
export function createJevMarketFeatureContextBuilder(featureDefinitions) {
  const history = new Map();

  const observation = (name, value, source, evidenceId, group, observedAt, availableAt, confidence = 0.65) => {
    const spec = featureDefinitions[name];
    if (!spec || !Number.isFinite(value) || !Number.isSafeInteger(observedAt) || observedAt <= 0 ||
        !Number.isSafeInteger(availableAt) || availableAt < observedAt) return null;
    return { name, value, source, evidenceId, correlationGroup: group, observedAt, availableAt,
      unit: spec.unit, windowMs: spec.windowMs, confidence, conflict: false };
  };

  return function capture(mint, token, risk, tradeEvidence = null, providerHealth = null, network = null, now = Date.now()) {
    if (!token || token.mint !== mint || !Number.isSafeInteger(token.at) || token.at <= 0 || token.at > now || now - token.at > 5_000) return [];
    let samples = history.get(mint) || [];
    if (!samples.some(sample => sample.at === token.at)) {
      samples = [...samples, { at: token.at, price: token.price, liquidity: token.liquidity }]
        .filter(sample => now - sample.at <= HISTORY_TTL_MS).slice(-MAX_HISTORY);
      history.set(mint, samples);
    }
    while (history.size > 500) history.delete(history.keys().next().value);

    const out = [];
    const evidence = (feature, at = token.at) => `dexscreener:${token.pair || mint}:${at}:${feature}`;
    const add = (item) => { if (item) out.push(item); };

    add(observation('liquidity', token.liquidity, 'DEXSCREENER_API', evidence('liquidity'), 'DEXSCREENER_CLOUD', token.at, now,
      Number.isFinite(token.confidenceScore) ? Math.max(0, Math.min(1, token.confidenceScore)) : 0.6));
    add(observation('market_cap', token.cap, 'DEXSCREENER_API', evidence('market_cap'), 'DEXSCREENER_CLOUD', token.at, now, 0.55));
    const dexHealth = providerHealth?.providers?.DEXSCREENER_API;
    if (dexHealth?.configured === true && Number.isSafeInteger(dexHealth.totalRequestsCount) && dexHealth.totalRequestsCount > 0 &&
        Number.isSafeInteger(dexHealth.lastAttempt) && dexHealth.lastAttempt > 0 && dexHealth.lastAttempt <= now && now - dexHealth.lastAttempt <= 60_000 &&
        Number.isFinite(dexHealth.errorRatePct) && dexHealth.errorRatePct >= 0 && dexHealth.errorRatePct <= 100) {
      add(observation('provider_error_rate', dexHealth.errorRatePct / 100, 'DEXSCREENER_API', `provider-health:DEXSCREENER_API:${dexHealth.lastAttempt}`, 'DEXSCREENER_HEALTH_WINDOW', dexHealth.lastAttempt, now, 0.65));
    }
    if (Number.isFinite(token.buys5m) && Number.isFinite(token.sells5m) && token.sells5m > 0) {
      add(observation('buy_sell_ratio', token.buys5m / token.sells5m, 'DEXSCREENER_API', evidence('buy_sell_ratio'), 'DEXSCREENER_CLOUD', token.at, now, 0.55));
    }

    const recent = samples.filter(sample => sample.at <= token.at && token.at - sample.at <= 10_000);
    if (recent.length >= 2) {
      const first = recent[0], last = recent[recent.length - 1], seconds = (last.at - first.at) / 1000;
      if (seconds >= 1 && Number.isFinite(first.price) && first.price > 0 && Number.isFinite(last.price) && last.price > 0) {
        const velocity = (last.price / first.price - 1) / seconds;
        add(observation('price_velocity', velocity, 'DEXSCREENER_API', evidence('price_velocity', last.at), 'DEXSCREENER_CLOUD', last.at, now, 0.55));
        if (recent.length >= 3) {
          const mid = recent[Math.floor(recent.length / 2)];
          const leftSeconds = (mid.at - first.at) / 1000, rightSeconds = (last.at - mid.at) / 1000;
          if (leftSeconds >= 1 && rightSeconds >= 1 && first.price > 0 && mid.price > 0 && last.price > 0) {
            const leftVelocity = (mid.price / first.price - 1) / leftSeconds;
            const rightVelocity = (last.price / mid.price - 1) / rightSeconds;
            const acceleration = (rightVelocity - leftVelocity) / ((leftSeconds + rightSeconds) / 2);
            add(observation('price_acceleration', acceleration, 'DEXSCREENER_API', evidence('price_acceleration', last.at), 'DEXSCREENER_CLOUD', last.at, now, 0.5));
          }
        }
      }
      if (seconds >= 1 && Number.isFinite(first.liquidity) && first.liquidity > 0 && Number.isFinite(last.liquidity) && last.liquidity > 0) {
        add(observation('liquidity_velocity', (last.liquidity / first.liquidity - 1) / seconds, 'DEXSCREENER_API', evidence('liquidity_velocity', last.at), 'DEXSCREENER_CLOUD', last.at, now, 0.5));
      }
    }

    const volSamples = samples.filter(sample => sample.at <= token.at && token.at - sample.at <= 30_000 && Number.isFinite(sample.price) && sample.price > 0);
    if (volSamples.length >= 4) {
      const returns = volSamples.slice(1).map((sample, index) => {
        const previous = volSamples[index];
        const intervalMs = sample.at - previous.at;
        return intervalMs > 0 && previous.price > 0 ? Math.pow(sample.price / previous.price, 1000 / intervalMs) - 1 : null;
      }).filter(Number.isFinite);
      if (returns.length >= 3) {
        const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
        const volatility = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length);
        add(observation('volatility', volatility, 'DEXSCREENER_API', evidence('volatility', token.at), 'DEXSCREENER_CLOUD', token.at, now, 0.45));
      }
    }

    if (risk?.mint === mint && risk.providers?.rugcheck === 'live' && Number.isSafeInteger(risk.at) && risk.at > 0 && risk.at <= now && now - risk.at <= 45_000 &&
        Number.isFinite(risk.holders?.top10Bps) && risk.holders.top10Bps >= 0 && risk.holders.top10Bps <= 10_000) {
      add(observation('wallet_concentration', risk.holders.top10Bps / 10_000, 'RUGCHECK_API', `rugcheck:${mint}:${risk.at}:top10Bps`, 'RUGCHECK_CLOUD', risk.at, now, 0.55));
    }
    if (risk?.mint === mint && risk.providers?.rugcheck === 'live' && Number.isSafeInteger(risk.at) && risk.at > 0 && risk.at <= now && now - risk.at <= 45_000 &&
        Number.isFinite(risk.normalizedScore01) && risk.normalizedScore01 >= 0 && risk.normalizedScore01 <= 1) {
      add(observation('rug_score', risk.normalizedScore01, 'RUGCHECK_API', `rugcheck:${mint}:${risk.at}:score_normalised`, 'RUGCHECK_CLOUD', risk.at, now, 0.55));
    }
    if (risk?.mint === mint && risk.providers?.rugcheck === 'live' && Number.isSafeInteger(risk.at) && risk.at > 0 && risk.at <= now && now - risk.at <= 45_000 &&
        Number.isFinite(risk.bundling?.bundledPct) && risk.bundling.bundledPct >= 0 && risk.bundling.bundledPct <= 10_000) {
      add(observation('bundle_rate', risk.bundling.bundledPct / 10_000, 'RUGCHECK_API', `rugcheck:${mint}:${risk.at}:bundledPct`, 'RUGCHECK_CLOUD', risk.at, now, 0.45));
    }
    if (tradeEvidence?.mint === mint && tradeEvidence.source === 'PUMPPORTAL_WS' && tradeEvidence.fresh === true && Number.isSafeInteger(tradeEvidence.at) && tradeEvidence.at > 0 && tradeEvidence.at <= now && now - tradeEvidence.at <= 5_000) {
      if (Number.isSafeInteger(tradeEvidence.uniqueBuyers) && tradeEvidence.uniqueBuyers >= 0) {
        add(observation('unique_buyers', tradeEvidence.uniqueBuyers, 'PUMPPORTAL_WS', `pumpportal:${mint}:${tradeEvidence.at}:unique_buyers`, 'PUMPPORTAL_TRADE_STREAM', tradeEvidence.at, now, 0.75));
      }
      if (Number.isSafeInteger(tradeEvidence.buyCount) && tradeEvidence.buyCount >= 0 && Number.isSafeInteger(tradeEvidence.sellCount) && tradeEvidence.sellCount > 0) {
        add(observation('buy_sell_ratio', tradeEvidence.buyCount / tradeEvidence.sellCount, 'PUMPPORTAL_WS', `pumpportal:${mint}:${tradeEvidence.at}:buy_sell_ratio`, 'PUMPPORTAL_TRADE_STREAM', tradeEvidence.at, now, 0.75));
      }
      if (Number.isSafeInteger(tradeEvidence.latestSlot) && tradeEvidence.latestSlot > 0 &&
          Number.isSafeInteger(network?.slot) && network.slot >= tradeEvidence.latestSlot &&
          Number.isSafeInteger(network?.at) && network.at > 0 && network.at <= now && now - network.at <= 5_000) {
        const observedAt = Math.min(tradeEvidence.at, network.at);
        add(observation('provider_slot_lag', network.slot - tradeEvidence.latestSlot, 'PUMPPORTAL_WS+SOLANA_RPC',
          `cross-slot:${mint}:${tradeEvidence.latestSlot}:${network.slot}`, 'CROSS_PROVIDER_SLOT_COMPARISON', observedAt, now, 0.7));
      }
    }
    return out;
  };
}
