const LAMPORTS_PER_SOL = 1_000_000_000n;
const MAX_SAFE_LAMPORTS = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_SAFE_USD = Number.MAX_SAFE_INTEGER;
const FRESHNESS_WINDOW_MS = 5_000;

function unknownProjection(reason, stressed, solPriceFreshness = 'UNKNOWN') {
  return {
    ok: true,
    evidenceStatus: 'UNKNOWN',
    projectionStatus: 'UNKNOWN',
    valueSource: 'GATEWAY_STATE_SNAPSHOT',
    reason,
    paperCashLamports: null,
    paperCashUsd: null,
    emergencyReserveLamports: null,
    emergencyReserveUsd: null,
    reservedCashLamports: null,
    reservedCashUsd: null,
    unknownCapitalLamports: null,
    unknownCapitalStatus: 'NOT_PRESENT_IN_GATEWAY_SNAPSHOT',
    availableCashLamports: null,
    availableCashUsd: null,
    availableCashStatus: 'UNKNOWN',
    solPriceUsdAssumption: null,
    solPriceFreshness,
    isStressed: stressed,
  };
}

function dollarsToLamports(usd, solPriceUsd) {
  if (!Number.isFinite(usd) || usd < 0 || usd > MAX_SAFE_USD) throw new Error('CAPITAL_AMOUNT_INVALID');
  const lamports = (usd / solPriceUsd) * Number(LAMPORTS_PER_SOL);
  if (!Number.isFinite(lamports) || lamports < 0 || lamports > Number.MAX_SAFE_INTEGER) {
    throw new Error('CAPITAL_LAMPORT_CONVERSION_OUT_OF_RANGE');
  }
  const rounded = Math.round(lamports);
  if (!Number.isSafeInteger(rounded)) throw new Error('CAPITAL_LAMPORT_CONVERSION_OUT_OF_RANGE');
  if (usd > 0 && rounded === 0) throw new Error('CAPITAL_LAMPORT_CONVERSION_OUT_OF_RANGE');
  return BigInt(rounded);
}

/** A read-only display projection. It never reads or mutates EconomicAuthorityStore. */
export function projectCapitalReserve(snapshot, { stressed = false, nowMs = Date.now() } = {}) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return unknownProjection('GATEWAY_SNAPSHOT_UNAVAILABLE', stressed);
  }
  if (!Number.isFinite(snapshot.cashUsd) || snapshot.cashUsd < 0 ||
      !Number.isFinite(snapshot.reservedCashUsd) || snapshot.reservedCashUsd < 0 ||
      snapshot.reservedCashUsd > snapshot.cashUsd) {
    return unknownProjection('GATEWAY_CAPITAL_DATA_INVALID', stressed);
  }
  if (!Number.isFinite(snapshot.solPriceUsd) || snapshot.solPriceUsd <= 0 || snapshot.solPriceUsd > MAX_SAFE_USD) {
    return unknownProjection('SOL_PRICE_INVALID', stressed);
  }

  let solPriceFreshness = 'UNKNOWN';
  const priceAt = snapshot.solPriceUpdatedAtMs;
  if (priceAt !== undefined && priceAt !== null) {
    if (!Number.isSafeInteger(priceAt) || !Number.isSafeInteger(nowMs) || priceAt > nowMs) {
      return unknownProjection('SOL_PRICE_TIMESTAMP_INVALID', stressed);
    }
    if (nowMs - priceAt > FRESHNESS_WINDOW_MS) {
      return unknownProjection('SOL_PRICE_STALE', stressed, 'STALE');
    }
    solPriceFreshness = 'FRESH';
  }

  try {
    const paperCashLamports = dollarsToLamports(snapshot.cashUsd, snapshot.solPriceUsd);
    const reservedCashLamports = dollarsToLamports(snapshot.reservedCashUsd, snapshot.solPriceUsd);
    const stressedFullExitCostLamports = BigInt(stressed ? 100_000_000 : 50_000_000);
    const fixedOperationalFloorLamports = 50_000_000n;
    const equityReserveLamports = (paperCashLamports * 2_000n) / 10_000n;
    const emergencyReserveLamports = [stressedFullExitCostLamports, fixedOperationalFloorLamports, equityReserveLamports]
      .reduce((max, value) => value > max ? value : max, 0n);
    if ([paperCashLamports, reservedCashLamports, emergencyReserveLamports].some(value => value > MAX_SAFE_LAMPORTS)) {
      return unknownProjection('CAPITAL_LAMPORT_CONVERSION_OUT_OF_RANGE', stressed, solPriceFreshness);
    }

    const emergencyReserveUsd = Number(emergencyReserveLamports) / Number(LAMPORTS_PER_SOL) * snapshot.solPriceUsd;
    if (!Number.isFinite(emergencyReserveUsd) || emergencyReserveUsd > MAX_SAFE_USD) {
      return unknownProjection('CAPITAL_USD_PROJECTION_OUT_OF_RANGE', stressed, solPriceFreshness);
    }
    return {
      ok: true,
      evidenceStatus: 'SIMULATED_POLICY',
      projectionStatus: 'ASSUMPTION_ONLY',
      valueSource: 'GATEWAY_STATE_SNAPSHOT',
      reason: solPriceFreshness === 'UNKNOWN' ? 'SOL_PRICE_TIMESTAMP_UNAVAILABLE' : null,
      paperCashLamports: paperCashLamports.toString(),
      paperCashUsd: snapshot.cashUsd,
      emergencyReserveLamports: emergencyReserveLamports.toString(),
      emergencyReserveUsd,
      reservedCashLamports: reservedCashLamports.toString(),
      reservedCashUsd: snapshot.reservedCashUsd,
      unknownCapitalLamports: null,
      unknownCapitalStatus: 'NOT_PRESENT_IN_GATEWAY_SNAPSHOT',
      // GatewayStateSnapshot omits quarantined/unknown capital, so free cash is
      // unknowable here and must not be presented as a healthy headroom value.
      availableCashLamports: null,
      availableCashUsd: null,
      availableCashStatus: 'UNKNOWN',
      solPriceUsdAssumption: snapshot.solPriceUsd,
      solPriceFreshness,
      isStressed: stressed,
    };
  } catch (error) {
    return unknownProjection(error instanceof Error ? error.message : 'CAPITAL_PROJECTION_FAILED', stressed, solPriceFreshness);
  }
}

/** HTTP adapter used by the live route and focused route tests. */
export function handleCapitalReserveRequest(req, res, { getSnapshot, nowMs = Date.now() } = {}) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' || url.pathname !== '/api/capital/reserve') return false;
  const stressed = url.searchParams.get('stressed') === 'true';
  let projection;
  try {
    projection = projectCapitalReserve(getSnapshot?.(), { stressed, nowMs });
  } catch {
    projection = unknownProjection('GATEWAY_SNAPSHOT_UNAVAILABLE', stressed);
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(projection));
  return true;
}
