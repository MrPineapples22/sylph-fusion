const DEFAULT_MAX_AGE_MS = 5_000;

export function isFreshObservation(observedAt, now, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  return Number.isSafeInteger(observedAt) && observedAt > 0 &&
    Number.isSafeInteger(now) && now >= observedAt &&
    Number.isFinite(maxAgeMs) && maxAgeMs >= 0 && now - observedAt <= maxAgeMs;
}

export function selectFreshMarketObservation(rows, mint, poolAddress, now, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!Array.isArray(rows) || typeof mint !== 'string' || typeof poolAddress !== 'string') return null;
  for (const row of rows) {
    const rowMint = row?.mint ?? row?.baseToken?.address;
    const rowPool = row?.pair ?? row?.pairAddress;
    const priceUsd = Number(row?.priceUsd ?? row?.price);
    const liquidityUsd = Number(row?.liquidityUsd ?? row?.liquidity?.usd ?? row?.liquidity);
    const observedAt = row?.observedAt ?? row?.at;
    if (rowMint !== mint || rowPool !== poolAddress ||
        !Number.isFinite(priceUsd) || priceUsd <= 0 ||
        !Number.isFinite(liquidityUsd) || liquidityUsd <= 0 ||
        !isFreshObservation(observedAt, now, maxAgeMs)) continue;
    return { mint, poolAddress, priceUsd, liquidityUsd, observedAt };
  }
  return null;
}

export function selectFreshSolObservation(row, now, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const priceUsd = Number(row?.priceUsd ?? row?.price);
  const observedAt = row?.observedAt ?? row?.at;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || !isFreshObservation(observedAt, now, maxAgeMs)) return null;
  return { priceUsd, observedAt };
}

export function isBasketEntryAuthorized(basket, source) {
  return source === 'ASTRA_FEED' && basket?.verified === true && basket?.entryAllowed === true;
}

export async function resolvePaperMarketEvidence({
  mint,
  poolAddress,
  getBasket,
  getHubSnapshot,
  marketDexUrl,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  makeTimeoutSignal = ms => AbortSignal.timeout(ms),
}) {
  let basket = null;
  try { basket = await getBasket?.(); } catch {}

  let timestamp = now();
  let marketObservation = selectFreshMarketObservation(basket?.pairs, mint, poolAddress, timestamp, maxAgeMs);
  let source = marketObservation ? 'ASTRA_FEED' : '';

  let snapTokens = [];
  try {
    const snapshot = getHubSnapshot?.();
    if (Array.isArray(snapshot?.tokens)) snapTokens = snapshot.tokens;
  } catch {}

  if (!marketObservation) {
    timestamp = now();
    marketObservation = selectFreshMarketObservation(snapTokens, mint, poolAddress, timestamp, maxAgeMs);
    if (marketObservation) source = 'MARKET_HUB';
  }

  if (!marketObservation && typeof marketDexUrl === 'string' && marketDexUrl && typeof fetchImpl === 'function') {
    try {
      const response = await fetchImpl(`${marketDexUrl}/tokens/v1/solana/${encodeURIComponent(mint)}`, {
        signal: makeTimeoutSignal(2500),
      });
      if (response.ok) {
        const result = await response.json();
        const pairs = Array.isArray(result) ? result : (Array.isArray(result?.pairs) ? result.pairs : []);
        // HTTP API data has no trusted provider-effective observation time. Receipt
        // time bounds local staleness, but is not proof of when the provider sampled it.
        timestamp = now();
        marketObservation = selectFreshMarketObservation(pairs.map(candidate => ({
          mint: candidate?.baseToken?.address,
          pair: candidate?.pairAddress,
          price: candidate?.priceUsd,
          liquidity: candidate?.liquidity?.usd,
          at: timestamp,
        })), mint, poolAddress, timestamp, maxAgeMs);
        if (marketObservation) source = 'DEXSCREENER_HTTP_RECEIPT';
      }
    } catch {}
  }

  const solRow = snapTokens.find(candidate => candidate?.mint === 'So11111111111111111111111111111111111111112');
  const solObservation = selectFreshSolObservation(solRow, now(), maxAgeMs);
  if (!marketObservation || !solObservation) return null;

  return {
    mint: marketObservation.mint,
    poolAddress: marketObservation.poolAddress,
    priceUsd: marketObservation.priceUsd,
    liquidityUsd: marketObservation.liquidityUsd,
    observedAt: marketObservation.observedAt,
    solPriceUsd: solObservation.priceUsd,
    solObservedAt: solObservation.observedAt,
    marketObservationValid: true,
    source,
    entryAllowed: isBasketEntryAuthorized(basket, source),
  };
}
