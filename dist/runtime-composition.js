import { UnifiedPipelineUnit } from './platform/pipeline/unified-unit.js';
import { RuntimeDivergenceAuditor } from './platform/pipeline/runtime-divergence.js';
export function composePaperRuntime(parts) {
    if (parts.context.mode !== 'PAPER') {
        throw new Error('LIVE_RUNTIME_COMPOSITION_UNAVAILABLE');
    }
    if (parts.feed && parts.ingress) {
        if (typeof parts.feed.isIngressBound !== 'function' || !parts.feed.isIngressBound(parts.ingress)) {
            throw new Error('FEED_INGRESS_MISMATCH: Injected Feed must be bound to the exact same CanonicalIngress instance');
        }
    }
    else if (parts.feed && !parts.ingress) {
        throw new Error('FEED_REQUIRES_COMPOSITION_INGRESS: Cannot inject Feed without also injecting its CanonicalIngress');
    }
    const unit = parts.unit ?? new UnifiedPipelineUnit();
    const divergenceAuditor = parts.divergenceAuditor ?? new RuntimeDivergenceAuditor();
    return Object.freeze({
        ...parts,
        unit,
        divergenceAuditor,
    });
}
//# sourceMappingURL=runtime-composition.js.map