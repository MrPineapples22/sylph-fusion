/**
 * SOL-SYLPH Intelligence Fabric - Three Clock Model
 * Specifications: Section 4 (Three Clock Model: Chain Clock, Market Clock, Execution Clock).
 *
 * Rules:
 * 1. Chain Clock: Authoritative Solana slot, slot commitment, and validator block time.
 * 2. Market Clock: External feed observation time, exchange tick arrival time.
 * 3. Execution Clock: Monotonic high-resolution process time, CPU latency, deadline timeouts.
 * 4. Never conflate or treat these three clocks as equivalent.
 */
export class ThreeClocks {
    latestSlot = 0;
    latestCommitment = 'processed';
    slotAnchorTimeMs = Date.now();
    slotAnchor = 0;
    updateChainSlot(slot, commitment = 'confirmed') {
        this.latestSlot = slot;
        this.latestCommitment = commitment;
        this.slotAnchor = slot;
        this.slotAnchorTimeMs = Date.now();
    }
    captureSnapshot(observationTimeMs, arrivalTimeMs = Date.now()) {
        const now = Date.now();
        const elapsedSinceAnchor = now - this.slotAnchorTimeMs;
        const estimatedSlot = this.slotAnchor + Math.floor(elapsedSinceAnchor / 400);
        const chainClock = {
            currentSlot: Math.max(this.latestSlot, estimatedSlot),
            commitment: this.latestCommitment,
            estimatedBlockTimeMs: this.slotAnchorTimeMs + Math.floor(elapsedSinceAnchor / 400) * 400,
            slotDurationMs: 400,
        };
        const marketClock = {
            observationTimestampMs: observationTimeMs,
            arrivalTimestampMs: arrivalTimeMs,
            feedAgeMs: Math.max(0, arrivalTimeMs - observationTimeMs),
        };
        const executionClock = {
            monotonicTimeNs: process.hrtime.bigint(),
            processUptimeMs: Math.round(process.uptime() * 1000),
            eventLoopLagMs: Math.max(0, now - arrivalTimeMs),
        };
        const clockSkewMs = Math.abs(chainClock.estimatedBlockTimeMs - marketClock.arrivalTimestampMs);
        return {
            chainClock,
            marketClock,
            executionClock,
            clockSkewMs,
            capturedAtMs: now,
        };
    }
}
//# sourceMappingURL=three-clocks.js.map