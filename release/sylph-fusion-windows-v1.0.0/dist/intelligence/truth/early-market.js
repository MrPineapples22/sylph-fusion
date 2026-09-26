/**
 * SOL-SYLPH Early Market Formation Engine
 * Blueprint Part IX
 *
 * Tracks high-resolution early windows:
 * T0, +1 slot, +2 slots, +5 slots, +10 slots, +30s, +1m, +2m, +5m.
 * Builds EarlyMarketFormationRecord.
 */
export class EarlyMarketFormationEngine {
    formations = new Map();
    initializeFormation(mint, genesisSlot, genesisTimestampMs) {
        const formation = {
            mint,
            genesisSlot,
            genesisTimestampMs,
            windows: {},
            actorExpansionVelocity: 0.0,
            capitalNoveltyTrend: 'NEUTRAL',
            bundleRisk: false,
            formationAuthenticityScore: 1.0,
        };
        this.formations.set(mint, formation);
        return formation;
    }
    recordWindow(mint, snapshot) {
        let formation = this.formations.get(mint);
        if (!formation) {
            formation = this.initializeFormation(mint, snapshot.slot, snapshot.timestampMs);
        }
        formation.windows[snapshot.windowId] = snapshot;
        // Calculate trends across windows
        const windowKeys = Object.keys(formation.windows);
        const windowValues = Object.values(formation.windows).filter((w) => Boolean(w));
        const hasBundle = windowValues.some(w => w.bundleDetected);
        formation.bundleRisk = hasBundle;
        if (windowKeys.length >= 2 && windowValues.length >= 2) {
            const sorted = [...windowValues].sort((a, b) => a.timestampMs - b.timestampMs);
            const first = sorted[0];
            const last = sorted[sorted.length - 1];
            if (first && last) {
                const timeDeltaSec = Math.max(1, (last.timestampMs - first.timestampMs) / 1000);
                const actorGrowth = (last.independentEconomicActors - first.independentEconomicActors) / timeDeltaSec;
                formation.actorExpansionVelocity = Number(actorGrowth.toFixed(3));
                const noveltyTrend = last.capitalNoveltyRatio > 0.6 ? 'EXPANDING' : last.capitalNoveltyRatio < 0.3 ? 'RECYCLING' : 'NEUTRAL';
                formation.capitalNoveltyTrend = noveltyTrend;
                const authenticity = (hasBundle ? 0.4 : 0.8) * Math.min(1.0, last.capitalNoveltyRatio + 0.2) * (1.0 - (last.top3HolderConcentrationPct / 100) * 0.4);
                formation.formationAuthenticityScore = Math.max(0.0, Math.min(1.0, authenticity));
            }
        }
        return formation;
    }
    getFormation(mint) {
        return this.formations.get(mint);
    }
}
//# sourceMappingURL=early-market.js.map