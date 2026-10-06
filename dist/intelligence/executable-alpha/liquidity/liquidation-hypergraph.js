/**
 * SYLPH FUSION — LIQUIDATION HYPERGRAPH ENGINE
 * Study 28: LIQUIDATION-HYPERGRAPH-X (Section XIV)
 *
 * Models available liquidation pathways across AMM pools, multi-hop routing,
 * and venue dependencies as a directed hypergraph.
 */
export class LiquidationHypergraphEngine {
    static buildHypergraph(params) {
        const { primaryPoolLiquidityUsd, secondaryRoutesLiquidityUsd = 0, primaryVenueName = 'Raydium_Launch', } = params;
        const routes = [
            {
                routeId: `${primaryVenueName}-direct`,
                venue: primaryVenueName,
                hopCount: 1,
                maxCapacityUsd: primaryPoolLiquidityUsd * 0.15, // max 15% without prohibitive slippage
                failureProbability: 0.05,
            },
        ];
        if (secondaryRoutesLiquidityUsd > 1000) {
            routes.push({
                routeId: 'Jupiter-multihop-secondary',
                venue: 'Jupiter_Aggregator',
                hopCount: 2,
                maxCapacityUsd: secondaryRoutesLiquidityUsd * 0.10,
                failureProbability: 0.12,
            });
        }
        const aggregateCapacity = routes.reduce((sum, r) => sum + r.maxCapacityUsd, 0);
        const primaryShare = aggregateCapacity > 0 ? routes[0].maxCapacityUsd / aggregateCapacity : 1.0;
        return {
            primaryVenue: primaryVenueName,
            availableRoutes: routes,
            aggregateExitCapacityUsd: aggregateCapacity,
            singlePointOfFailureVenue: primaryShare > 0.85 ? primaryVenueName : undefined,
            venueOutageImpactRatio: primaryShare,
        };
    }
}
//# sourceMappingURL=liquidation-hypergraph.js.map