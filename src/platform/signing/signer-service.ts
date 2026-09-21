/**
 * SOL-SYLPH Multi-User Platform - Zero-Trust Signing Service
 * Specifications: Sections XLI (Zero-Trust Signing), XLII (Authorization Domains),
 * XLIV (Idempotent Transactions).
 *
 * Rules:
 * 1. Application/Strategy code NEVER has access to raw private keys.
 * 2. Every signature request is validated against strict domain policies.
 * 3. Domain separation: TRADING cannot sign arbitrary transfer instructions.
 * 4. Idempotent transaction tracking: A confirmed tx can never be blindly signed/resubmitted.
 */

import { createHash } from 'node:crypto';
import type {
  AuthorizationDomain,
  SigningRequest,
  SigningPolicy,
  SignatureResult,
  TransactionLifecycleState,
} from './types.js';

export interface IdempotentTxRecord {
  readonly transactionId: string;
  readonly domain: AuthorizationDomain;
  readonly vaultId: string;
  state: TransactionLifecycleState;
  signature?: string;
  submittedAt?: number;
  confirmedAt?: number;
  failedAt?: number;
  failureReason?: string;
}

export class ZeroTrustSignerService {
  private readonly policies: Map<AuthorizationDomain, SigningPolicy> = new Map();
  private readonly txRegistry: Map<string, IdempotentTxRecord> = new Map();
  private emergencyHalt = false;

  constructor() {
    // Default strict domain policies
    this.policies.set('TRADING', {
      maxAmountLamportsPerTx: 50_000_000_000n, // 50 SOL ceiling per single order
      allowedProgramIds: [
        '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
        'ComputeBudget111111111111111111111111111111', // Compute Budget
      ],
      emergencyHaltActive: false,
      requireReconciliationClean: true,
    });

    this.policies.set('SETTLEMENT', {
      maxAmountLamportsPerTx: 1_000_000_000_000n, // 1000 SOL ceiling
      allowedProgramIds: [
        '11111111111111111111111111111111', // System Program
      ],
      emergencyHaltActive: false,
      requireReconciliationClean: true,
    });

    this.policies.set('TREASURY', {
      maxAmountLamportsPerTx: 500_000_000_000n,
      allowedProgramIds: ['11111111111111111111111111111111'],
      emergencyHaltActive: false,
      requireReconciliationClean: true,
    });

    this.policies.set('EMERGENCY_OPERATIONS', {
      maxAmountLamportsPerTx: 1_000_000_000_000n,
      allowedProgramIds: ['11111111111111111111111111111111'],
      emergencyHaltActive: false,
      requireReconciliationClean: false,
    });
  }

  public setEmergencyHalt(active: boolean): void {
    this.emergencyHalt = active;
  }

  public isEmergencyHaltActive(): boolean {
    return this.emergencyHalt;
  }

  /**
   * Authorize and produce an idempotent signature for a request.
   */
  public signTransaction(
    request: SigningRequest,
    isReconciliationClean: boolean
  ): { success: true; result: SignatureResult } | { success: false; error: string } {
    if (this.emergencyHalt) {
      return { success: false, error: 'Signer rejected: Global emergency halt active' };
    }

    // Idempotency check
    const existing = this.txRegistry.get(request.transactionId);
    if (existing) {
      if (existing.state === 'CONFIRMED') {
        return {
          success: false,
          error: `Signer rejected: Transaction ${request.transactionId} is already CONFIRMED on chain`,
        };
      }
      if (existing.state === 'SIGNED' || existing.state === 'SUBMITTED') {
        return {
          success: false,
          error: `Signer rejected: Transaction ${request.transactionId} is already in state ${existing.state}. Re-signing blocked to prevent double-broadcast.`,
        };
      }
    }

    // Policy check
    const policy = this.policies.get(request.domain);
    if (!policy) {
      return { success: false, error: `Signer rejected: Unknown domain ${request.domain}` };
    }

    if (policy.requireReconciliationClean && !isReconciliationClean) {
      return {
        success: false,
        error: `Signer rejected: Reconciliation is not clean for domain ${request.domain}`,
      };
    }

    if (request.amountLamports > policy.maxAmountLamportsPerTx) {
      return {
        success: false,
        error: `Signer rejected: Amount ${request.amountLamports} exceeds policy max ${policy.maxAmountLamportsPerTx}`,
      };
    }

    // Domain target restrictions: TRADING can only invoke authorized DEX/Token programs
    if (request.domain === 'TRADING') {
      if (!policy.allowedProgramIds.includes(request.targetProgramId)) {
        return {
          success: false,
          error: `Signer rejected: Program ${request.targetProgramId} not allowed in TRADING domain`,
        };
      }
      // TRADING domain cannot transfer direct SOL to external destinations
      if (request.destinationAddress && request.targetProgramId === '11111111111111111111111111111111') {
        return {
          success: false,
          error: 'Signer rejected: Direct external SOL transfers prohibited in TRADING domain',
        };
      }
    }

    // Produce deterministic simulated or cryptographic signature
    const sigHash = createHash('sha256')
      .update(request.transactionId)
      .update(request.domain)
      .update(request.vaultId)
      .update(request.serializedMessage)
      .digest('hex');

    const result: SignatureResult = {
      transactionId: request.transactionId,
      signature: `sig_${sigHash}`,
      signedAt: Date.now(),
      domain: request.domain,
    };

    // Register / update transaction state
    this.txRegistry.set(request.transactionId, {
      transactionId: request.transactionId,
      domain: request.domain,
      vaultId: request.vaultId,
      state: 'SIGNED',
      signature: result.signature,
    });

    return { success: true, result };
  }

  public recordSubmission(transactionId: string): void {
    const record = this.txRegistry.get(transactionId);
    if (record && record.state === 'SIGNED') {
      record.state = 'SUBMITTED';
      record.submittedAt = Date.now();
    }
  }

  public recordConfirmation(transactionId: string): void {
    const record = this.txRegistry.get(transactionId);
    if (record) {
      record.state = 'CONFIRMED';
      record.confirmedAt = Date.now();
    }
  }

  public recordFailure(transactionId: string, reason: string): void {
    const record = this.txRegistry.get(transactionId);
    if (record) {
      record.state = 'FAILED';
      record.failedAt = Date.now();
      record.failureReason = reason;
    }
  }

  public getTxRecord(transactionId: string): IdempotentTxRecord | undefined {
    return this.txRegistry.get(transactionId);
  }
}
