/**
 * Dual-Path Protocol Reconciliation Engine & Conflicting Trade Discrepancy Firewall.
 *
 * Inspired by Sol Parser SDK (0xfnzero, merger.rs, unified_parser.rs), Richat
 * (lamports-dev, pubsub/tracker.rs) and Yellowstone gRPC (rpcpool, dedup.rs).
 *
 * Core Invariants:
 * 1. Independent Dual-Path Evidence: Instructions and logs provide distinct observations.
 * 2. Protocol-Aware Discrepancy Detection: If instructions and logs disagree on token mint,
 *    protocol, user account, or execution amounts, the engine NEVER forges a consensus or
 *    synthesizes a compromise. It flags DISCREPANCY_CONFLICT and retains both raw traces.
 * 3. Bounded Replay Coordination: Replay buffers are strictly bounded to prevent memory growth.
 *    Incomplete bank records (lacking blockhash, bank footer, or required finality) are discarded
 *    rather than masquerading as complete historical replay.
 * 4. Research Only: Diagnostic evidence only; confers no execution or signer authority.
 */

import { createHash } from 'node:crypto';
import type { DEXProtocol } from './dex-stream-parser.js';

export interface InstructionEvidence {
  readonly protocol: DEXProtocol;
  readonly programId: string;
  readonly instructionIndex: number;
  readonly innerInstructionIndex?: number | null;
  readonly tokenMint: string;
  readonly userPubkey: string;
  readonly discriminator: string;
  readonly rawAmountIn: bigint;
  readonly rawAmountOut: bigint;
  readonly slot: number;
  readonly signature: string;
  readonly isSuccess: boolean;
}

export interface LogEvidence {
  readonly protocol: DEXProtocol;
  readonly programId: string;
  readonly logIndex: number;
  readonly tokenMint: string;
  readonly userPubkey?: string | null;
  readonly logDiscriminator?: string | null;
  readonly rawAmountIn?: bigint | null;
  readonly rawAmountOut?: bigint | null;
  readonly logMessage: string;
  readonly slot: number;
  readonly signature: string;
  readonly isSuccess?: boolean | null;
}

export type DualPathReconciliationStatus =
  | 'UNIFIED_MATCH'
  | 'INSTRUCTION_ONLY'
  | 'LOG_ONLY'
  | 'PARTIAL_MATCH'
  | 'FAILED_TRANSACTION'
  | 'DISCREPANCY_CONFLICT'
  | 'AMBIGUOUS_MULTI_HOP'
  | 'MALFORMED_EVIDENCE';

export interface DualPathReconciliationReport {
  readonly status: DualPathReconciliationStatus;
  readonly isConflicted: boolean;
  readonly conflictReason: string | null;
  readonly slot: number;
  readonly signature: string | null;
  readonly tokenMint: string | null;
  readonly reconciledProtocol: DEXProtocol;
  readonly reconciledAmountIn: bigint | null;
  readonly reconciledAmountOut: bigint | null;
  readonly instructionEvidence: InstructionEvidence | null;
  readonly logEvidence: LogEvidence | null;
  readonly reconciliationHash: string;
  readonly evaluatedAtMs: number;
}

export interface DualPathReconciliationCertificate {
  readonly certificateId: string;
  readonly status: DualPathReconciliationStatus;
  readonly hasDualPathAgreement: boolean;
  readonly isApproved: boolean;
  readonly isConflicted: boolean;
  readonly rejectionReason: string | null;
  readonly slot: number;
  readonly signature: string | null;
  readonly certificateHash: string;
  readonly authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY';
  readonly evidenceSource: 'CALLER_SUPPLIED_UNAUTHENTICATED';
}

export interface BankIdentity {
  readonly slot: number;
  readonly blockhash: string;
  readonly isFinalized: boolean;
  readonly hasBankFooter: boolean;
}

export interface ReplayBatch<T> {
  readonly bank: BankIdentity;
  readonly items: readonly T[];
  readonly batchDigest: string;
}

