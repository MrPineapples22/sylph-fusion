/**
 * SYLPH FUSION — ASSURANCE FABRIC: IMMUTABLE RECEIPT CHAIN
 * Specifications: Master Blueprint Section XLVI (Immutable Receipt Chain)
 *
 * Implements 8 strictly chained cryptographic receipts:
 * BuiltReceipt -> SimulationReceipt -> AuthorizationReceipt -> SigningReceipt ->
 * SubmissionReceipt -> LandingReceipt -> FinalityReceipt -> SettlementReceipt.
 *
 * Invariant: Each receipt hashes the previous receipt.
 */

import { createHash } from 'node:crypto';

export interface BaseReceipt {
  readonly receiptId: string;
  readonly stage: string;
  readonly prevReceiptHash: string;
  readonly timestampMs: number;
  readonly receiptHash: string;
}

export interface BuiltReceipt extends BaseReceipt {
  readonly stage: 'BUILT';
  readonly actionId: string;
  readonly transactionPayloadHash: string;
  readonly estimatedFeeLamports: bigint;
}

export interface SimulationReceipt extends BaseReceipt {
  readonly stage: 'SIMULATION';
  readonly simulationUnitsConsumed: number;
  readonly simulationLogsHash: string;
  readonly simulationSuccess: boolean;
}

export interface AuthorizationReceipt extends BaseReceipt {
  readonly stage: 'AUTHORIZATION';
  readonly kernelAuthorizationDecision: 'ALLOW' | 'DENY';
  readonly kernelDecisionHash: string;
  readonly permitNonce: string;
}

export interface SigningReceipt extends BaseReceipt {
  readonly stage: 'SIGNING';
  readonly keyId: string;
  readonly wireTransactionHash: string;
  readonly signatureAttestation: string;
}

export interface SubmissionReceipt extends BaseReceipt {
  readonly stage: 'SUBMISSION';
  readonly transport: 'DIRECT_RPC' | 'DIRECT_TPU' | 'JITO_SINGLE_TX_BUNDLE' | 'JITO_MULTI_TX_BUNDLE';
  readonly submissionEndpoint: string;
  readonly targetSlot: bigint;
}

export interface LandingReceipt extends BaseReceipt {
  readonly stage: 'LANDING';
  readonly landedSlot: bigint;
  readonly landedBlockhash: string;
  readonly transactionSignature: string;
}

export interface FinalityReceipt extends BaseReceipt {
  readonly stage: 'FINALITY';
  readonly finalityLevel: 'FINALIZED';
  readonly finalizedSlot: bigint;
  readonly confirmationLagSlots: number;
}

export interface SettlementReceipt extends BaseReceipt {
  readonly stage: 'SETTLEMENT';
  readonly realizedNetPnLLamports: bigint;
  readonly netCashChangeLamports: bigint;
  readonly inventoryChangeRaw: bigint;
  readonly totalFeesPaidLamports: bigint;
  readonly economicPostingRoot: string;
}

export class ImmutableReceiptChain {
  private static readonly GENESIS_PREV_HASH = '0'.repeat(64);
  private receipts: BaseReceipt[] = [];

  public getChain(): readonly BaseReceipt[] {
    return Object.freeze([...this.receipts]);
  }

  public getLatestReceipt(): BaseReceipt | undefined {
    return this.receipts[this.receipts.length - 1];
  }

  private computeHash(payload: Record<string, unknown>, prevHash: string, stage: string, timestampMs: number): string {
    const serialized = JSON.stringify(payload, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
    return createHash('sha256').update(`${stage}:${prevHash}:${timestampMs}:${serialized}`).digest('hex');
  }

  public recordBuilt(params: Omit<BuiltReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): BuiltReceipt {
    const prevReceiptHash = this.receipts.length > 0 ? this.receipts[this.receipts.length - 1]!.receiptHash : ImmutableReceiptChain.GENESIS_PREV_HASH;
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prevReceiptHash, 'BUILT', timestampMs);
    const receipt: BuiltReceipt = {
      ...params,
      stage: 'BUILT',
      prevReceiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_built_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordSimulation(params: Omit<SimulationReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): SimulationReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'BUILT') throw new Error('CHAIN_ORDER_ERROR: SimulationReceipt requires prior BuiltReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'SIMULATION', timestampMs);
    const receipt: SimulationReceipt = {
      ...params,
      stage: 'SIMULATION',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_sim_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordAuthorization(params: Omit<AuthorizationReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): AuthorizationReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'SIMULATION') throw new Error('CHAIN_ORDER_ERROR: AuthorizationReceipt requires prior SimulationReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'AUTHORIZATION', timestampMs);
    const receipt: AuthorizationReceipt = {
      ...params,
      stage: 'AUTHORIZATION',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_auth_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordSigning(params: Omit<SigningReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): SigningReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'AUTHORIZATION') throw new Error('CHAIN_ORDER_ERROR: SigningReceipt requires prior AuthorizationReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'SIGNING', timestampMs);
    const receipt: SigningReceipt = {
      ...params,
      stage: 'SIGNING',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_sign_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordSubmission(params: Omit<SubmissionReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): SubmissionReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'SIGNING') throw new Error('CHAIN_ORDER_ERROR: SubmissionReceipt requires prior SigningReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'SUBMISSION', timestampMs);
    const receipt: SubmissionReceipt = {
      ...params,
      stage: 'SUBMISSION',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_sub_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordLanding(params: Omit<LandingReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): LandingReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'SUBMISSION') throw new Error('CHAIN_ORDER_ERROR: LandingReceipt requires prior SubmissionReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'LANDING', timestampMs);
    const receipt: LandingReceipt = {
      ...params,
      stage: 'LANDING',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_land_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordFinality(params: Omit<FinalityReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): FinalityReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'LANDING') throw new Error('CHAIN_ORDER_ERROR: FinalityReceipt requires prior LandingReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'FINALITY', timestampMs);
    const receipt: FinalityReceipt = {
      ...params,
      stage: 'FINALITY',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_fin_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public recordSettlement(params: Omit<SettlementReceipt, 'receiptId' | 'stage' | 'prevReceiptHash' | 'timestampMs' | 'receiptHash'>): SettlementReceipt {
    const prev = this.getLatestReceipt();
    if (!prev || prev.stage !== 'FINALITY') throw new Error('CHAIN_ORDER_ERROR: SettlementReceipt requires prior FinalityReceipt');
    const timestampMs = Date.now();
    const receiptHash = this.computeHash(params as unknown as Record<string, unknown>, prev.receiptHash, 'SETTLEMENT', timestampMs);
    const receipt: SettlementReceipt = {
      ...params,
      stage: 'SETTLEMENT',
      prevReceiptHash: prev.receiptHash,
      timestampMs,
      receiptHash,
      receiptId: `rcpt_settle_${receiptHash.slice(0, 16)}`,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  public verifyIntegrity(): { isValid: boolean; brokenIndex?: number; reason?: string } {
    for (let i = 0; i < this.receipts.length; i++) {
      const receipt = this.receipts[i]!;
      const expectedPrev = i === 0 ? ImmutableReceiptChain.GENESIS_PREV_HASH : this.receipts[i - 1]!.receiptHash;
      if (receipt.prevReceiptHash !== expectedPrev) {
        return { isValid: false, brokenIndex: i, reason: `PREV_HASH_MISMATCH at index ${i}` };
      }
    }
    return { isValid: true };
  }
}
