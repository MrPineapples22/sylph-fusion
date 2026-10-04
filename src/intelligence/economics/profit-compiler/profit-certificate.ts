/**
 * SYLPH FUSION — PROFIT COMPILER-X: PROFIT CERTIFICATE
 * Specifications: Master Blueprint Section XLVIII (Profit Certificate)
 */

import { createHash } from 'node:crypto';
import type { TradeAccountingStatement, PnLAttributionBreakdown } from './accounting-compiler.js';

export interface ProfitCertificate {
  readonly certificateId: string;
  readonly tradeId: string;
  readonly mint: string;
  readonly slot: bigint;
  readonly accounting: TradeAccountingStatement;
  readonly attribution: PnLAttributionBreakdown;
  readonly isConserved: boolean;
  readonly certificateHash: string;
  readonly certifiedAtMs: number;
}

export function certifyProfit(params: {
  tradeId: string;
  mint: string;
  slot: bigint;
  accounting: TradeAccountingStatement;
  attribution: PnLAttributionBreakdown;
}): ProfitCertificate {
  const certifiedAtMs = Date.now();
  const unsigned = {
    tradeId: params.tradeId,
    mint: params.mint,
    slot: params.slot.toString(),
    netPnLLamports: params.accounting.realizedNetPnLLamports.toString(),
    isBalanced: params.accounting.isAccountingBalanced,
    certifiedAtMs,
  };

  const certificateHash = createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
  const certificateId = `pfc_${certificateHash.slice(0, 16)}`;

  return {
    certificateId,
    tradeId: params.tradeId,
    mint: params.mint,
    slot: params.slot,
    accounting: params.accounting,
    attribution: params.attribution,
    isConserved: params.accounting.isAccountingBalanced,
    certificateHash,
    certifiedAtMs,
  };
}