export interface DualPathReconcilerConfig {
  readonly maxReplayQueueSize?: number;
  readonly maxReplayItemsPerBatch?: number;
  readonly maxReplayBytesPerBatch?: number;
  readonly requireFinalizedBanks?: boolean;
}

const supportedProtocols = new Set<DEXProtocol>(['PUMP_FUN', 'RAYDIUM_AMM_V4', 'METEORA_DLMM', 'WHIRLPOOL_ORCA']);

function evidenceHash(tag: string, instruction: unknown, log: unknown): string {
  let payload: string;
  try {
    payload = JSON.stringify({ tag, instruction, log }, (_, value) => typeof value === 'bigint' ? value.toString() : value);
  } catch {
    payload = JSON.stringify({ tag, evidence: 'UNSERIALIZABLE' });
  }
  return createHash('sha256').update(payload).digest('hex');
}

function reportFingerprint(report: DualPathReconciliationReport): string {
  return evidenceHash('RECONCILIATION_REPORT', {
    status: report.status,
    isConflicted: report.isConflicted,
    conflictReason: report.conflictReason,
    slot: report.slot,
    signature: report.signature,
    tokenMint: report.tokenMint,
    reconciledProtocol: report.reconciledProtocol,
    reconciledAmountIn: report.reconciledAmountIn,
    reconciledAmountOut: report.reconciledAmountOut,
    instructionEvidence: report.instructionEvidence,
    logEvidence: report.logEvidence,
    reconciliationHash: report.reconciliationHash,
  }, null);
}

interface ReplayCloneBudget {
  readonly maxBytes: number;
  bytes: number;
  nodes: number;
}

function utf8Length(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function countReplayBytes(value: string, budget: ReplayCloneBudget): string {
  budget.bytes += utf8Length(value);
  if (budget.bytes > budget.maxBytes) throw new Error('REPLAY_BATCH_BYTE_LIMIT_EXCEEDED');
  return value;
}

function cloneReplayValue(
  value: unknown,
  seen = new WeakSet<object>(),
  budget: ReplayCloneBudget = { maxBytes: 5 * 1024 * 1024, bytes: 0, nodes: 0 },
  depth = 0,
): { value: unknown; canonical: string } {
  budget.nodes += 1;
  if (budget.nodes > 100_000 || depth > 64) throw new Error('REPLAY_BATCH_COMPLEXITY_LIMIT_EXCEEDED');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return { value, canonical: countReplayBytes(JSON.stringify(value), budget) };
  }
  if (typeof value === 'bigint') return { value, canonical: countReplayBytes(`{"$bigint":${JSON.stringify(value.toString())}}`, budget) };
  if (typeof value === 'number' && Number.isFinite(value)) return { value, canonical: countReplayBytes(JSON.stringify(value), budget) };
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('CYCLIC_REPLAY_ITEM');
    seen.add(value);
    countReplayBytes('[', budget);
    const entries = value.map((item, index) => {
      if (index > 0) countReplayBytes(',', budget);
      return cloneReplayValue(item, seen, budget, depth + 1);
    });
    countReplayBytes(']', budget);
    seen.delete(value);
    return { value: Object.freeze(entries.map((entry) => entry.value)), canonical: `[${entries.map((entry) => entry.canonical).join(',')}]` };
  }
  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) throw new Error('CYCLIC_REPLAY_ITEM');
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new Error('UNSUPPORTED_REPLAY_ITEM');
    seen.add(value);
    const output: Record<string, unknown> = {};
    const entries: string[] = [];
    countReplayBytes('{', budget);
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) continue;
      if (entries.length > 0) countReplayBytes(',', budget);
      const keyJson = countReplayBytes(JSON.stringify(key), budget);
      const normalized = cloneReplayValue(child, seen, budget, depth + 1);
      output[key] = normalized.value;
      countReplayBytes(':', budget);
      entries.push(`${keyJson}:${normalized.canonical}`);
    }
    countReplayBytes('}', budget);
    seen.delete(value);
    return { value: Object.freeze(output), canonical: `{${entries.join(',')}}` };
  }
  throw new Error('UNSUPPORTED_REPLAY_ITEM');
}

