/**
 * Research-only DEX transaction envelope inspector.
 * Exact known program IDs identify a candidate protocol; this module does not
 * decode protocol instructions, infer token identity, or estimate trade amounts.
 */

import { createHash } from 'node:crypto';

export type DEXProtocol =
  | 'PUMP_FUN'
  | 'RAYDIUM_AMM_V4'
  | 'RAYDIUM_AMM_STABLE'
  | 'RAYDIUM_CLMM'
  | 'RAYDIUM_CPMM'
  | 'RAYDIUM_LAUNCHPAD'
  | 'METEORA_DLMM'
  | 'WHIRLPOOL_ORCA'
  | 'UNKNOWN_DEX';

export type DEXTradeType = 'UNKNOWN';

export interface DecodedDEXTradeEvent {
  readonly protocol: DEXProtocol;
  readonly decodeStatus: 'NOT_DECODED';
  readonly tradeType: DEXTradeType;
  readonly mint: null;
  readonly userPubkey: null;
  readonly inAmountSol: null;
  readonly outAmountTokens: null;
  readonly priceSol: null;
  readonly slot: number;
  readonly signature: string | null;
  readonly isSuccess: boolean | null;
  readonly parsedAtMs: number;
  readonly observationHash: string;
}

export interface RawTransactionPayload {
  readonly slot: number;
  readonly signature?: string;
  readonly programId?: string;
  readonly accounts?: readonly string[];
  readonly data?: string | Uint8Array;
  readonly logs?: readonly string[];
  readonly err?: unknown;
}

export class DEXStreamParser {
  private static readonly PROGRAMS: Readonly<Record<string, DEXProtocol>> = {
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P': 'PUMP_FUN',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'RAYDIUM_AMM_V4',
    '5quBtoiQqxF9Jv6KYKctB59NT3gtJD2Y65kdnB1Uev3h': 'RAYDIUM_AMM_STABLE',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'RAYDIUM_CLMM',
    'CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C': 'RAYDIUM_CPMM',
    'LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj': 'RAYDIUM_LAUNCHPAD',
    'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo': 'METEORA_DLMM',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'WHIRLPOOL_ORCA',
  };

  private totalInspected = 0;
  private totalErrors = 0;

  /** Logs are intentionally excluded: generic instruction names are ambiguous. */
  public identifyProtocol(programId?: string): DEXProtocol {
    return programId ? DEXStreamParser.PROGRAMS[programId] ?? 'UNKNOWN_DEX' : 'UNKNOWN_DEX';
  }

  /** Return an observation envelope, not a decoded trade or financial fact. */
  public parseTransaction(raw: RawTransactionPayload): DecodedDEXTradeEvent {
    if (!raw || !Number.isSafeInteger(raw.slot) || raw.slot < 0 ||
        (raw.signature !== undefined && (typeof raw.signature !== 'string' || !raw.signature))) {
      this.totalErrors += 1;
      throw new Error('INVALID_RAW_TRANSACTION');
    }
    this.totalInspected += 1;
    const parsedAtMs = Date.now();
    const programId = typeof raw.programId === 'string' ? raw.programId : null;
    const isSuccess = Object.hasOwn(raw, 'err') ? raw.err === null : null;
    const observationHash = createHash('sha256')
      .update(`${raw.signature ?? 'UNKNOWN'}:${raw.slot}:${programId ?? 'UNKNOWN'}`)
      .digest('hex');

    return {
      protocol: this.identifyProtocol(programId ?? undefined),
      decodeStatus: 'NOT_DECODED',
      tradeType: 'UNKNOWN',
      mint: null,
      userPubkey: null,
      inAmountSol: null,
      outAmountTokens: null,
      priceSol: null,
      slot: raw.slot,
      signature: raw.signature ?? null,
      isSuccess,
      parsedAtMs,
      observationHash,
    };
  }

  public getStats(): { totalInspected: number; totalErrors: number } {
    return { totalInspected: this.totalInspected, totalErrors: this.totalErrors };
  }
}
