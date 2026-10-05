/**
 * SYLPH FUSION — SOLANA MARKET INTERMEDIATE REPRESENTATION (SolanaMarketIR)
 * Specification: Solana-Only Integration Blueprint (Section 1)
 *
 * Epistemic Invariants:
 * 1. Single verified representation of Solana market state across all DEX opportunity families.
 * 2. Normalizes mint, pool, program, reserves, Token-2022 extensions, fee models, and authorities.
 * 3. Exact integer reserves and liquidity (bigint) alongside numerical reference prices.
 * 4. Point-in-time provenance: observedAt, receivedAt, availableAt, knownAt, and evidenceRoot.
 * 5. Strategies consume SolanaMarketIR exclusively instead of raw RPC or provider responses.
 */

import { hashCanonical } from '../pipeline/canonical-hashing.js';

export type SolanaPoolType =
  | 'PUMP_FUN'
  | 'PUMP_SWAP'
  | 'RAYDIUM_AMM'
  | 'RAYDIUM_CPMM'
  | 'RAYDIUM_CLMM'
  | 'METEORA_DLMM'
  | 'METEORA_DAMM'
  | 'ORCA_WHIRLPOOL'
  | 'JUPITER'
  | 'PHOENIX'
  | 'OPENBOOK';

export interface SolanaMarketIR {
  readonly irVersion: '1.0.0';
  readonly mint: string;
  readonly tokenProgram: string;
  readonly token2022Extensions: readonly string[];
  readonly programId: string;
  readonly poolId: string;
  readonly poolType: SolanaPoolType;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly reserves: {
    readonly base: bigint;
    readonly quote: bigint;
  };
  readonly liquidityLamports: bigint;
  readonly priceSol: number;
  readonly priceUsd: number;
  readonly feeModel: {
    readonly baseFeeBps: number;
    readonly creatorFeeBps: number;
    readonly dynamicFeeBps: number;
  };
  readonly transferFees: {
    readonly feeBps: number;
    readonly maxFeeLamports: bigint;
  };
  readonly creatorFees: {
    readonly creatorBps: number;
    readonly recipient: string;
  };
  readonly mintAuthority: string | null;
  readonly freezeAuthority: string | null;
  readonly delegates: readonly string[];
  readonly creator: string;
  readonly funder: string;
  readonly holders: {
    readonly count: number;
    readonly top10ConcentrationBps: number;
  };
  readonly walletClusters: readonly string[];
  readonly slot: bigint;
  readonly blockHeight: bigint;
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly availableAt: string;
  readonly knownAt: string;
  readonly source: string;
  readonly evidenceRoot: string;
  readonly freshnessMs: number;
}

export type SolanaMarketIRInput = Omit<SolanaMarketIR, 'irVersion' | 'evidenceRoot'> & {
  readonly evidenceRoot?: string;
};

export function createSolanaMarketIR(input: SolanaMarketIRInput): SolanaMarketIR {
  if (!input.mint || input.mint.trim().length === 0) {
    throw new Error('SOLANA_MARKET_IR_ERROR: Mint must be a non-empty string');
  }
  if (!input.poolId || input.poolId.trim().length === 0) {
    throw new Error('SOLANA_MARKET_IR_ERROR: Pool ID must be a non-empty string');
  }
  if (input.liquidityLamports < 0n) {
    throw new Error('SOLANA_MARKET_IR_ERROR: Liquidity lamports cannot be negative');
  }
  if (input.priceSol < 0 || !Number.isFinite(input.priceSol)) {
    throw new Error('SOLANA_MARKET_IR_ERROR: Price SOL must be a finite non-negative number');
  }

  // Pre-calculate canonical evidence root if not supplied
  const baseObject = {
    mint: input.mint,
    tokenProgram: input.tokenProgram,
    token2022Extensions: [...input.token2022Extensions],
    programId: input.programId,
    poolId: input.poolId,
    poolType: input.poolType,
    baseAsset: input.baseAsset,
    quoteAsset: input.quoteAsset,
    reserves: { base: input.reserves.base, quote: input.reserves.quote },
    liquidityLamports: input.liquidityLamports,
    priceSol: input.priceSol,
    priceUsd: input.priceUsd,
    feeModel: { ...input.feeModel },
    transferFees: { ...input.transferFees },
    creatorFees: { ...input.creatorFees },
    mintAuthority: input.mintAuthority,
    freezeAuthority: input.freezeAuthority,
    delegates: [...input.delegates],
    creator: input.creator,
    funder: input.funder,
    holders: { ...input.holders },
    walletClusters: [...input.walletClusters],
    slot: input.slot,
    blockHeight: input.blockHeight,
    observedAt: input.observedAt,
    receivedAt: input.receivedAt,
    availableAt: input.availableAt,
    knownAt: input.knownAt,
    source: input.source,
    freshnessMs: input.freshnessMs,
  };

  const evidenceRoot = input.evidenceRoot || hashCanonical(baseObject);

  return Object.freeze({
    irVersion: '1.0.0',
    ...baseObject,
    evidenceRoot,
  });
}

export function hashSolanaMarketIR(ir: SolanaMarketIR): string {
  return hashCanonical(ir);
}

export function validateSolanaMarketIR(ir: SolanaMarketIR): {
  readonly valid: boolean;
  readonly violations: readonly string[];
} {
  const violations: string[] = [];

  if (ir.irVersion !== '1.0.0') {
    violations.push(`Unsupported IR version: ${ir.irVersion}`);
  }
  if (!ir.mint || ir.mint.length < 32) {
    violations.push('Invalid or truncated mint address');
  }
  if (!ir.programId || ir.programId.length < 32) {
    violations.push('Invalid or truncated program ID');
  }
  if (ir.reserves.base < 0n || ir.reserves.quote < 0n) {
    violations.push('Negative reserves detected');
  }
  if (ir.freezeAuthority !== null) {
    violations.push('Active freeze authority detected (unmitigated honeypot hazard)');
  }
  if (ir.holders.top10ConcentrationBps > 8000) {
    violations.push('Dangerous holder concentration (> 80% in top 10)');
  }
  if (Date.parse(ir.knownAt) > Date.now() + 60000) {
    violations.push('Future timestamp detected in knownAt (temporal causality violation)');
  }

  return Object.freeze({
    valid: violations.length === 0,
    violations: Object.freeze(violations),
  });
}
