import { UnifiedPipelineUnit } from './platform/pipeline/unified-unit.js';
export function composePaperRuntime(parts) {
    if (parts.context.mode !== 'PAPER') {
        throw new Error('LIVE_RUNTIME_COMPOSITION_UNAVAILABLE');
    }
    const unit = parts.unit ?? new UnifiedPipelineUnit();
    return Object.freeze({
        ...parts,
        unit,
    });
}
//# sourceMappingURL=runtime-composition.js.map