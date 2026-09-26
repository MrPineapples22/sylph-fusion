/**
 * SOL-SYLPH Master Production Intelligence - Central Integration Kernel
 * Specifications: Section 4 (Build an Integration Kernel).
 *
 * Rules:
 * 1. Do not consider a component integrated merely because its class can be instantiated.
 * 2. Prove actual data traverses it (RECEIVING -> PROCESSING -> PRODUCING -> CONSUMED -> ACTING).
 * 3. Track dependency graph and failure states.
 */
export class IntegrationKernel {
    registry = new Map();
    registerComponent(params) {
        const reg = {
            componentId: params.componentId,
            layer: params.layer,
            upstreamDependencies: params.upstreamDependencies ?? [],
            downstreamConsumers: params.downstreamConsumers ?? [],
            lifecycleState: 'INSTANTIATED',
            failureState: 'HEALTHY',
            eventsProcessedCount: 0,
            lastActiveTimestampMs: Date.now(),
        };
        this.registry.set(params.componentId, reg);
        return reg;
    }
    updateLifecycleState(componentId, state) {
        const reg = this.registry.get(componentId);
        if (!reg)
            return;
        reg.lifecycleState = state;
        reg.lastActiveTimestampMs = Date.now();
    }
    recordDataPassage(componentId, action) {
        const reg = this.registry.get(componentId);
        if (!reg)
            return;
        reg.eventsProcessedCount += 1;
        reg.lastActiveTimestampMs = Date.now();
        switch (action) {
            case 'RECEIVE':
                if (reg.lifecycleState === 'INSTANTIATED' || reg.lifecycleState === 'CONNECTED') {
                    reg.lifecycleState = 'RECEIVING';
                }
                break;
            case 'PROCESS':
                reg.lifecycleState = 'PROCESSING';
                break;
            case 'PRODUCE':
                reg.lifecycleState = 'PRODUCING';
                break;
            case 'CONSUME':
                reg.lifecycleState = 'CONSUMED';
                break;
            case 'ACT':
                reg.lifecycleState = 'ACTING';
                break;
        }
    }
    setFailureState(componentId, failure, reason) {
        const reg = this.registry.get(componentId);
        if (!reg)
            return;
        reg.failureState = failure;
        reg.lastError = reason;
        reg.lastActiveTimestampMs = Date.now();
    }
    getComponent(componentId) {
        return this.registry.get(componentId);
    }
    generateIntegrationScorecard() {
        let fullyVerified = 0;
        let active = 0;
        let degraded = 0;
        const unconsumed = [];
        for (const reg of this.registry.values()) {
            if (reg.failureState !== 'HEALTHY')
                degraded += 1;
            if (reg.eventsProcessedCount > 0)
                active += 1;
            if (reg.lifecycleState === 'VERIFIED')
                fullyVerified += 1;
            if (reg.lifecycleState !== 'CONSUMED' && reg.lifecycleState !== 'ACTING' && reg.lifecycleState !== 'VERIFIED') {
                unconsumed.push(reg.componentId);
            }
        }
        return {
            totalComponents: this.registry.size,
            fullyVerifiedCount: fullyVerified,
            activeCount: active,
            degradedOrFailedCount: degraded,
            untestedOrUnconsumed: unconsumed,
        };
    }
}
//# sourceMappingURL=integration-kernel.js.map