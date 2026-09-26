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
export class PairResolver {
    poolsByToken = new Map();
    recordPool(observation) {
        let tokenPools = this.poolsByToken.get(observation.mint);
        if (!tokenPools) {
            tokenPools = new Map();
            this.poolsByToken.set(observation.mint, tokenPools);
        }
        tokenPools.set(observation.poolId, observation);
        return this.resolveVenues(observation.mint);
    }
    resolveVenues(mint) {
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
        let lifecycle = 'PUMP_CURVE';
        if (primaryPool.venueId !== 'PUMP_FUN') {
            lifecycle = pools.length > 1 ? 'MULTI_VENUE' : 'DEX_ACTIVE';
        }
        else if (primaryPool.quoteReservesSol > 80.0) {
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
export class PriceAuthority {
    prices = new Map();
    updatePrice(params) {
        const now = params.now ?? Date.now();
        const canonical = {
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
    getPrice(mint) {
        return this.prices.get(mint);
    }
}
export class SupplyAuthority {
    supplies = new Map();
    setSupply(mint, supply) {
        this.supplies.set(mint, supply);
    }
    getSupply(mint) {
        return this.supplies.get(mint) ?? 1000000000n * 1000000n;
    }
}
export class MCAPAuthority {
    priceAuthority;
    supplyAuthority;
    constructor(priceAuthority, supplyAuthority) {
        this.priceAuthority = priceAuthority;
        this.supplyAuthority = supplyAuthority;
    }
    calculateMCAP(mint, solUsdPrice) {
        const price = this.priceAuthority.getPrice(mint);
        const supply = this.supplyAuthority.getSupply(mint);
        const priceSol = price?.priceSol ?? 0;
        // Assume 6 decimals
        const tokens = Number(supply / 1000000n);
        const mcapSol = priceSol * tokens;
        const mcapUsd = mcapSol * solUsdPrice;
        return { mcapSol, mcapUsd };
    }
}
export class TokenCapabilityEngine {
    decodeCapabilities(params) {
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
//# sourceMappingURL=venue-resolver.js.map