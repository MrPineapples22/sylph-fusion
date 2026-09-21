/**
 * SYLPH FORENSIC FLIGHT RECORDER
 * Parts LXXIII & LXXXVI — Bounded Forensic Telemetry & Secret Sanitization
 *
 * Maintains a fixed-capacity circular buffer recording critical economic decisions,
 * invariant trips, revocations, and reconciliation failures without storing private keys.
 */

export interface FlightRecord {
  readonly record_id: string;
  readonly event_category: 'INVARIANT_VIOLATION' | 'REVOCATION' | 'SIGNATURE' | 'FAILED_EXIT' | 'UNKNOWN_TX' | 'AUTHORITY_DOWNGRADE' | 'RECONCILIATION';
  readonly message: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly slot: number;
  readonly timestamp_ms: number;
}

export class ForensicFlightRecorder {
  private readonly buffer: FlightRecord[] = [];
  private readonly maxCapacity: number;

  constructor(maxCapacity = 500) {
    this.maxCapacity = maxCapacity;
  }

  /**
   * Redacts secret keys or base58 private keys from telemetry (Part LXXXVI).
   */
  private sanitizeMetadata(data: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (/key|secret|seed|priv/i.test(key)) {
        sanitized[key] = '[REDACTED_SECRET]';
      } else if (typeof value === 'string' && value.length > 60 && !value.includes(' ')) {
        // Redact potential base58 raw key strings
        sanitized[key] = value.slice(0, 8) + '...[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeMetadata(value as Record<string, unknown>);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  public record(params: {
    category: FlightRecord['event_category'];
    message: string;
    slot: number;
    metadata?: Record<string, unknown>;
  }): FlightRecord {
    const id = `flt_${Date.now()}_${this.buffer.length + 1}`;
    const cleanMeta = this.sanitizeMetadata(params.metadata ?? {});

    const record: FlightRecord = {
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

  public recordViolation(params: {
    invariant_id: string;
    severity: 'FATAL' | 'CRITICAL' | 'WARNING';
    details: string;
    slot: number;
    context?: Record<string, unknown>;
  }): FlightRecord {
    return this.record({
      category: 'INVARIANT_VIOLATION',
      message: `Invariant trip [${params.severity}]: ${params.invariant_id} - ${params.details}`,
      slot: params.slot,
      metadata: params.context,
    });
  }

  public getRecentRecords(count = 50): readonly FlightRecord[] {
    return this.buffer.slice(-count);
  }
}