export class DualPathReconciliationEngine {
  private readonly maxReplayQueueSize: number;
  private readonly maxReplayItemsPerBatch: number;
  private readonly maxReplayBytesPerBatch: number;
  private readonly requireFinalizedBanks: boolean;
  private readonly replayQueue = new Map<string, ReplayBatch<unknown>>();
  private totalReconciliations = 0;
  private totalDiscrepancies = 0;
  private totalIncompleteBanksDiscarded = 0;
  private totalReplayBatchesRejected = 0;

  constructor(config: DualPathReconcilerConfig = {}) {
    if (config.requireFinalizedBanks !== undefined && typeof config.requireFinalizedBanks !== 'boolean') {
      throw new Error('INVALID_REQUIRE_FINALIZED_BANKS_CONFIG');
    }
    const queueSize = config.maxReplayQueueSize ?? 1000;
    if (!Number.isSafeInteger(queueSize) || queueSize < 1) {
      throw new Error('INVALID_MAX_REPLAY_QUEUE_SIZE');
    }
    this.maxReplayQueueSize = queueSize;
    const maxItems = config.maxReplayItemsPerBatch ?? 10_000;
    if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new Error('INVALID_MAX_REPLAY_ITEMS_PER_BATCH');
    this.maxReplayItemsPerBatch = maxItems;
    const maxBytes = config.maxReplayBytesPerBatch ?? 5 * 1024 * 1024;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('INVALID_MAX_REPLAY_BYTES_PER_BATCH');
    this.maxReplayBytesPerBatch = maxBytes;
    this.requireFinalizedBanks = config.requireFinalizedBanks ?? true;
  }

  private validateInstruction(ix: InstructionEvidence): boolean {
    if (!ix) return false;
    if (!supportedProtocols.has(ix.protocol)) return false;
    if (!Number.isSafeInteger(ix.slot) || ix.slot < 0) return false;
    if (!Number.isSafeInteger(ix.instructionIndex) || ix.instructionIndex < 0) return false;
    if (ix.innerInstructionIndex != null && (!Number.isSafeInteger(ix.innerInstructionIndex) || ix.innerInstructionIndex < 0)) return false;
    if (typeof ix.programId !== 'string' || !ix.programId.trim()) return false;
    if (typeof ix.tokenMint !== 'string' || !ix.tokenMint.trim()) return false;
    if (typeof ix.userPubkey !== 'string' || !ix.userPubkey.trim()) return false;
    if (typeof ix.discriminator !== 'string' || !ix.discriminator.trim()) return false;
    if (typeof ix.signature !== 'string' || !ix.signature.trim()) return false;
    if (typeof ix.rawAmountIn !== 'bigint' || ix.rawAmountIn < 0n) return false;
    if (typeof ix.rawAmountOut !== 'bigint' || ix.rawAmountOut < 0n) return false;
    if (typeof ix.isSuccess !== 'boolean') return false;
    return true;
  }

  private validateLog(log: LogEvidence): boolean {
    if (!log) return false;
    if (!supportedProtocols.has(log.protocol)) return false;
    if (!Number.isSafeInteger(log.slot) || log.slot < 0) return false;
    if (!Number.isSafeInteger(log.logIndex) || log.logIndex < 0) return false;
    if (typeof log.programId !== 'string' || !log.programId.trim()) return false;
    if (typeof log.tokenMint !== 'string' || !log.tokenMint.trim()) return false;
    if (log.userPubkey != null && (typeof log.userPubkey !== 'string' || !log.userPubkey)) return false;
    if (typeof log.signature !== 'string' || !log.signature.trim()) return false;
    if (typeof log.logMessage !== 'string' || !log.logMessage.trim()) return false;
    if (log.logDiscriminator != null && typeof log.logDiscriminator !== 'string') return false;
    if (log.isSuccess != null && typeof log.isSuccess !== 'boolean') return false;
    if (log.rawAmountIn != null && (typeof log.rawAmountIn !== 'bigint' || log.rawAmountIn < 0n)) return false;
    if (log.rawAmountOut != null && (typeof log.rawAmountOut !== 'bigint' || log.rawAmountOut < 0n)) return false;
    return true;
  }

