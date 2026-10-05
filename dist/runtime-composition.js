import { UnifiedPipelineUnit } from './platform/pipeline/unified-unit.js';
import { RuntimeDivergenceAuditor } from './platform/pipeline/runtime-divergence.js';
export function composePaperRuntime(parts) {
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
//# sourceMappingURL=runtime-composition.js.map