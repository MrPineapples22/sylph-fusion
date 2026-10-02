/**
 * SOL-SYLPH Outcome Ground-Truth Ledger & Execution-Adjusted Outcomes
 * Blueprint Parts LIV, LV, LVI
 *
 * Tracks EVERY candidate (Approved, Rejected, Watch, Abstain) across multi-horizon checkpoints:
 * +15s, +30s, +1m, +2m, +5m, +15m, +1h, +6h, +24h.
 * Simulates executable trades at $25, $50, $100, $250, $500.
 * Separates chart return from executable return to detect Phantom Profit.
 *
 * Research-only heuristic: assumes $150/SOL, a depth-based impact approximation,
 * identical entry/exit impact and a flat 1% round-trip fee. Its success labels
 * are not evidence of historical route availability, transaction execution or fills.
 */
export class OutcomeGroundTruthLedger {
    records = new Map();
    registerCandidate(params) {
        if (!Number.isFinite(params.priceSol) || params.priceSol <= 0
            || !Number.isFinite(params.mcapSol) || params.mcapSol < 0
            || !Number.isFinite(params.liquiditySol) || params.liquiditySol < 0) {
            throw new Error('INVALID_CANDIDATE_VALUES: Expected positive finite price and nonnegative finite market cap/liquidity');
        }
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
    /** Invalid numeric evidence throws before any record changes; an unknown mint remains a no-op. */
    recordCheckpoint(mint, checkpoint) {
        const rec = this.records.get(mint);
        if (!rec)
            return;
        if (!Number.isFinite(checkpoint.priceSol) || checkpoint.priceSol <= 0
            || !Number.isFinite(checkpoint.chartReturnPct)
            || !Number.isFinite(checkpoint.executableDepthSol) || checkpoint.executableDepthSol < 0
            || !Number.isSafeInteger(checkpoint.independentActorsCount) || checkpoint.independentActorsCount < 0) {
            throw new Error('INVALID_CHECKPOINT_VALUES: Expected positive finite price, finite return, nonnegative finite depth and nonnegative safe integer actor count');
        }
        const depth = checkpoint.executableDepthSol * 150; // Research assumption, not an observed conversion.
        if (!Number.isFinite(depth))
            throw new Error('INVALID_SIMULATION_VALUES: USD depth overflow');
        // Simulate trades at $25, $50, $100, $250, $500 (Part LV)
        const sizes = [25, 50, 100, 250, 500];
        const sims = sizes.map(size => {
            const impactBps = Math.round((size / Math.max(10, depth)) * 2000);
            const isExec = impactBps < 1500;
            const netReturn = checkpoint.chartReturnPct - (impactBps * 2) / 100 - 1.0; // Round-trip impact + 1% fee
            if (!Number.isFinite(impactBps) || !Number.isFinite(netReturn)) {
                throw new Error('INVALID_SIMULATION_VALUES: Nonfinite impact or net return');
            }
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
        // Commit only after all inputs and modeled results pass validation.
        rec.checkpoints[checkpoint.horizon] = checkpoint;
        if (checkpoint.chartReturnPct > rec.maxFavorableExcursionPct) {
            rec.maxFavorableExcursionPct = checkpoint.chartReturnPct;
        }
        if (checkpoint.chartReturnPct < rec.maxAdverseExcursionPct) {
            rec.maxAdverseExcursionPct = checkpoint.chartReturnPct;
        }
        rec.simulations = sims;
        // Update multidimensional labels (Part LVI)
        rec.labels.priceSuccess = rec.maxFavorableExcursionPct > 15.0;
        rec.labels.executionSuccess = sims.some(s => s.isExecutable
            && Number.isFinite(s.netExecutableReturnPct) && s.netExecutableReturnPct > 8.0);
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