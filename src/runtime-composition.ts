/**
 * The only permitted owner of a runtime's cross-plane identity.  Services are
 * injected here so composition is explicit and testable; this module creates
 * neither a signer nor a network client.
 */
import type { RuntimeConfigSnapshot } from './runtime-context.js';

export interface RuntimeComposition<TMarket, TExecution, TReconciliation> {
  readonly context: RuntimeConfigSnapshot;
  readonly market: TMarket;
  readonly execution: TExecution;
  readonly reconciliation: TReconciliation;
}

export function composePaperRuntime<TMarket, TExecution, TReconciliation>(parts: RuntimeComposition<TMarket, TExecution, TReconciliation>): RuntimeComposition<TMarket, TExecution, TReconciliation> {
  if (parts.context.mode !== 'PAPER') {
    throw new Error('LIVE_RUNTIME_COMPOSITION_UNAVAILABLE');
  }
  return Object.freeze({...parts});
}
