/**
 * SOL-SYLPH 2026 Platform - Stream Integrity Authority & Chain Watermark
 *
 * Enforces continuity across WebSocket / Geyser streaming feeds:
 * - Distinguishes between LOW-LATENCY OBSERVATION vs COMPLETE HISTORY
 * - Detects slot discontinuities (Δslot > 1) and emits STREAM_GAP_DETECTED
 * - Tracks three-dimensional ChainWatermark:
 *   observed_head, confirmed_head, finalized_root, contiguous_from, contiguous_through
 * - Enforces invariant:
 *   DATA: CURRENT requires BOTH freshness acceptable AND continuity proven.
 */
export class StreamIntegrityAuthority {
    maxAllowedGapSlots;
    observedHead = 0;
    confirmedHead = 0;
    finalizedRoot = 0;
    contiguousFrom = 0;
    contiguousThrough = 0;
    blockHeight = 0;
    activeGapsCount = 0;
    lastObservedAt = 0;
    isConnected = false;
    constructor(maxAllowedGapSlots = 32) {
        this.maxAllowedGapSlots = maxAllowedGapSlots;
    }
    onStreamConnected() {
        this.isConnected = true;
    }
    onStreamDisconnected() {
        this.isConnected = false;
    }
    registerSlotNotification(notif) {
        const now = Date.now();
        this.lastObservedAt = now;
        if (notif.rootSlot && notif.rootSlot > this.finalizedRoot) {
            this.finalizedRoot = notif.rootSlot;
        }
        if (notif.blockHeight) {
            this.blockHeight = Math.max(this.blockHeight, notif.blockHeight);
        }
        let hasGap = false;
        let gapStart;
        let gapEnd;
        if (this.observedHead > 0 && notif.slot > this.observedHead + 1) {
            // Discontinuity detected
            hasGap = true;
            gapStart = this.observedHead + 1;
            gapEnd = notif.slot - 1;
            this.activeGapsCount++;
        }
        else {
            // Monotonic progression
            if (this.contiguousFrom === 0) {
                this.contiguousFrom = notif.slot;
            }
            this.contiguousThrough = notif.slot;
        }
        this.observedHead = Math.max(this.observedHead, notif.slot);
        this.confirmedHead = Math.max(this.confirmedHead, notif.slot - 1); // Confirmed is roughly 1-2 slots behind tip
        return { hasGap, gapStart, gapEnd };
    }
    markGapResolved(start, end) {
        if (this.activeGapsCount > 0) {
            this.activeGapsCount--;
        }
        this.contiguousThrough = Math.max(this.contiguousThrough, end);
    }
    getWatermark() {
        const streamIntegrity = !this.isConnected
            ? 'DISCONNECTED'
            : this.activeGapsCount > 0
                ? 'GAP_DETECTED'
                : 'CONTINUOUS';
        // Confidence drops if gaps exist or stream is disconnected
        let observationConfidence = 1.0;
        if (!this.isConnected)
            observationConfidence = 0.0;
        else if (this.activeGapsCount > 0)
            observationConfidence = 0.5;
        return {
            observedHeadSlot: this.observedHead,
            confirmedHeadSlot: this.confirmedHead,
            finalizedRootSlot: this.finalizedRoot,
            contiguousFromSlot: this.contiguousFrom,
            contiguousThroughSlot: this.contiguousThrough,
            blockHeight: this.blockHeight,
            streamIntegrity,
            observationConfidence,
            lastObservedAtMs: this.lastObservedAt,
        };
    }
    /**
     * Evaluates whether data can be considered CURRENT.
     * Invariant: Both freshness acceptable AND continuity proven.
     */
    isDataCurrent(maxAgeMs = 5000, now = Date.now()) {
        const watermark = this.getWatermark();
        if (watermark.streamIntegrity !== 'CONTINUOUS') {
            return false; // Gap detected or disconnected
        }
        const age = now - watermark.lastObservedAtMs;
        return age >= 0 && age <= maxAgeMs;
    }
}
//# sourceMappingURL=stream-integrity.js.map