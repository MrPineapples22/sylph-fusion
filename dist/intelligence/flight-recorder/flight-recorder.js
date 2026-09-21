/**
 * SYLPH FORENSIC FLIGHT RECORDER
 * Parts LXXIII & LXXXVI — Bounded Forensic Telemetry & Secret Sanitization
 *
 * Maintains a fixed-capacity circular buffer recording critical economic decisions,
 * invariant trips, revocations, and reconciliation failures without storing private keys.
 */
export class ForensicFlightRecorder {
    buffer = [];
    maxCapacity;
    constructor(maxCapacity = 500) {
        this.maxCapacity = maxCapacity;
    }
    /**
     * Redacts secret keys or base58 private keys from telemetry (Part LXXXVI).
     */
    sanitizeMetadata(data) {
        const sanitized = {};
        for (const [key, value] of Object.entries(data)) {
            if (/key|secret|seed|priv/i.test(key)) {
                sanitized[key] = '[REDACTED_SECRET]';
            }
            else if (typeof value === 'string' && value.length > 60 && !value.includes(' ')) {
                // Redact potential base58 raw key strings
                sanitized[key] = value.slice(0, 8) + '...[REDACTED]';
            }
            else if (typeof value === 'object' && value !== null) {
                sanitized[key] = this.sanitizeMetadata(value);
            }
            else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    record(params) {
        const id = `flt_${Date.now()}_${this.buffer.length + 1}`;
        const cleanMeta = this.sanitizeMetadata(params.metadata ?? {});
        const record = {
            record_id: id,
            event_category: params.category,
            message: params.message,
            metadata: cleanMeta,
            slot: params.slot,
            timestamp_ms: Date.now(),
        };
        if (this.buffer.length >= this.maxCapacity) {
            this.buffer.shift(); // circular eviction
        }
        this.buffer.push(record);
        return record;
    }
    recordViolation(params) {
        return this.record({
            category: 'INVARIANT_VIOLATION',
            message: `Invariant trip [${params.severity}]: ${params.invariant_id} - ${params.details}`,
            slot: params.slot,
            metadata: params.context,
        });
    }
    getRecentRecords(count = 50) {
        return this.buffer.slice(-count);
    }
}
//# sourceMappingURL=flight-recorder.js.map