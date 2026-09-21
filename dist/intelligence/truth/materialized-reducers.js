/**
 * SOL-SYLPH Materialized State Reducers & Event Sourcing
 * Blueprint Part III & Phase 1
 *
 * Providers → Transport adapters → SylphEvent → Immutable Event Log → Deterministic Reducers → Materialized State.
 * Materializes TokenTwin, ActorGraph, LiquidityState, ExecutionState, FeatureState, PortfolioState.
 * Guarantees state hashing, snapshotting, and idempotent replay.
 */
import { createHash } from 'crypto';
export class MaterializedStateEngine {
    stateByToken = new Map();
    processedEventIds = new Set();
    reduceEvent(event) {
        const mint = event.mint;
        let current = this.stateByToken.get(mint);
        if (!current) {
            current = {
                mint,
                epoch: 1,
                twin: {
                    mint,
                    name: 'Token ' + mint.slice(0, 6),
                    symbol: mint.slice(0, 4).toUpperCase(),
                    decimals: 9,
                    supply: 1_000_000_000,
                    price: 0.00001,
                    marketCap: 10_000,
                    liquidity: 5_000,
                    txCount: 0,
                    buyCount: 0,
                    sellCount: 0,
                    firstSeenMs: event.observedAt,
                    lastUpdatedMs: event.observedAt,
                    isQuarantined: false,
                },
                liquidity: {
                    mint,
                    poolType: 'PUMP_CURVE',
                    reservesBase: 1_000_000_000,
                    reservesQuote: 30,
                    depth25Usd: 15,
                    depth50Usd: 25,
                    depth100Usd: 40,
                    depth250Usd: 70,
                    depth500Usd: 120,
                    effectiveSlippageBps: 45,
                    lpBurnedPct: 100,
                    lastSlot: event.slot ?? 0,
                },
                actorGraph: {
                    mint,
                    totalUniqueWallets: 1,
                    economicClustersCount: 1,
                    creatorAddress: 'w_creator',
                    topHolderConcentrationPct: 15,
                    washTradingSuspectCount: 0,
                    freshWalletsCount: 1,
                },
                execution: {
                    mint,
                    buyRouteValid: true,
                    sellRouteValid: true,
                    roundTripImpactBps: 80,
                    latencyEstimateMs: 250,
                    lastQuoteMs: event.observedAt,
                },
                portfolio: {
                    confirmedSol: 0,
                    pendingSol: 0,
                    reservedSol: 0,
                    activePositionsCount: 0,
                    maxPortfolioCapacitySol: 10.0,
                },
                stateHash: '',
                lastSequenceProcessed: 0,
            };
        }
        // Deduplication check
        if (this.processedEventIds.has(event.eventId)) {
            return current;
        }
        this.processedEventIds.add(event.eventId);
        // Apply mutation based on eventType
        current.epoch += 1;
        current.lastSequenceProcessed = event.sequence;
        current.twin.lastUpdatedMs = event.observedAt;
        const payload = event.payload;
        switch (event.eventType) {
            case 'TRADE_RECEIVED':
            case 'PRICE_UPDATED': {
                current.twin.txCount += 1;
                if (typeof payload.price === 'number')
                    current.twin.price = payload.price;
                if (typeof payload.priceSol === 'number')
                    current.twin.price = payload.priceSol;
                if (typeof payload.amountSol === 'number') {
                    current.twin.liquidity += payload.amountSol;
                }
                if (typeof payload.marketCap === 'number')
                    current.twin.marketCap = payload.marketCap;
                if (payload.side === 'buy' || payload.isBuy)
                    current.twin.buyCount += 1;
                if (payload.side === 'sell' || payload.isSell)
                    current.twin.sellCount += 1;
                break;
            }
            case 'LIQUIDITY_UPDATED': {
                if (typeof payload.liquidity === 'number')
                    current.twin.liquidity = payload.liquidity;
                if (typeof payload.reservesBase === 'number')
                    current.liquidity.reservesBase = payload.reservesBase;
                if (typeof payload.reservesQuote === 'number')
                    current.liquidity.reservesQuote = payload.reservesQuote;
                if (typeof payload.effectiveSlippageBps === 'number')
                    current.liquidity.effectiveSlippageBps = payload.effectiveSlippageBps;
                break;
            }
            case 'WALLET_ENTERED':
            case 'WHALE_ENTERED': {
                current.actorGraph.totalUniqueWallets += 1;
                if (payload.isFresh)
                    current.actorGraph.freshWalletsCount += 1;
                break;
            }
            case 'WASH_DETECTED': {
                current.actorGraph.washTradingSuspectCount += 1;
                break;
            }
            case 'PROTECTION_ENABLED': {
                current.twin.isQuarantined = true;
                break;
            }
            case 'PROTECTION_DISABLED': {
                current.twin.isQuarantined = false;
                break;
            }
        }
        // Compute deterministic state hash
        current.stateHash = createHash('sha256')
            .update(`${mint}:${current.epoch}:${current.twin.price}:${current.twin.txCount}:${current.twin.liquidity}:${current.actorGraph.totalUniqueWallets}`)
            .digest('hex');
        this.stateByToken.set(mint, current);
        return current;
    }
    getState(mint) {
        return this.stateByToken.get(mint);
    }
    takeSnapshot() {
        const snap = {};
        for (const [mint, state] of this.stateByToken.entries()) {
            snap[mint] = JSON.parse(JSON.stringify(state));
        }
        return snap;
    }
    restoreSnapshot(snap) {
        this.stateByToken.clear();
        for (const [mint, state] of Object.entries(snap)) {
            this.stateByToken.set(mint, state);
        }
    }
}
//# sourceMappingURL=materialized-reducers.js.map