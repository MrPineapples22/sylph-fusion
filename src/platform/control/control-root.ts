/**
 * SYLPH FUSION — CONTROL ROOT & SUPERVISOR GOVERNANCE
 * Specifications: Blueprint Section 45
 * Workbook: #963 (Controller Lease), #971 (Preemption Fencing), #995 (Stale-Proposal Rejection)
 *
 * Invariant:
 * 1. Single active controller lease writer.
 * 2. Every action proposal binds:
 *    controlEpoch, fenceEpoch, configRoot, policyRoot, releaseRoot, revocationEpoch.
 * 3. Any proposal built against a prior epoch or expired lease is STALE_PROPOSAL.
 */

import { createHash } from 'node:crypto';

export interface ControlRootState {
  readonly controlEpoch: bigint;
  readonly fenceEpoch: bigint;
  readonly activeControllerId: string;
  readonly controllerLeaseExpiresAt: number;
  readonly configRoot: string;
  readonly policyRoot: string;
  readonly releaseRoot: string;
  readonly revocationEpoch: bigint;
  readonly digest: string;
}

export interface ProposalControlBinding {
  readonly controlEpoch: bigint;
  readonly fenceEpoch: bigint;
  readonly configRoot: string;
  readonly policyRoot: string;
  readonly releaseRoot: string;
  readonly revocationEpoch: bigint;
}

export class ControlRootManager {
  private currentState: ControlRootState;

  constructor(initialState: Omit<ControlRootState, 'digest'>) {
    this.currentState = {
      ...initialState,
      digest: ControlRootManager.computeDigest(initialState),
    };
  }

  public static computeDigest(state: Omit<ControlRootState, 'digest'>): string {
    const payload = [
      state.controlEpoch.toString(),
      state.fenceEpoch.toString(),
      state.activeControllerId,
      state.controllerLeaseExpiresAt.toString(),
      state.configRoot,
      state.policyRoot,
      state.releaseRoot,
      state.revocationEpoch.toString(),
    ].join('::');

    return createHash('sha256').update(payload).digest('hex');
  }

  public getControlRoot(): ControlRootState {
    return this.currentState;
  }

  /**
   * Renew or reassign controller lease. Increments controlEpoch.
   */
  public renewControllerLease(
    controllerId: string,
    durationMs: number,
    expectedEpoch: bigint
  ): { success: boolean; state?: ControlRootState; reason?: string } {
    if (this.currentState.controlEpoch !== expectedEpoch) {
      return {
        success: false,
        reason: `STALE_PROPOSAL: Expected controlEpoch ${this.currentState.controlEpoch}, proposed ${expectedEpoch}`,
      };
    }

    const now = Date.now();
    const nextEpoch = this.currentState.controlEpoch + 1n;
    const nextState: Omit<ControlRootState, 'digest'> = {
      ...this.currentState,
      controlEpoch: nextEpoch,
      activeControllerId: controllerId,
      controllerLeaseExpiresAt: now + durationMs,
    };

    this.currentState = {
      ...nextState,
      digest: ControlRootManager.computeDigest(nextState),
    };

    return { success: true, state: this.currentState };
  }

  /**
   * Advances the fence epoch to invalidate all in-flight proposals from prior controllers.
   */
  public advanceFenceEpoch(): ControlRootState {
    const nextFenceEpoch = this.currentState.fenceEpoch + 1n;
    const nextState: Omit<ControlRootState, 'digest'> = {
      ...this.currentState,
      fenceEpoch: nextFenceEpoch,
    };

    this.currentState = {
      ...nextState,
      digest: ControlRootManager.computeDigest(nextState),
    };

    return this.currentState;
  }

  /**
   * Validates whether a proposal is bound to the exact current control root state.
   */
  public validateProposal(binding: ProposalControlBinding): { isValid: boolean; reason?: string } {
    const now = Date.now();
    if (now > this.currentState.controllerLeaseExpiresAt) {
      return {
        isValid: false,
        reason: 'CONTROLLER_LEASE_EXPIRED: The current controller lease has expired; proposals rejected',
      };
    }

    if (binding.controlEpoch !== this.currentState.controlEpoch) {
      return {
        isValid: false,
        reason: `STALE_PROPOSAL: Proposal controlEpoch ${binding.controlEpoch} != active ${this.currentState.controlEpoch}`,
      };
    }

    if (binding.fenceEpoch !== this.currentState.fenceEpoch) {
      return {
        isValid: false,
        reason: `FENCE_PREEMPTED: Proposal fenceEpoch ${binding.fenceEpoch} != active ${this.currentState.fenceEpoch}`,
      };
    }

    if (binding.configRoot !== this.currentState.configRoot) {
      return {
        isValid: false,
        reason: `CONFIG_ROOT_MISMATCH: Proposal config ${binding.configRoot} != active ${this.currentState.configRoot}`,
      };
    }

    if (binding.policyRoot !== this.currentState.policyRoot) {
      return {
        isValid: false,
        reason: `POLICY_ROOT_MISMATCH: Proposal policy ${binding.policyRoot} != active ${this.currentState.policyRoot}`,
      };
    }

    if (binding.releaseRoot !== this.currentState.releaseRoot) {
      return {
        isValid: false,
        reason: `RELEASE_ROOT_MISMATCH: Proposal release ${binding.releaseRoot} != active ${this.currentState.releaseRoot}`,
      };
    }

    if (binding.revocationEpoch !== this.currentState.revocationEpoch) {
      return {
        isValid: false,
        reason: `REVOCATION_EPOCH_MISMATCH: Proposal revocation epoch ${binding.revocationEpoch} != active ${this.currentState.revocationEpoch}`,
      };
    }

    return { isValid: true };
  }
}
