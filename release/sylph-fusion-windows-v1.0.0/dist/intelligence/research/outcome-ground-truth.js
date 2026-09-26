/**
 * SOL-SYLPH Outcome Ground-Truth Ledger & Execution-Adjusted Outcomes
 * Blueprint Parts LIV, LV, LVI
 *
 * Tracks EVERY candidate (Approved, Rejected, Watch, Abstain) across multi-horizon checkpoints:
 * +15s, +30s, +1m, +2m, +5m, +15m, +1h, +6h, +24h.
 * Simulates executable trades at $25, $50, $100, $250, $500.
 * Separates chart return from executable return to detect Phantom Profit.
 */
export class OutcomeGroundTruthLedger {
    records = new Map();
    registerCandidate(params) {
        const record = {
            mint: params.mint,
            decision: params.decision,
            initialPriceSol: params.priceSol,
            initialMcapSol: params.mcapSol,
            initialLiquiditySol: params.liquiditySol,
            checkpoints: {},
            simulations: [],
            maxFavorableExcursionPct: 0,
            maxAdverseExcursionPct: 0,
            labels: {
                priceSuccess: false,
                executionSuccess: false,
                liquiditySurvival: true,
                strategySuccess: false,
            },
        };
        this.records.set(params.mint, record);
        return record;
    }
    recordCheckpoint(mint, checkpoint) {
        const rec = this.records.get(mint);
        if (!rec)
            return;
        rec.checkpoints[checkpoint.horizon] = checkpoint;
        if (checkpoint.chartReturnPct > rec.maxFavorableExcursionPct) {
            rec.maxFavorableExcursionPct = checkpoint.chartReturnPct;
        }
        if (checkpoint.chartReturnPct < rec.maxAdverseExcursionPct) {
            rec.maxAdverseExcursionPct = checkpoint.chartReturnPct;
        }
        // Simulate trades at $25, $50, $100, $250, $500 (Part LV)
        const sizes = [25, 50, 100, 250, 500];
        const sims = sizes.map(size => {
            const depth = checkpoint.executableDepthSol * 150; // In USD terms
            const impactBps = Math.round((size / Math.max(10, depth)) * 2000);
            const isExec = impactBps < 1500;
            const netReturn = checkpoint.chartReturnPct - (impactBps * 2) / 100 - 1.0; // Round-trip impact + 1% fee
            const phantom = checkpoint.chartReturnPct > 5.0 && netReturn <= 0;
            return {
                notionalUsd: size,
                entrySlippageBps: impactBps,
                exitSlippageBps: impactBps,
                totalFeesUsd: size * 0.01,
                netExecutableReturnPct: Number(netReturn.toFixed(2)),
                isExecutable: isExec,
                isPhantomProfit: phantom,
            };
        });
        rec.simulations = sims;
        // Update multidimensional labels (Part LVI)
        rec.labels.priceSuccess = rec.maxFavorableExcursionPct > 15.0;
        rec.labels.executionSuccess = sims.some(s => s.netExecutableReturnPct > 8.0);
        rec.labels.liquiditySurvival = checkpoint.executableDepthSol > 1.0;
        rec.labels.strategySuccess = rec.labels.priceSuccess && rec.labels.executionSuccess && rec.labels.liquiditySurvival;
    }
    getRecord(mint) {
        return this.records.get(mint);
    }
    getAllRecords() {
        return Array.from(this.records.values());
    }
}
//# sourceMappingURL=outcome-ground-truth.js.map