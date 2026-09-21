/**
 * SOL-SYLPH Master Production Intelligence - Central Integration Kernel
 * Specifications: Section 4 (Build an Integration Kernel).
 *
 * Rules:
 * 1. Do not consider a component integrated merely because its class can be instantiated.
 * 2. Prove actual data traverses it (RECEIVING -> PROCESSING -> PRODUCING -> CONSUMED -> ACTING).
 * 3. Track dependency graph and failure states.
 */

import type {
  ComponentRegistration,
  ComponentLifecycleState,
  ComponentFailureState,
} from './types.js';

export class IntegrationKernel {
  private readonly registry = new Map<string, ComponentRegistration>();

  public registerComponent(params: {
    componentId: string;
    layer: string;
    upstreamDependencies?: readonly string[];
    downstreamConsumers?: readonly string[];
  }): ComponentRegistration {
    const reg: ComponentRegistration = {
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

  public updateLifecycleState(
    componentId: string,
    state: ComponentLifecycleState
  ): void {
    const reg = this.registry.get(componentId);
    if (!reg) return;
    reg.lifecycleState = state;
    reg.lastActiveTimestampMs = Date.now();
  }

  public recordDataPassage(
    componentId: string,
    action: 'RECEIVE' | 'PROCESS' | 'PRODUCE' | 'CONSUME' | 'ACT'
  ): void {
    const reg = this.registry.get(componentId);
    if (!reg) return;

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

  public setFailureState(componentId: string, failure: ComponentFailureState, reason?: string): void {
    const reg = this.registry.get(componentId);
    if (!reg) return;
    reg.failureState = failure;
    reg.lastError = reason;
    reg.lastActiveTimestampMs = Date.now();
  }

  public getComponent(componentId: string): ComponentRegistration | undefined {
    return this.registry.get(componentId);
  }

  public generateIntegrationScorecard(): {
    totalComponents: number;
    fullyVerifiedCount: number;
    activeCount: number;
    degradedOrFailedCount: number;
    untestedOrUnconsumed: readonly string[];
  } {
    let fullyVerified = 0;
    let active = 0;
    let degraded = 0;
    const unconsumed: string[] = [];

    for (const reg of this.registry.values()) {
      if (reg.failureState !== 'HEALTHY') degraded += 1;
      if (reg.eventsProcessedCount > 0) active += 1;
      if (reg.lifecycleState === 'VERIFIED') fullyVerified += 1;
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
