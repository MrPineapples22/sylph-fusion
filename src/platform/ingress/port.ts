/**
 * SYLPH FUSION — INGRESS PORT & OBSERVATION SOURCE CONTRACTS
 * Specifications: Frozen Architecture Execution Step 1 (Sections 12, 13)
 *
 * Guarantees:
 * 1. ObservationIngressPort accepts UnvalidatedObservation and returns IngressReceipt.
 * 2. ObservationSource boundary provides read-only ingestion access.
 * 3. Observation sources are strictly forbidden from receiving or importing Engine,
 *    RiskAuthority, EconomicAuthorityStore, ExecutionEngine, Signer, Transport,
 *    ActionProofBundleBuilder, CanonicalReducer, or writable state roots.
 */

import type { UnvalidatedObservation, IngressReceipt } from './types.js';

export interface ObservationIngressPort {
  /**
   * Submits an unvalidated observation to the canonical ingress door.
   * Returns an IngressReceipt distinguishing ACCEPTED, DUPLICATE, or REJECTED.
   */
  submit(observation: UnvalidatedObservation): Promise<IngressReceipt>;
}

export interface ObservationSource {
  readonly sourceId: string;
  /**
   * Starts stream emission into the provided ingress port sink.
   * Providers must never have access to execution, signing, risk, or state writer engines.
   */
  start(sink: ObservationIngressPort, signal: AbortSignal): Promise<void>;
  stop(): Promise<void>;
}