  public reconcile(
    instruction: InstructionEvidence | null,
    log: LogEvidence | null
  ): DualPathReconciliationReport {
    this.totalReconciliations += 1;
    const evaluatedAtMs = Date.now();

    // Check validity
    const hasInstruction = instruction !== null;
    const hasLog = log !== null;

    if (!hasInstruction && !hasLog) {
      return {
        status: 'MALFORMED_EVIDENCE',
        isConflicted: false,
        conflictReason: 'NO_EVIDENCE_PROVIDED',
        slot: 0,
        signature: null,
        tokenMint: null,
        reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: null,
        logEvidence: null,
        reconciliationHash: evidenceHash('MALFORMED_EVIDENCE', null, null),
        evaluatedAtMs,
      };
    }

    if (hasInstruction && !this.validateInstruction(instruction)) {
      return {
        status: 'MALFORMED_EVIDENCE',
        isConflicted: false,
        conflictReason: 'INVALID_INSTRUCTION_EVIDENCE',
        slot: instruction?.slot ?? 0,
        signature: instruction?.signature ?? null,
        tokenMint: instruction?.tokenMint ?? null,
        reconciledProtocol: instruction?.protocol ?? 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: null,
        logEvidence: null,
        reconciliationHash: evidenceHash('INVALID_INSTRUCTION_EVIDENCE', instruction, null),
        evaluatedAtMs,
      };
    }

    if (hasLog && !this.validateLog(log)) {
      return {
        status: 'MALFORMED_EVIDENCE',
        isConflicted: false,
        conflictReason: 'INVALID_LOG_EVIDENCE',
        slot: log?.slot ?? 0,
        signature: log?.signature ?? null,
        tokenMint: log?.tokenMint ?? null,
        reconciledProtocol: log?.protocol ?? 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: null,
        logEvidence: null,
        reconciliationHash: evidenceHash('INVALID_LOG_EVIDENCE', null, log),
        evaluatedAtMs,
      };
    }

    // Single source handling
    if (hasInstruction && !hasLog) {
      const hash = evidenceHash('INSTRUCTION_ONLY', instruction, null);
      return {
        status: 'INSTRUCTION_ONLY',
        isConflicted: false,
        conflictReason: null,
        slot: instruction.slot,
        signature: instruction.signature,
        tokenMint: instruction.tokenMint,
        reconciledProtocol: instruction.protocol,
        reconciledAmountIn: instruction.rawAmountIn,
        reconciledAmountOut: instruction.rawAmountOut,
        instructionEvidence: Object.freeze({ ...instruction }),
        logEvidence: null,
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    if (!hasInstruction && hasLog) {
      const hash = evidenceHash('LOG_ONLY', null, log);
      return {
        status: 'LOG_ONLY',
        isConflicted: false,
        conflictReason: null,
        slot: log.slot,
        signature: log.signature,
        tokenMint: log.tokenMint,
        reconciledProtocol: log.protocol,
        reconciledAmountIn: log.rawAmountIn ?? null,
        reconciledAmountOut: log.rawAmountOut ?? null,
        instructionEvidence: null,
        logEvidence: Object.freeze({ ...log }),
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    // Both instruction and log exist: check dual-path agreement
    const ix = instruction!;
    const lg = log!;

    if (ix.protocol !== lg.protocol || ix.programId !== lg.programId) {
      this.totalDiscrepancies += 1;
      return {
        status: 'DISCREPANCY_CONFLICT', isConflicted: true,
        conflictReason: `PROGRAM_IDENTITY_MISMATCH: ix(${ix.protocol}/${ix.programId}) vs log(${lg.protocol}/${lg.programId})`,
        slot: ix.slot, signature: ix.signature, tokenMint: null, reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null, reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }), logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: evidenceHash('PROGRAM_IDENTITY_MISMATCH', ix, lg), evaluatedAtMs,
      };
    }

    // Check transaction and slot congruence
    if (ix.slot !== lg.slot || ix.signature !== lg.signature) {
      this.totalDiscrepancies += 1;
      const hash = evidenceHash('CONFLICT_TX', ix, lg);
      return {
        status: 'DISCREPANCY_CONFLICT',
        isConflicted: true,
        conflictReason: `TRANSACTION_CONTEXT_MISMATCH: ix(slot=${ix.slot}, sig=${ix.signature}) vs log(slot=${lg.slot}, sig=${lg.signature})`,
        slot: ix.slot,
        signature: ix.signature,
        tokenMint: null,
        reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }),
        logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    // Check mint congruence
    if (ix.tokenMint !== lg.tokenMint) {
      this.totalDiscrepancies += 1;
      const hash = evidenceHash('CONFLICT_MINT', ix, lg);
      return {
        status: 'DISCREPANCY_CONFLICT',
        isConflicted: true,
        conflictReason: `TOKEN_MINT_MISMATCH: ix(${ix.tokenMint}) vs log(${lg.tokenMint})`,
        slot: ix.slot,
        signature: ix.signature,
        tokenMint: null,
        reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }),
        logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    // Check userPubkey congruence if present in log
    if (lg.userPubkey && ix.userPubkey !== lg.userPubkey) {
      this.totalDiscrepancies += 1;
      const hash = evidenceHash('CONFLICT_USER', ix, lg);
      return {
        status: 'DISCREPANCY_CONFLICT',
        isConflicted: true,
        conflictReason: `USER_PUBKEY_MISMATCH: ix(${ix.userPubkey}) vs log(${lg.userPubkey})`,
        slot: ix.slot,
        signature: ix.signature,
        tokenMint: ix.tokenMint,
        reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }),
        logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    // Check amount congruence if present in log
    if (lg.rawAmountIn != null && ix.rawAmountIn !== lg.rawAmountIn) {
      this.totalDiscrepancies += 1;
      const hash = evidenceHash('CONFLICT_AMOUNT_IN', ix, lg);
      return {
        status: 'DISCREPANCY_CONFLICT',
        isConflicted: true,
        conflictReason: `AMOUNT_IN_MISMATCH: ix(${ix.rawAmountIn}) vs log(${lg.rawAmountIn})`,
        slot: ix.slot,
        signature: ix.signature,
        tokenMint: ix.tokenMint,
        reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }),
        logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    if (lg.rawAmountOut != null && ix.rawAmountOut !== lg.rawAmountOut) {
      this.totalDiscrepancies += 1;
      const hash = evidenceHash('CONFLICT_AMOUNT_OUT', ix, lg);
      return {
        status: 'DISCREPANCY_CONFLICT',
        isConflicted: true,
        conflictReason: `AMOUNT_OUT_MISMATCH: ix(${ix.rawAmountOut}) vs log(${lg.rawAmountOut})`,
        slot: ix.slot,
        signature: ix.signature,
        tokenMint: ix.tokenMint,
        reconciledProtocol: 'UNKNOWN_DEX',
        reconciledAmountIn: null,
        reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }),
        logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: hash,
        evaluatedAtMs,
      };
    }

    // Discrepancy checks passed: unified match confirmed
    if (ix.isSuccess !== true || (lg.isSuccess != null && lg.isSuccess !== true)) {
      const failedMatch = ix.isSuccess === false && lg.isSuccess === false;
      if (!failedMatch && lg.isSuccess != null) {
        this.totalDiscrepancies += 1;
        return {
          status: 'DISCREPANCY_CONFLICT', isConflicted: true,
          conflictReason: `SUCCESS_STATE_MISMATCH: ix(${ix.isSuccess}) vs log(${lg.isSuccess})`,
          slot: ix.slot, signature: ix.signature, tokenMint: null, reconciledProtocol: 'UNKNOWN_DEX',
          reconciledAmountIn: null, reconciledAmountOut: null,
          instructionEvidence: Object.freeze({ ...ix }), logEvidence: Object.freeze({ ...lg }),
          reconciliationHash: evidenceHash('SUCCESS_STATE_MISMATCH', ix, lg), evaluatedAtMs,
        };
      }
      return {
        status: 'FAILED_TRANSACTION', isConflicted: false, conflictReason: 'TRANSACTION_NOT_SUCCESSFULLY_EXECUTED',
        slot: ix.slot, signature: ix.signature, tokenMint: ix.tokenMint, reconciledProtocol: ix.protocol,
        reconciledAmountIn: null, reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }), logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: evidenceHash('FAILED_TRANSACTION', ix, lg), evaluatedAtMs,
      };
    }

    const missingFields = [
      lg.userPubkey ? null : 'USER_IDENTITY',
      lg.rawAmountIn != null ? null : 'INPUT_AMOUNT',
      lg.rawAmountOut != null ? null : 'OUTPUT_AMOUNT',
      lg.isSuccess === true ? null : 'LOG_SUCCESS_STATE',
    ].filter((field): field is string => field !== null);
    if (missingFields.length > 0) {
      return {
        status: 'PARTIAL_MATCH', isConflicted: false,
        conflictReason: `MISSING_CORROBORATION_FIELDS:${missingFields.join(',')}`,
        slot: ix.slot, signature: ix.signature, tokenMint: ix.tokenMint, reconciledProtocol: ix.protocol,
        reconciledAmountIn: null, reconciledAmountOut: null,
        instructionEvidence: Object.freeze({ ...ix }), logEvidence: Object.freeze({ ...lg }),
        reconciliationHash: evidenceHash('PARTIAL_MATCH', ix, lg), evaluatedAtMs,
      };
    }

    const hash = evidenceHash('UNIFIED_MATCH', ix, lg);

    return {
      status: 'UNIFIED_MATCH',
      isConflicted: false,
      conflictReason: null,
      slot: ix.slot,
      signature: ix.signature,
      tokenMint: ix.tokenMint,
      reconciledProtocol: ix.protocol,
      reconciledAmountIn: ix.rawAmountIn,
      reconciledAmountOut: ix.rawAmountOut,
      instructionEvidence: Object.freeze({ ...ix }),
      logEvidence: Object.freeze({ ...lg }),
      reconciliationHash: hash,
      evaluatedAtMs,
    };
  }

  public certify(report: DualPathReconciliationReport): DualPathReconciliationCertificate {
    const recomputed = this.reconcile(report?.instructionEvidence ?? null, report?.logEvidence ?? null);
    const integrityMatches = !!report && reportFingerprint(report) === reportFingerprint(recomputed);
    const status = integrityMatches ? recomputed.status : 'MALFORMED_EVIDENCE';
    const hasDualPathAgreement = integrityMatches && !recomputed.isConflicted && status === 'UNIFIED_MATCH';
    const rejectionReason = hasDualPathAgreement
      ? null
      : (!integrityMatches ? 'REPORT_INTEGRITY_MISMATCH' : (recomputed.conflictReason ?? `DISCREPANCY_STATUS_${status}`));

    const certificateHash = evidenceHash('RECONCILIATION_CERTIFICATE', {
      reportFingerprint: integrityMatches ? reportFingerprint(report) : 'MISMATCH',
      status,
      hasDualPathAgreement,
      rejectionReason,
    }, null);

    const certificateId = `dpr_${certificateHash.slice(0, 16)}`;

    return Object.freeze({
      certificateId,
      status,
      hasDualPathAgreement,
      isApproved: hasDualPathAgreement,
      isConflicted: recomputed.isConflicted || !integrityMatches,
      rejectionReason,
      slot: integrityMatches ? recomputed.slot : 0,
      signature: integrityMatches ? recomputed.signature : null,
      certificateHash,
      authority: 'RESEARCH_ONLY_NO_EXECUTION_AUTHORITY',
      evidenceSource: 'CALLER_SUPPLIED_UNAUTHENTICATED',
    });
  }

  /**
   * Bounded Replay Coordinator: Stage batch for historical replay.
   * Discards incomplete-bank batches (missing blockhash, missing footer, unfinalized if required).
   */
  public stageReplayBatch<T>(bank: BankIdentity, items: readonly T[]): boolean {
    if (!bank || !Number.isSafeInteger(bank.slot) || bank.slot < 0) {
      this.totalIncompleteBanksDiscarded += 1;
      return false;
    }
    if (typeof bank.blockhash !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(bank.blockhash)) {
      this.totalIncompleteBanksDiscarded += 1;
      return false;
    }
    if (typeof bank.hasBankFooter !== 'boolean' || typeof bank.isFinalized !== 'boolean' || !bank.hasBankFooter) {
      this.totalIncompleteBanksDiscarded += 1;
      return false;
    }
    if (this.requireFinalizedBanks && bank.isFinalized !== true) {
      this.totalIncompleteBanksDiscarded += 1;
      return false;
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > this.maxReplayItemsPerBatch) {
      this.totalReplayBatchesRejected += 1;
      return false;
    }

    let snapshot: readonly T[];
    let canonicalItems: string;
    try {
      const clone = cloneReplayValue(items, new WeakSet<object>(), { maxBytes: this.maxReplayBytesPerBatch, bytes: 0, nodes: 0 });
      snapshot = clone.value as readonly T[];
      canonicalItems = clone.canonical;
    } catch {
      this.totalReplayBatchesRejected += 1;
      return false;
    }

    const key = `${bank.slot}:${bank.blockhash}`;
    const batchDigest = evidenceHash('REPLAY_BATCH', bank, canonicalItems);
    const existing = this.replayQueue.get(key);
    if (existing) {
      if (existing.batchDigest === batchDigest) return true;
      this.totalReplayBatchesRejected += 1;
      return false;
    }
    if (this.replayQueue.size >= this.maxReplayQueueSize) {
      this.totalReplayBatchesRejected += 1;
      return false;
    }

    this.replayQueue.set(key, Object.freeze({
      bank: Object.freeze({ ...bank }),
      items: snapshot,
      batchDigest,
    }));
    return true;
  }

  public getReplayBatchCount(): number {
    return this.replayQueue.size;
  }

  public drainReplayBatch(slot: number, blockhash: string): ReplayBatch<unknown> | null {
    if (!Number.isSafeInteger(slot) || slot < 0 || typeof blockhash !== 'string') return null;
    const key = `${slot}:${blockhash}`;
    const batch = this.replayQueue.get(key);
    if (!batch) return null;
    this.replayQueue.delete(key);
    return batch;
  }

  public getStats(): {
    totalReconciliations: number;
    totalDiscrepancies: number;
    totalIncompleteBanksDiscarded: number;
    totalReplayBatchesRejected: number;
    queuedReplayBatches: number;
  } {
    return {
      totalReconciliations: this.totalReconciliations,
      totalDiscrepancies: this.totalDiscrepancies,
      totalIncompleteBanksDiscarded: this.totalIncompleteBanksDiscarded,
      totalReplayBatchesRejected: this.totalReplayBatchesRejected,
      queuedReplayBatches: this.replayQueue.size,
    };
  }
}
