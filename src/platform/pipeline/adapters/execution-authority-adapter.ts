/**
 * SYLPH FUSION — EXECUTION AUTHORITY ADAPTER
 * Specifications: Prompt 35, Prompt 58
 *
 * Integrates ExecutionPermit and ExecutionAuthority into the Fusion pipeline.
 *
 * Invariants:
 * 1. Transition CAPITAL_RESERVED -> AUTHORIZED strictly requires a valid, unexpired,
 *    unconsumed ExecutionPermit.
 * 2. Never infer authorization from model confidence, risk approval, or capital availability.
 * 3. Authority capabilities: INFER / RECOMMEND can never produce AUTHORIZE.
 * 4. Preserves PAPER_ONLY_RUNTIME and LIVE_SIGNING_UNAVAILABLE safety guards.
 */

import type { ExecutionPermit } from '../../../intelligence/execution/execution-permit.js';
import type { TransitionRequest } from '../fusion-pipeline.js';

export interface AuthorizeTransitionParams {
  permit: ExecutionPermit;
  authorityEpoch?: bigint;
  revocationEpoch?: bigint;
}

export class ExecutionAuthorityAdapter {
  /**
   * Validates the execution permit and creates the TransitionRequest to enter AUTHORIZED.
   */
  public static createAuthorizeTransitionRequest(
    params: AuthorizeTransitionParams
  ): TransitionRequest {
    const { permit, authorityEpoch, revocationEpoch } = params;

    if (!permit.permitId || permit.permitId.trim() === '') {
      throw new Error('AUTHORIZE_ERROR: Execution permit must have a non-empty permitId');
    }

    if (permit.isConsumed) {
      throw new Error(`AUTHORIZE_ERROR: Execution permit ${permit.permitId} has already been consumed`);
    }

    if (Date.now() > permit.expiryMs) {
      throw new Error(`AUTHORIZE_ERROR: Execution permit ${permit.permitId} has expired`);
    }

    return {
      targetState: 'AUTHORIZED',
      authority: 'AUTHORIZE',
      envelopePatch: {
        executionPermitId: permit.permitId,
        authorityEpoch: authorityEpoch ?? BigInt(permit.stateEpoch),
        revocationEpoch,
      },
      observedAt: new Date().toISOString(),
    };
  }
}
