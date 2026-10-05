/**
 * The only permitted owner of a runtime's cross-plane identity.  Services are
 * injected here so composition is explicit and testable; this module creates
 * neither a signer nor a network client.
 */
import type { RuntimeConfigSnapshot } from './runtime-context.js';
import { UnifiedPipelineUnit } from './platform/pipeline/unified-unit.js';
import { RuntimeDivergenceAuditor } from './platform/pipeline/runtime-divergence.js';

export interface RuntimeComposition<TMarket, TExecution, TReconciliation> {
  readonly context: RuntimeConfigSnapshot;
  readonly market: TMarket;
  readonly execution: TExecution;
  readonly reconciliation: TReconciliation;
  readonly unit: UnifiedPipelineUnit;
  readonly divergenceAuditor: RuntimeDivergenceAuditor;
}

export function composePaperRuntime<TMarket, TExecution, TReconciliation>(
  parts: Omit<RuntimeComposition<TMarket, TExecution, TReconciliation>, 'unit' | 'divergenceAuditor'> & {
    unit?: UnifiedPipelineUnit;
    divergenceAuditor?: RuntimeDivergenceAuditor;
  }
): RuntimeComposition<TMarket, TExecution, TReconciliation> {
  if (parts.context.mode !== 'PAPER') {
    throw new Error('LIVE_RUNTIME_COMPOSITION_UNAVAILABLE');
  }
  const unit = parts.unit ?? new UnifiedPipelineUnit();
  const divergenceAuditor = parts.divergenceAuditor ?? new RuntimeDivergenceAuditor();
  return Object.freeze({
    ...parts,
    unit,
    divergenceAuditor,
  });
}

