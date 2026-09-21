/**
 * SOL-SYLPH Contradiction Engine & Events
 * Blueprint Part XLVIII
 *
 * Every contradictory observation generates an immutable ContradictionEvent:
 * affected thesis, affected assumption, new evidence, previous evidence,
 * severity (MINOR, MATERIAL, CRITICAL), confidence, slot, downstream actions.
 */

export type ContradictionSeverity = 'MINOR' | 'MATERIAL' | 'CRITICAL';

export interface ContradictionEvent {
  readonly eventId: string;
  readonly mint: string;
  readonly thesisId: string;
  readonly assumptionId: string;
  readonly previousEvidence: string;
  readonly newEvidence: string;
  readonly severity: ContradictionSeverity;
  readonly confidence: number;
  readonly slot: number;
  readonly timestampMs: number;
  readonly downstreamActionRequired: 'LOG_ONLY' | 'REVALIDATE_THESIS' | 'IMMEDIATE_RISK_REVOCATION';
}

export class ContradictionEngine {
  private readonly events: ContradictionEvent[] = [];

  public recordContradiction(params: {
    mint: string;
    thesisId: string;
    assumptionId: string;
    previousEvidence: string;
    newEvidence: string;
    severity: ContradictionSeverity;
    confidence?: number;
    slot?: number;
  }): ContradictionEvent {
    const now = Date.now();
    let action: 'LOG_ONLY' | 'REVALIDATE_THESIS' | 'IMMEDIATE_RISK_REVOCATION' = 'LOG_ONLY';

    if (params.severity === 'CRITICAL') {
      action = 'IMMEDIATE_RISK_REVOCATION';
    } else if (params.severity === 'MATERIAL') {
      action = 'REVALIDATE_THESIS';
    }

    const event: ContradictionEvent = {
      eventId: `contra_${params.mint.slice(0, 6)}_${now}`,
      mint: params.mint,
      thesisId: params.thesisId,
      assumptionId: params.assumptionId,
      previousEvidence: params.previousEvidence,
      newEvidence: params.newEvidence,
      severity: params.severity,
      confidence: params.confidence ?? 0.9,
      slot: params.slot ?? 0,
      timestampMs: now,
      downstreamActionRequired: action,
    };

    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
    return event;
  }

  public getEventsForToken(mint: string): readonly ContradictionEvent[] {
    return this.events.filter(e => e.mint === mint);
  }

  public hasCriticalContradictions(mint: string): boolean {
    return this.events.some(e => e.mint === mint && e.severity === 'CRITICAL');
  }
}
