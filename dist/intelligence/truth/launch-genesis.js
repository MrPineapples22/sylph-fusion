/**
 * SOL-SYLPH Launch Genesis Engine
 * Blueprint Part VIII
 *
 * Tracks the exact genesis lifecycle from mint creation to earliest executable route.
 * Measures detection latencies and targets: EARLIEST DEFENSIBLE DECISION.
 */
export class LaunchGenesisEngine {
    records = new Map();
    initializeGenesis(mint, slot, blockTimeMs, programType = 'SPL_TOKEN') {
        const now = Date.now();
        const mintLatency = Math.max(0, now - blockTimeMs);
        const record = {
            mint,
            programType,
            stages: {
                mintCreation: {
                    stage: 'MINT_CREATION',
                    slot,
                    blockTimeMs,
                    detectedAtMs: now,
                    detectionLatencyMs: mintLatency,
                },
            },
            mintDetectionLatencyMs: mintLatency,
            poolDetectionLatencyMs: 0,
            firstTradeDetectionLatencyMs: 0,
            routeDetectionLatencyMs: 0,
            verificationLatencyMs: 0,
            earliestDefensibleDecisionMs: 0,
            isGenesisComplete: false,
        };
        this.records.set(mint, record);
        return record;
    }
    recordPoolCreation(mint, slot, blockTimeMs, signature) {
        const rec = this.records.get(mint);
        if (!rec)
            return;
        const now = Date.now();
        const latency = Math.max(0, now - blockTimeMs);
        rec.stages['poolCreation'] = {
            stage: 'POOL_CREATION',
            slot,
            blockTimeMs,
            detectedAtMs: now,
            detectionLatencyMs: latency,
            signature,
        };
        rec.poolDetectionLatencyMs = latency;
    }
    recordFirstTrade(mint, slot, blockTimeMs, signature) {
        const rec = this.records.get(mint);
        if (!rec)
            return;
        const now = Date.now();
        const latency = Math.max(0, now - blockTimeMs);
        rec.stages['firstTrade'] = {
            stage: 'FIRST_TRADE',
            slot,
            blockTimeMs,
            detectedAtMs: now,
            detectionLatencyMs: latency,
            signature,
        };
        rec.firstTradeDetectionLatencyMs = latency;
    }
    recordExecutableRoute(mint, slot, blockTimeMs) {
        const rec = this.records.get(mint);
        if (!rec)
            return;
        const now = Date.now();
        const latency = Math.max(0, now - blockTimeMs);
        rec.stages['routeFormation'] = {
            stage: 'ROUTE_FORMATION',
            slot,
            blockTimeMs,
            detectedAtMs: now,
            detectionLatencyMs: latency,
        };
        rec.routeDetectionLatencyMs = latency;
    }
    recordVerificationComplete(mint) {
        const rec = this.records.get(mint);
        if (!rec)
            return;
        const now = Date.now();
        const mintStage = rec.stages['mintCreation'];
        const vLatency = mintStage ? now - mintStage.detectedAtMs : 50;
        rec.verificationLatencyMs = vLatency;
        rec.earliestDefensibleDecisionMs = now;
        rec.isGenesisComplete = true;
    }
    getRecord(mint) {
        return this.records.get(mint);
    }
}
//# sourceMappingURL=launch-genesis.js.map