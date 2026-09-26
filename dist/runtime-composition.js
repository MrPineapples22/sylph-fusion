export function composePaperRuntime(parts) {
    if (parts.context.mode !== 'PAPER') {
        throw new Error('LIVE_RUNTIME_COMPOSITION_UNAVAILABLE');
    }
    return Object.freeze({ ...parts });
}
//# sourceMappingURL=runtime-composition.js.map