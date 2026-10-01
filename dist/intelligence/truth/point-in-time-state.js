/**
 * SOL-SYLPH Master Intelligence Architecture - Point-in-Time State Engine
 * Specifications: Part IV (Point-in-Time State Engine).
 *
 * Enforces zero lookahead leakage by reconstructing historical state
 * strictly as of the requested timestamp and slot.
 *
 * Provides:
 * - get_token_state(mint, timestampMs, slot)
 * - get_wallet_state(wallet, timestampMs, slot)
 * - get_market_state(timestampMs, slot)
 * - get_portfolio_state(timestampMs)
 */
import { TemporalFirewall } from './temporal-firewall.js';
export class PointInTimeStateEngine {
    eventsByMint = new Map();
    eventsByWallet = new Map();
    globalEvents = [];
    portfolioSnapshots = [];
    solPriceObservations = [];
    /**
     * Record authoritative point-in-time SOL/USD oracle observation.
     */
    recordSolPrice(timestampMs, slot, priceUsd) {
        if (Number.isFinite(priceUsd) && priceUsd > 0) {
            this.solPriceObservations.push({ timestampMs, slot, priceUsd });
        }
    }
    /**
     * Ingest canonical event chronologically.
     */
    ingestEvent(event) {
        this.globalEvents.push(event);
        const eventPrice = Number(event.payload?.['solPriceUsd'] ?? event.payload?.['oraclePriceUsd']);
        if (Number.isFinite(eventPrice) && eventPrice > 0) {
            this.recordSolPrice(event.receivedTimestampMs, event.slot, eventPrice);
        }
        if (event.mint) {
            const list = this.eventsByMint.get(event.mint) ?? [];
            list.push(event);
            this.eventsByMint.set(event.mint, list);
        }
        if (event.wallet) {
            const list = this.eventsByWallet.get(event.wallet) ?? [];
            list.push(event);
            this.eventsByWallet.set(event.wallet, list);
        }
    }
    recordPortfolioSnapshot(snapshot) {
        this.portfolioSnapshots.push(snapshot);
    }
    /**
     * Helper to evaluate whether an event was known / available at the specified cutoff.
     * Under SYLPH_AS_KNOWN, repaired history received later is excluded from decision-time queries.
     */
    isEventEligible(event, timestampMs, slot, perspective) {
        if (event.slot > slot)
            return false;
        if (perspective === 'MARKET_AS_WAS') {
            return event.sourceTimestampMs <= timestampMs;
        }
        const knownAt = (event.receivedTimestampMs && event.receivedTimestampMs > 0)
            ? event.receivedTimestampMs
            : event.sourceTimestampMs;
        return knownAt <= timestampMs;
    }
    /**
     * Reconstruct historical token state strictly as-of decision point (T, slot).
     */
    get_token_state(mint, timestampMs, slot = Number.MAX_SAFE_INTEGER, options) {
        const list = this.eventsByMint.get(mint);
        if (!list || list.length === 0)
            return undefined;
        const perspective = options?.perspective ?? 'SYLPH_AS_KNOWN';
        // Filter strictly with bitemporal cutoff
        const eligible = list.filter((e) => this.isEventEligible(e, timestampMs, slot, perspective));
        if (eligible.length === 0)
            return undefined;
        // Enforce temporal firewall assertion
        const latest = eligible[eligible.length - 1];
        const availableTimestamp = perspective === 'MARKET_AS_WAS'
            ? latest.sourceTimestampMs
            : ((latest.receivedTimestampMs && latest.receivedTimestampMs > 0) ? latest.receivedTimestampMs : latest.sourceTimestampMs);
        TemporalFirewall.assertAvailableBeforeDecision({
            artifactId: latest.eventId,
            availableTimestampMs: availableTimestamp,
            availableSlot: latest.slot,
        }, { decisionTimestampMs: timestampMs, decisionSlot: slot });
        let buyCount = 0;
        let sellCount = 0;
        let buyVolumeSol = 0;
        let sellVolumeSol = 0;
        const uniqueWallets = new Set();
        let lastPrice = 0.00001;
        let lastLiquidity = 10.0;
        for (const evt of eligible) {
            if (evt.wallet)
                uniqueWallets.add(evt.wallet);
            const amt = Number(evt.payload['amountSol'] ?? 0);
            const price = Number(evt.payload['priceSol'] ?? 0);
            if (price > 0)
                lastPrice = price;
            if (evt.payload['liquiditySol'])
                lastLiquidity = Number(evt.payload['liquiditySol']);
            if (evt.eventType === 'BUY' || evt.eventType === 'TOKEN_CREATE' || evt.eventType === 'TRADE_SWAP') {
                buyCount++;
                buyVolumeSol += amt;
            }
            else if (evt.eventType === 'SELL') {
                sellCount++;
                sellVolumeSol += amt;
            }
        }
        return {
            mint,
            asOfTimestampMs: timestampMs,
            asOfSlot: slot,
            priceSol: lastPrice,
            liquiditySol: lastLiquidity,
            marketCapSol: lastLiquidity * 2.5,
            totalTxCount: eligible.length,
            buyCount,
            sellCount,
            buyVolumeSol,
            sellVolumeSol,
            uniqueWalletsCount: Math.max(1, uniqueWallets.size),
            top10ConcentrationPct: Math.min(95, Math.max(10, 100 - uniqueWallets.size * 3)),
            lastActivityTimestampMs: latest.sourceTimestampMs,
            stateVersion: eligible.length,
        };
    }
    /**
     * Reconstruct historical wallet state strictly as-of decision point (T, slot).
     */
    get_wallet_state(wallet, timestampMs, slot = Number.MAX_SAFE_INTEGER, options) {
        const list = this.eventsByWallet.get(wallet);
        if (!list || list.length === 0)
            return undefined;
        const perspective = options?.perspective ?? 'SYLPH_AS_KNOWN';
        const eligible = list.filter((e) => this.isEventEligible(e, timestampMs, slot, perspective));
        if (eligible.length === 0)
            return undefined;
        const firstSeen = eligible[0].slot;
        const lastSeen = eligible[eligible.length - 1].slot;
        const tokensTraded = new Set();
        let totalVol = 0;
        let parentFunding;
        for (const evt of eligible) {
            if (evt.mint)
                tokensTraded.add(evt.mint);
            totalVol += Number(evt.payload['amountSol'] ?? 0);
            if (evt.payload['parentFundingAddress']) {
                parentFunding = String(evt.payload['parentFundingAddress']);
            }
        }
        return {
            walletAddress: wallet,
            asOfTimestampMs: timestampMs,
            asOfSlot: slot,
            firstSeenSlot: firstSeen,
            lastSeenSlot: lastSeen,
            totalTradesCount: eligible.length,
            totalVolumeSol: totalVol,
            parentFundingAddress: parentFunding,
            knownTokensTraded: Array.from(tokensTraded),
            reputationScore: Math.min(100, Math.max(20, tokensTraded.size * 5 + eligible.length * 2)),
        };
    }
    /**
     * Reconstruct macro market state strictly as-of decision point (T, slot).
     */
    get_market_state(timestampMs, slot = Number.MAX_SAFE_INTEGER, options) {
        const perspective = options?.perspective ?? 'SYLPH_AS_KNOWN';
        const eligible = this.globalEvents.filter((e) => this.isEventEligible(e, timestampMs, slot, perspective));
        const activeMints = new Set();
        const oneHourAgo = timestampMs - 3_600_000;
        let launchesLastHour = 0;
        for (const evt of eligible) {
            if (evt.mint)
                activeMints.add(evt.mint);
            if (evt.eventType === 'TOKEN_CREATE' && evt.sourceTimestampMs >= oneHourAgo) {
                launchesLastHour++;
            }
        }
        const latestPrice = this.solPriceObservations
            .filter((o) => o.timestampMs <= timestampMs)
            .sort((a, b) => b.timestampMs - a.timestampMs)[0];
        const solPriceUsd = latestPrice?.priceUsd ?? 0.0;
        return {
            asOfTimestampMs: timestampMs,
            asOfSlot: slot,
            solPriceUsd,
            solReturn24hPct: 2.5,
            activeTokensCount: activeMints.size,
            launchesLastHourCount: launchesLastHour,
            macroRegime: launchesLastHour > 20 ? 'RISK_ON' : 'NEUTRAL',
            networkSlotLag: 2,
            rpcHealthyCount: 3,
        };
    }
    /**
     * Reconstruct historical portfolio state strictly as-of timestamp.
     */
    get_portfolio_state(timestampMs) {
        const eligible = this.portfolioSnapshots.filter((s) => s.asOfTimestampMs <= timestampMs);
        if (eligible.length > 0) {
            return eligible[eligible.length - 1];
        }
        // Default clean initial portfolio state
        return {
            asOfTimestampMs: timestampMs,
            totalEquitySol: 100.0,
            cashReserveSol: 100.0,
            openPositionsCount: 0,
            totalExposureSol: 0.0,
            activePositions: [],
            portfolioState: 'NORMAL',
        };
    }
}
//# sourceMappingURL=point-in-time-state.js.map