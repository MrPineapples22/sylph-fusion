/**
 * Dynamic Position Sizing Engine for Sylph-Fusion & SOL-SYLPH
 * 
 * Mathematically calculates optimal bought position value (USD) for each token at entry:
 * 1. Available Capital & Safety Floor Constraints (Zone 0 Emergency Reserve Protection)
 * 2. Constant-Product AMM Microstructure & Liquidity Depth (x * y = k, price impact <= 2.5%)
 * 3. Alpha Conviction & Half-Kelly Sizing Multiplier (HSI, Tier, Pod momentum, Risk penalties)
 * 4. Portfolio Capacity Allocation across maximum concurrent positions ceiling (e.g. 2 positions)
 */

export interface TokenSizingProfile {
  mint?: string;
  pair?: string;
  symbol?: string;
  tier?: 'PRIME' | 'DEVELOPING' | 'WATCH' | 'NONE' | string;
  price?: number;
  priceUsd?: number;
  priceSol?: number;
  liquidity?: number;
  highSignalIndex?: number;
  pod?: 'UP' | 'DOWN' | 'FLAT' | string;
  vetoes?: readonly string[];
  qualityVetoes?: readonly string[];
  riskScore?: number;
}

export interface CapitalSizingContext {
  available?: number;
  reserved?: number;
  emergencyReserve?: number;
  totalEquity?: number;
}

export interface PositionSizerOptions {
  volatilityAtr?: number;
  consecutiveLossCount?: number;
  capital?: CapitalSizingContext;
  cashUsd?: number;
  reservedCashUsd?: number;
  emergencyReserveUsd?: number;
  activePositionsCount?: number;
  maxPositions?: number;
  solPriceUsd?: number;
  minOrderFloorUsd?: number;
  maxOrderCapUsd?: number;
  maxPriceImpactBps?: number;
}

