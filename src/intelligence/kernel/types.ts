/**
 * SOL-SYLPH Master Production Intelligence - Integration Kernel & Tracing Types
 * Specifications: Sections 4 (Integration Kernel), 91 (Observability),
 * 92 (Distributed Tracing), 93 (Backpressure).
 */

export type ComponentLifecycleState =
  | 'DEFINED'
  | 'INSTANTIATED'
  | 'CONNECTED'
  | 'RECEIVING'
  | 'PROCESSING'
  | 'PRODUCING'
  | 'CONSUMED'
  | 'ACTING'
  | 'LOGGED'
  | 'TESTED'
  | 'VERIFIED';

export type ComponentFailureState =
  | 'HEALTHY'
  | 'STALE'
  | 'DEGRADED'
  | 'DISCONNECTED'
  | 'FAILED'
  | 'BLOCKED'
  | 'QUARANTINED';

export type EventPriorityClass = 'P0_SAFETY_EXECUTION' | 'P1_LIVE_CANDIDATE' | 'P2_TOKEN_INGEST' | 'P3_REFRESH' | 'P4_ANALYTICS' | 'P5_GUI';

export interface ComponentRegistration {
  readonly componentId: string;
  readonly layer: string;
  readonly upstreamDependencies: readonly string[];
  readonly downstreamConsumers: readonly string[];
  lifecycleState: ComponentLifecycleState;
  failureState: ComponentFailureState;
  eventsProcessedCount: number;
  lastActiveTimestampMs: number;
  lastError?: string;
}

export interface DecisionTraceContext {
  readonly traceId: string;
  readonly eventId?: string;
  readonly snapshotId?: string;
  readonly decisionId?: string;
  readonly orderIntentId?: string;
  readonly executionId?: string;
  readonly positionId?: string;
  readonly rootTimestampMs: number;
}

export interface DecisionTraceStep {
  readonly stepName: string;
  readonly componentId: string;
  readonly timestampMs: number;
  readonly durationMs: number;
  readonly inputsHash: string;
  readonly outputsHash: string;
  /** Generic tracing is intentionally unable to confer token-safety authority. */
  readonly status: 'PASS' | 'WARN' | 'FAIL' | 'ABSTAIN' | 'BLOCK' | 'DEGRADED';
  readonly details?: Record<string, unknown>;
}
