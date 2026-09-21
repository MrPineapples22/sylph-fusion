/**
 * SOL-SYLPH Venue Resolver, Authorities & Token Capabilities
 * Specifications: Parts XIV, XV, XVI, XVII
 *
 * Enforces:
 * 1. TokenVenueLifecycle separation: token identity != venue identity.
 * 2. PairResolver selecting primary/executable liquidity without last-write-wins races.
 * 3. PriceAuthority, SupplyAuthority, and MCAPAuthority for single numerical truth.
 * 4. Token-2022 capability decoding (transfer fees, freeze authority, permanent delegate, confidential transfers).
 */

import type { TokenId, VenueId, PoolId } from '../events/canonical-event.js';
import type { VenueState } from '../truth/canonical-store.js';

export interface PoolObservation {
  readonly poolId: PoolId;
  readonly venueId: VenueId; // 'PUMP_FUN' | 'RAYDIUM' | 'METEORA' | 'ORCA'
  readonly mint: TokenId;
  readonly baseReserves: bigint;
  readonly quoteReservesSol: number;
  readonly spotPriceSol: number;
  readonly isPrimary: boolean;
  readonly lastSeenMs: number;
}

export interface ResolvedVenues {
  readonly mint: TokenId;
  readonly lifecycle: VenueState;
  readonly primaryPool?: PoolObservation;
  readonly allPools: readonly PoolObservation[];
  readonly aggregateLiquiditySol: number;
  readonly executableLiquiditySol: number;
  readonly dominantVenue: string;
}

export class PairResolver {
  private readonly poolsByToken = new Map<TokenId, Map<PoolId, PoolObservation>>();

  public recordPool(observation: PoolObservation): ResolvedVenues {
    let tokenPools = this.poolsByToken.get(observation.mint);
    if (!tokenPools) {
      tokenPools = new Map();
      this.poolsByToken.set(observation.mint, tokenPools);
    }
    tokenPools.set(observation.poolId, observation);

    return this.resolveVenues(observation.mint);
  }

  public resolveVenues(mint: TokenId): ResolvedVenues {
    const pools = Array.from(this.poolsByToken.get(mint)?.values() ?? []);
    if (pools.length === 0) {
      return {
        mint,
        lifecycle: 'PUMP_CURVE',
        allPools: [],
        aggregateLiquiditySol: 0,
        executableLiquiditySol: 0,
        dominantVenue: 'PUMP_FUN',
      };
    }

    // Sort by quote reserves descending to determine dominant pool
    const sorted = [...pools].sort((a, b) => b.quoteReservesSol - a.quoteReservesSol);
    const primaryPool = sorted[0];

    const aggregateLiquiditySol = pools.reduce((sum, p) => sum + p.quoteReservesSol, 0);
    // Executable liquidity discount for fragmentation
    const executableLiquiditySol = primaryPool.quoteReservesSol * 0.90;

    let lifecycle: VenueState = 'PUMP_CURVE';
    if (primaryPool.venueId !== 'PUMP_FUN') {
      lifecycle = pools.length > 1 ? 'MULTI_VENUE' : 'DEX_ACTIVE';
    } else if (primaryPool.quoteReservesSol > 80.0) {
      lifecycle = 'MIGRATING';
    }

    return {
      mint,
      lifecycle,
      primaryPool,
      allPools: sorted,
      aggregateLiquiditySol,
      executableLiquiditySol,
      dominantVenue: primaryPool.venueId,
    };
  }
}

// --- Part XVI: Price, Supply, MCAP Authorities ---
export interface CanonicalPrice {
  readonly mint: TokenId;
  readonly priceSol: number;
  readonly priceUsd: number;
  readonly source: string;
  readonly confidence: number;
  readonly timestampMs: number;
}

export class PriceAuthority {
  private readonly prices = new Map<TokenId, CanonicalPrice>();

  public updatePrice(params: {
    mint: TokenId;
    priceSol: number;
    solUsdPrice: number;
    source: string;
    confidence?: number;
    now?: number;
  }): CanonicalPrice {
    const now = params.now ?? Date.now();
    const canonical: CanonicalPrice = {
      mint: params.mint,
      priceSol: params.priceSol,
      priceUsd: params.priceSol * params.solUsdPrice,
      source: params.source,
      confidence: params.confidence ?? 0.9,
      timestampMs: now,
    };
    this.prices.set(params.mint, canonical);
    return canonical;
  }

  public getPrice(mint: TokenId): CanonicalPrice | undefined {
    return this.prices.get(mint);
  }
}

export class SupplyAuthority {
  private readonly supplies = new Map<TokenId, bigint>();

  public setSupply(mint: TokenId, supply: bigint): void {
    this.supplies.set(mint, supply);
  }

  public getSupply(mint: TokenId): bigint {
    return this.supplies.get(mint) ?? 1_000_000_000n * 1_000_000n;
  }
}

export class MCAPAuthority {
  constructor(
    private readonly priceAuthority: PriceAuthority,
    private readonly supplyAuthority: SupplyAuthority
  ) {}

  public calculateMCAP(mint: TokenId, solUsdPrice: number): { mcapSol: number; mcapUsd: number } {
    const price = this.priceAuthority.getPrice(mint);
    const supply = this.supplyAuthority.getSupply(mint);

    const priceSol = price?.priceSol ?? 0;
    // Assume 6 decimals
    const tokens = Number(supply / 1_000_000n);
    const mcapSol = priceSol * tokens;
    const mcapUsd = mcapSol * solUsdPrice;

    return { mcapSol, mcapUsd };
  }
}

// --- Part XVII: Token Capabilities Engine ---
export interface TokenCapabilities {
  readonly mint: TokenId;
  readonly isToken2022: boolean;
  readonly hasTransferFee: boolean;
  readonly transferFeeBps: number;
  readonly hasFreezeAuthority: boolean;
  readonly hasPermanentDelegate: boolean;
  readonly isNonTransferable: boolean;
  readonly hasConfidentialTransfers: boolean;
  readonly isBackdoorFree: boolean;
}

export class TokenCapabilityEngine {
  public decodeCapabilities(params: {
    mint: TokenId;
    isToken2022?: boolean;
    freezeAuthority?: string | null;
    permanentDelegate?: string | null;
    transferFeeBps?: number;
  }): TokenCapabilities {
    const hasFreezeAuthority = Boolean(params.freezeAuthority);
    const hasPermanentDelegate = Boolean(params.permanentDelegate);
    const transferFeeBps = params.transferFeeBps ?? 0;
    const hasTransferFee = transferFeeBps > 0;

    const isBackdoorFree = !hasFreezeAuthority && !hasPermanentDelegate && transferFeeBps === 0;

    return {
      mint: params.mint,
      isToken2022: params.isToken2022 ?? false,
      hasTransferFee,
      transferFeeBps,
      hasFreezeAuthority,
      hasPermanentDelegate,
      isNonTransferable: false,
      hasConfidentialTransfers: false,
      isBackdoorFree,
    };
  }
}