export interface DynamicPositionSizingResult {
  optimalUsd: number;
  minViableUsd: number;
  maxAllowedUsd: number;
  baseSlotUsd: number;
  unreservedCashUsd: number;
  convictionMultiplier: number;
  estimatedPriceImpactPct: number;
  liquidityCapUsd: number;
  rationale: string;
  confidenceGrade: 'PRIME_AGGRESSIVE' | 'HIGH_CONVICTION' | 'BALANCED_BREAKOUT' | 'DEFENSIVE_PROBE' | 'CAPITAL_CONSTRAINED' | 'BLOCKED_RESERVE';
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function calculateOptimalBuyPositionValue(
  token: TokenSizingProfile = {},
  options: PositionSizerOptions = {}
): DynamicPositionSizingResult {
  const solPriceUsd = options.solPriceUsd ?? 150;
  const maxPositions = options.maxPositions ?? 2;
  const activePositions = options.activePositionsCount ?? 0;
  const maxPriceImpactBps = options.maxPriceImpactBps ?? 250; // 2.5% max price impact

  // 1. Available Capital & Zone 0 Reserve Floor Math
  const totalCashUsd = options.cashUsd ?? options.capital?.available ?? 100.0;
  const reservedCashUsd = options.reservedCashUsd ?? options.capital?.reserved ?? 0.0;
  const emergencyReserveUsd = options.emergencyReserveUsd ?? options.capital?.emergencyReserve ?? (totalCashUsd * 0.20);

  const unreservedCashUsd = Math.max(0, totalCashUsd - reservedCashUsd - emergencyReserveUsd);

  if (unreservedCashUsd <= 0) {
    return {
      optimalUsd: 0,
      minViableUsd: 0,
      maxAllowedUsd: 0,
      baseSlotUsd: 0,
      unreservedCashUsd: 0,
      convictionMultiplier: 0,
      estimatedPriceImpactPct: 0,
      liquidityCapUsd: 0,
      rationale: 'Capital allocation blocked: 100% of cash is locked in Zone 0 Emergency Reserve',
      confidenceGrade: 'BLOCKED_RESERVE',
    };
  }

  // 2. Portfolio Slot Allocation
  const remainingSlots = Math.max(1, maxPositions - activePositions);
  const baseSlotUsd = unreservedCashUsd / remainingSlots;

  // 3. Constant-Product AMM Liquidity Depth Limit (x * y = k)
  // Ensures price impact remains bounded (<= 2.5% default)
  let poolLiquidityUsd = Number(token.liquidity || 0);
  if (!Number.isFinite(poolLiquidityUsd) || poolLiquidityUsd <= 0) {
    // Default fallback: Standard pump.fun initial curve depth ~30 SOL
    poolLiquidityUsd = 30 * solPriceUsd; // $4,500
  }

  const liquidityCapUsd = poolLiquidityUsd * (maxPriceImpactBps / 10000);

  // 4. Alpha Conviction & Half-Kelly Sizing Multiplier (f*)
  const hsi = Number(token.highSignalIndex ?? 75);
  let fHsi = 1.0;
  if (hsi >= 90) {
    fHsi = 1.25;
  } else if (hsi >= 80) {
    fHsi = 1.00;
  } else if (hsi >= 70) {
    fHsi = 0.75;
  } else {
    fHsi = 0.45;
  }

  let tierModifier = 0.0;
  if (token.tier === 'PRIME') {
    tierModifier = 0.15;
  } else if (token.tier === 'WATCH') {
    tierModifier = -0.20;
  }

  let podModifier = 0.0;
  if (token.pod === 'UP') {
    podModifier = 0.10;
  } else if (token.pod === 'DOWN') {
    podModifier = -0.35;
  }

  const riskScore = Number(token.riskScore ?? 0);
  let riskPenalty = 1.0;
  if (riskScore > 35) {
    riskPenalty = Math.max(0.40, 1.0 - ((riskScore - 35) / 100));
  }
  if ((token.qualityVetoes?.length ?? 0) > 0 || (token.vetoes?.length ?? 0) > 0) {
    riskPenalty *= 0.50;
  }

  let rawConviction = (fHsi + tierModifier + podModifier) * riskPenalty;

  // Volatility Sizing Deflator: scale down size during turbulent volatility
  if (typeof options.volatilityAtr === 'number' && options.volatilityAtr > 0.05) {
    const volDeflator = 1.0 / (1.0 + (options.volatilityAtr * 4) ** 2);
    rawConviction *= Math.max(0.35, Math.min(1.0, volDeflator));
  }

  // Consecutive Loss Anti-Martingale Throttle: reduce risk after 2+ losing trades
  if (typeof options.consecutiveLossCount === 'number' && options.consecutiveLossCount >= 2) {
    const lossThrottle = options.consecutiveLossCount >= 3 ? 0.50 : 0.75;
    rawConviction *= lossThrottle;
  }

  const convictionMultiplier = clamp(rawConviction, 0.20, 1.50);

  // 5. Compute Target Buy Position Value
  const rawTargetUsd = baseSlotUsd * convictionMultiplier;

  // Bounded by liquidity depth (preventing adverse price impact)
  const boundedByLiquidity = Math.min(rawTargetUsd, liquidityCapUsd);

  // Absolute & percentage diversification limits
  const defaultMaxCap = Math.max(25.0, Math.min(250.0, unreservedCashUsd * 0.75));
  const maxOrderCapUsd = options.maxOrderCapUsd ?? defaultMaxCap;
  const boundedByCap = Math.min(boundedByLiquidity, maxOrderCapUsd);

  // Cash constraint: never exceed available unreserved cash
  let targetUsd = Math.min(boundedByCap, unreservedCashUsd);

  // Floor constraint: minimum viable order
  const minFloorUsd = Math.min(options.minOrderFloorUsd ?? 5.0, unreservedCashUsd);
  if (targetUsd < minFloorUsd) {
    targetUsd = minFloorUsd;
  }

  // Clean rounding
  const optimalUsd = Math.round(targetUsd * 100) / 100;
  const minViableUsd = Math.round(minFloorUsd * 100) / 100;
  const maxAllowedUsd = Math.round(Math.min(liquidityCapUsd, maxOrderCapUsd, unreservedCashUsd) * 100) / 100;
  const estimatedPriceImpactPct = poolLiquidityUsd > 0
    ? Number(((optimalUsd / poolLiquidityUsd) * 100).toFixed(2))
    : 0.50;

  // Classify confidence grade
  let confidenceGrade: DynamicPositionSizingResult['confidenceGrade'] = 'BALANCED_BREAKOUT';
  if (unreservedCashUsd < 25.0) {
    confidenceGrade = 'CAPITAL_CONSTRAINED';
  } else if (convictionMultiplier >= 1.20 && token.tier === 'PRIME') {
    confidenceGrade = 'PRIME_AGGRESSIVE';
  } else if (convictionMultiplier >= 1.00) {
    confidenceGrade = 'HIGH_CONVICTION';
  } else {
    confidenceGrade = 'DEFENSIVE_PROBE';
  }

  // Construct readable rationale
  let rationale = '';
  if (optimalUsd >= liquidityCapUsd - 0.50 && liquidityCapUsd < rawTargetUsd) {
    rationale = `Capped at $${optimalUsd.toFixed(2)} by 2.5% pool liquidity depth ($${(poolLiquidityUsd / 1000).toFixed(1)}k depth) to prevent slippage`;
  } else if (confidenceGrade === 'CAPITAL_CONSTRAINED') {
    rationale = `Sized to $${optimalUsd.toFixed(2)} based on available unreserved cash ($${unreservedCashUsd.toFixed(2)} free after Zone 0 reserve)`;
  } else if (confidenceGrade === 'PRIME_AGGRESSIVE') {
    rationale = `Aggressive $${optimalUsd.toFixed(2)} entry: Prime tier, HSI ${hsi}, UP momentum (${convictionMultiplier.toFixed(2)}x Kelly, ${estimatedPriceImpactPct}% impact)`;
  } else if (confidenceGrade === 'DEFENSIVE_PROBE') {
    rationale = `Defensive $${optimalUsd.toFixed(2)} probe: HSI ${hsi}, risk-adjusted (${convictionMultiplier.toFixed(2)}x Kelly, ${estimatedPriceImpactPct}% impact)`;
  } else {
    rationale = `Optimal $${optimalUsd.toFixed(2)}: High conviction HSI ${hsi} (${convictionMultiplier.toFixed(2)}x Kelly, ${estimatedPriceImpactPct}% impact)`;
  }

  return {
    optimalUsd,
    minViableUsd,
    maxAllowedUsd,
    baseSlotUsd: Math.round(baseSlotUsd * 100) / 100,
    unreservedCashUsd: Math.round(unreservedCashUsd * 100) / 100,
    convictionMultiplier: Number(convictionMultiplier.toFixed(2)),
    estimatedPriceImpactPct,
    liquidityCapUsd: Math.round(liquidityCapUsd * 100) / 100,
    rationale,
    confidenceGrade,
  };
}
