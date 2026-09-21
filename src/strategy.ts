export type StrategyKind = 'atomic-arb' | 'curve-scalp' | 'liquidation-harvest' | 'basis-neutral';

export type StrategyStatus = { kind: StrategyKind; enabled: boolean; reason: string };

/** Capabilities are explicit so the UI never implies that an unconfigured venue is live. */
export function strategyStatuses(): StrategyStatus[] {
  return [
    { kind: 'curve-scalp', enabled: true, reason: 'PumpPortal events, finalized quotes, paper/live settlement and exit ladder are available' },
    { kind: 'atomic-arb', enabled: false, reason: 'requires two verified venue adapters and a single transaction instruction plan' },
    { kind: 'liquidation-harvest', enabled: false, reason: 'requires protocol-specific health-account streams and a verified flash route' },
    { kind: 'basis-neutral', enabled: false, reason: 'requires perp funding data plus an atomic hedge adapter' },
  ];
}

export type VenueQuote = {
  venue: string;
  mint: string;
  buyLamports: bigint;
  sellLamports: bigint;
  feeLamports: bigint;
  slot: number;
  observedAt: number;
};

export type ArbDecision = {
  accepted: boolean;
  reason: string;
  grossLamports: bigint;
  tipLamports: bigint;
  netLamports: bigint;
};

const clamp = (n: bigint, low: bigint, high: bigint) => n < low ? low : n > high ? high : n;

/** Deterministic preflight for a two-leg atomic arbitrage route. It never creates a partial leg. */
export function atomicArbPreflight(buy: VenueQuote, sell: VenueQuote, now = Date.now(), maxAgeMs = 1_500): ArbDecision {
  if (![now,maxAgeMs,buy.observedAt,sell.observedAt].every(Number.isFinite) || maxAgeMs < 0 || buy.observedAt > now || sell.observedAt > now || !Number.isSafeInteger(buy.slot) || buy.slot < 0 || !Number.isSafeInteger(sell.slot) || sell.slot < 0 || buy.buyLamports <= 0n || sell.sellLamports <= 0n || buy.feeLamports < 0n || sell.feeLamports < 0n)
    return { accepted:false, reason:'invalid quote inputs', grossLamports:0n, tipLamports:0n, netLamports:0n };
  if (buy.mint !== sell.mint) return { accepted: false, reason: 'mint mismatch', grossLamports: 0n, tipLamports: 0n, netLamports: 0n };
  if (buy.venue === sell.venue) return { accepted: false, reason: 'same venue', grossLamports: 0n, tipLamports: 0n, netLamports: 0n };
  if (buy.slot !== sell.slot) return { accepted: false, reason: 'quotes are from different slots', grossLamports: 0n, tipLamports: 0n, netLamports: 0n };
  if (now - Math.min(buy.observedAt, sell.observedAt) > maxAgeMs) return { accepted: false, reason: 'stale quote', grossLamports: 0n, tipLamports: 0n, netLamports: 0n };
  const gross = sell.sellLamports - buy.buyLamports;
  const fees = buy.feeLamports + sell.feeLamports;
  if (gross <= fees) return { accepted: false, reason: 'spread does not cover fees', grossLamports: gross > 0n ? gross : 0n, tipLamports: 0n, netLamports: gross - fees };
  const edge = gross - fees;
  const tipFloor = edge / 10n < 1_000n ? edge / 10n : 1_000n;
  const tip = clamp(edge * 6n / 10n, tipFloor, edge * 3n / 4n);
  const net = gross - fees - tip;
  if (net <= 0n) return { accepted: false, reason: 'tip consumes expected edge', grossLamports: gross, tipLamports: tip, netLamports: net };
  return { accepted: true, reason: 'atomic spread survives fees and dynamic tip', grossLamports: gross, tipLamports: tip, netLamports: net };
}

export type CurveScalpInput = { ageMs: number; holdMs: number; returnBps: number; peakBps: number; migrated: boolean; creatorSold: boolean; buyVelocityBps: number };
export type CurveScalpDecision = { action: 'enter' | 'hold' | 'scale-out' | 'exit' | 'reject'; fractionBps: number; reason: string };

/** Short-horizon curve policy: no new entries after the 45-second discovery window and no migration hold. */
export function curveScalpDecision(i: CurveScalpInput): CurveScalpDecision {
  if (i.creatorSold) return { action: 'exit', fractionBps: 10_000, reason: 'creator sell detected' };
  if (i.migrated) return { action: 'exit', fractionBps: 10_000, reason: 'migration boundary reached' };
  if (i.holdMs >= 120_000) return { action: 'exit', fractionBps: 10_000, reason: 'maximum hold reached' };
  if (i.returnBps <= -1_200) return { action: 'exit', fractionBps: 10_000, reason: 'hard loss limit' };
  if (i.returnBps >= 3_500) return { action: 'scale-out', fractionBps: 5_000, reason: 'target reached' };
  if (i.peakBps >= 2_000 && i.returnBps <= i.peakBps - 500) return { action: 'exit', fractionBps: 10_000, reason: 'momentum trailing stop' };
  if (i.buyVelocityBps < -2_500) return { action: 'exit', fractionBps: 10_000, reason: 'buy velocity decayed' };
  // Entry age limits must not suppress exits for existing holdings.
  if (i.ageMs < 15_000) return { action: 'reject', fractionBps: 0, reason: 'discovery window not mature' };
  if (i.ageMs > 45_000) return { action: 'reject', fractionBps: 0, reason: 'entry window expired' };
  return { action: 'hold', fractionBps: 0, reason: 'microstructure remains eligible' };
}
