/**
 * SYLPH FUSION — DIMENSION-LEDGER & MARK-II PRICE CERTIFICATES
 * Specifications: Sections 27 (Dimension-Ledger), 28 (Mark-II Price Certificates), 103 (Invariants 8, 10, 11)
 *
 * Invariants:
 * 1. Never combine raw token units with lamports (throws DimensionMismatchError).
 * 2. Typed assets: AssetAmount<mint, decimals, raw>.
 * 3. Supports SOL, SPL, Token-2022, rent locks, rent refunds, fees, tips, and transfer fees.
 * 4. PnL must use explicit PriceCertificates and PnLValuationCertificates (never token delta + SOL delta).
 * 5. Mark-II replaces static prices ($150 SOL) with verified multi-provider PriceCertificates.
 */

import { createHash } from 'node:crypto';

export class DimensionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DimensionMismatchError';
  }
}

export type AssetType = 'SOL' | 'SPL_TOKEN' | 'TOKEN_2022';

/**
 * Strongly typed dimension-safe asset amount.
 * Prevents mathematical operations between incompatible mints or decimals.
 */
export class AssetAmount<M extends string = string> {
  readonly mint: M;
  readonly decimals: number;
  readonly raw: bigint;
  readonly assetType: AssetType;

  constructor(mint: M, decimals: number, raw: bigint, assetType: AssetType = 'SPL_TOKEN') {
    if (decimals < 0 || decimals > 18) {
      throw new DimensionMismatchError(`Invalid decimals ${decimals}`);
    }
    this.mint = mint;
    this.decimals = decimals;
    this.raw = raw;
    this.assetType = mint === 'SOL' ? 'SOL' : assetType;
  }

  static sol(lamports: bigint): AssetAmount<'SOL'> {
    return new AssetAmount<'SOL'>('SOL', 9, lamports, 'SOL');
  }

  static spl(mint: string, decimals: number, raw: bigint): AssetAmount<string> {
    if (mint === 'SOL') {
      throw new DimensionMismatchError('Cannot create SPL asset with reserved mint SOL');
    }
    return new AssetAmount(mint, decimals, raw, 'SPL_TOKEN');
  }

  static token2022(mint: string, decimals: number, raw: bigint): AssetAmount<string> {
    if (mint === 'SOL') {
      throw new DimensionMismatchError('Cannot create Token-2022 asset with reserved mint SOL');
    }
    return new AssetAmount(mint, decimals, raw, 'TOKEN_2022');
  }

  static zero<M extends string>(mint: M, decimals: number, assetType: AssetType = 'SPL_TOKEN'): AssetAmount<M> {
    return new AssetAmount<M>(mint, decimals, 0n, assetType);
  }

  private assertCompatible(other: AssetAmount<any>): void {
    if (this.mint !== other.mint) {
      throw new DimensionMismatchError(
        `Asset mint mismatch: cannot combine mint ${this.mint} with ${other.mint}`
      );
    }
    if (this.decimals !== other.decimals) {
      throw new DimensionMismatchError(
        `Asset decimal mismatch: mint ${this.mint} decimals ${this.decimals} != ${other.decimals}`
      );
    }
  }

  add(other: AssetAmount<M>): AssetAmount<M> {
    this.assertCompatible(other);
    return new AssetAmount<M>(this.mint, this.decimals, this.raw + other.raw, this.assetType);
  }

  sub(other: AssetAmount<M>): AssetAmount<M> {
    this.assertCompatible(other);
    return new AssetAmount<M>(this.mint, this.decimals, this.raw - other.raw, this.assetType);
  }

  isZero(): boolean {
    return this.raw === 0n;
  }

  isPositive(): boolean {
    return this.raw > 0n;
  }

  isNegative(): boolean {
    return this.raw < 0n;
  }

  equals(other: AssetAmount<M>): boolean {
    return this.mint === other.mint && this.decimals === other.decimals && this.raw === other.raw;
  }

  toUiNumber(): number {
    return Number(this.raw) / Math.pow(10, this.decimals);
  }

  toUiString(): string {
    const divisor = 10n ** BigInt(this.decimals);
    const whole = this.raw / divisor;
    const remainder = this.raw < 0n ? -(this.raw % divisor) : this.raw % divisor;
    if (this.decimals === 0) return whole.toString();
    const fracStr = remainder.toString().padStart(this.decimals, '0').replace(/0+$/, '');
    return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
  }
}

/**
 * MARK-II Price Certificate (Section 28)
 * Eliminates static assumptions ($150 SOL) with verifiable multi-source provenance.
 */
export interface PriceCertificate {
  readonly certificateId: string;
  readonly pair: string; // e.g. 'SOL/USD', 'TOKEN/SOL'
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly referenceMark: number;           // Mid-market mark
  readonly executableLiquidationValue: number; // Discounted for slippage, depth & exit fee
  readonly slot: number;
  readonly timestampMs: number;
  readonly providerSet: readonly string[];
  readonly independenceScore: number;       // 0.0 to 1.0 (from QuorumRoot)
  readonly confidence: number;              // 0.0 to 1.0
  readonly isDepegged: boolean;             // True if stablecoin or pegged asset is depegged
  readonly freshnessMs: number;
  readonly digest: string;
}

export function createPriceCertificate(params: Omit<PriceCertificate, 'certificateId' | 'digest'>): PriceCertificate {
  const digestPayload = `${params.pair}:${params.baseAsset}:${params.quoteAsset}:${params.referenceMark}:${params.executableLiquidationValue}:${params.slot}:${params.timestampMs}:${params.providerSet.join(',')}`;
  const digest = createHash('sha256').update(digestPayload).digest('hex');
  const certificateId = `PRICECERT-${params.slot}-${digest.slice(0, 12)}`;

  return {
    ...params,
    certificateId,
    digest
  };
}

export interface PnLValuationCertificate {
  readonly certificateId: string;
  readonly mint: string;
  readonly tokenQuantity: AssetAmount<string>;
  readonly costBasisSol: AssetAmount<'SOL'>;
  readonly executionCostsSol: AssetAmount<'SOL'>;
  readonly tokenPriceCert: PriceCertificate;
  readonly solPriceCert: PriceCertificate;
  readonly referenceGrossValueSol: number;
  readonly executableNetValueSol: number;
  readonly referenceGrossValueUsd: number;
  readonly executableNetValueUsd: number;
  readonly unrealizedPnLSol: number;
  readonly unrealizedPnLUsd: number;
  readonly returnOnInvestmentPct: number;
  readonly valuedAtMs: number;
  readonly digest: string;
}

export type LedgerEntryType =
  | 'INITIAL_CAPITAL'
  | 'TRADE_ENTRY'
  | 'TRADE_EXIT'
  | 'NETWORK_FEE'
  | 'PRIORITY_FEE'
  | 'JITO_TIP'
  | 'RENT_LOCK'
  | 'RENT_REFUND'
  | 'TOKEN_TRANSFER_FEE'
  | 'CREATOR_FEE'
  | 'FAILED_TX_FEE'
  | 'CLEARING_SETTLEMENT';

export interface DimensionLedgerEntry {
  readonly entryId: string;
  readonly sequence: number;
  readonly type: LedgerEntryType;
  readonly timestampMs: number;
  readonly assetAmount: AssetAmount<any>;
  readonly solEquivalentLamports?: bigint;
  readonly intentId?: string;
  readonly txSignature?: string;
  readonly notes: string;
}

/**
 * DimensionLedger maintains typed sub-ledgers preventing unit-contamination
 * and produces verifiable PnLValuationCertificates.
 */
export class DimensionLedger {
  private entries: DimensionLedgerEntry[] = [];
  private sequenceCounter = 0;

  // Discrete balances keyed by mint
  private balances = new Map<string, { decimals: number; raw: bigint; assetType: AssetType }>();

  constructor(initialSolLamports: bigint = 0n) {
    this.balances.set('SOL', { decimals: 9, raw: initialSolLamports, assetType: 'SOL' });
    if (initialSolLamports > 0n) {
      this.recordEntry('INITIAL_CAPITAL', AssetAmount.sol(initialSolLamports), 'Genesis initial capital');
    }
  }

  public recordEntry(
    type: LedgerEntryType,
    amount: AssetAmount<any>,
    notes: string,
    metadata?: { intentId?: string; txSignature?: string; solEquivalentLamports?: bigint }
  ): DimensionLedgerEntry {
    this.sequenceCounter++;
    const entryId = `LEDGER-${this.sequenceCounter.toString().padStart(6, '0')}`;

    // Update internal typed balance
    const current = this.balances.get(amount.mint) ?? {
      decimals: amount.decimals,
      raw: 0n,
      assetType: amount.assetType
    };

    if (current.decimals !== amount.decimals) {
      throw new DimensionMismatchError(
        `Ledger integrity error: existing balance for ${amount.mint} has ${current.decimals} decimals, received ${amount.decimals}`
      );
    }

    this.balances.set(amount.mint, {
      decimals: amount.decimals,
      raw: current.raw + amount.raw,
      assetType: amount.assetType
    });

    const entry: DimensionLedgerEntry = {
      entryId,
      sequence: this.sequenceCounter,
      type,
      timestampMs: Date.now(),
      assetAmount: amount,
      solEquivalentLamports: metadata?.solEquivalentLamports,
      intentId: metadata?.intentId,
      txSignature: metadata?.txSignature,
      notes
    };

    this.entries.push(entry);
    return entry;
  }

  public getBalance<M extends string>(mint: M, decimals?: number): AssetAmount<M> {
    const b = this.balances.get(mint);
    if (!b) {
      return AssetAmount.zero<M>(mint, decimals ?? ((mint === 'SOL' ? 9 : 6) as number));
    }
    return new AssetAmount<M>(mint, b.decimals, b.raw, b.assetType);
  }

  public getSolBalance(): AssetAmount<'SOL'> {
    return this.getBalance<'SOL'>('SOL', 9);
  }

  public getAllEntries(): readonly DimensionLedgerEntry[] {
    return this.entries;
  }

  /**
   * Evaluates PnL using explicit PriceCertificates.
   * NEVER combines raw token units with SOL lamports.
   */
  public evaluatePositionPnL(params: {
    mint: string;
    tokenQuantity: AssetAmount<string>;
    costBasisSol: AssetAmount<'SOL'>;
    executionCostsSol: AssetAmount<'SOL'>;
    tokenPriceCert: PriceCertificate;
    solPriceCert: PriceCertificate;
  }): PnLValuationCertificate {
    const { mint, tokenQuantity, costBasisSol, executionCostsSol, tokenPriceCert, solPriceCert } = params;

    if (tokenQuantity.mint !== mint) {
      throw new DimensionMismatchError(
        `Token quantity mint ${tokenQuantity.mint} does not match evaluated mint ${mint}`
      );
    }

    if (tokenPriceCert.baseAsset !== mint) {
      throw new DimensionMismatchError(
        `Token price certificate base asset ${tokenPriceCert.baseAsset} does not match evaluated mint ${mint}`
      );
    }

    const tokenUi = tokenQuantity.toUiNumber();
    const solPriceUsd = solPriceCert.referenceMark;

    // Gross reference value in SOL
    const referenceGrossValueSol = tokenUi * tokenPriceCert.referenceMark;
    // Net executable value in SOL (discounted for exit slippage, fees, impact)
    const executableNetValueSol = tokenUi * tokenPriceCert.executableLiquidationValue;

    const referenceGrossValueUsd = referenceGrossValueSol * solPriceUsd;
    const executableNetValueUsd = executableNetValueSol * solPriceUsd;

    const totalCostSol = costBasisSol.toUiNumber() + executionCostsSol.toUiNumber();
    const unrealizedPnLSol = executableNetValueSol - totalCostSol;
    const unrealizedPnLUsd = unrealizedPnLSol * solPriceUsd;
    const returnOnInvestmentPct = totalCostSol > 0 ? (unrealizedPnLSol / totalCostSol) * 100 : 0;

    const valuedAtMs = Date.now();
    const digestPayload = `${mint}:${tokenQuantity.raw.toString()}:${totalCostSol}:${executableNetValueSol}:${solPriceUsd}:${valuedAtMs}`;
    const digest = createHash('sha256').update(digestPayload).digest('hex');
    const certificateId = `PNLCERT-${digest.slice(0, 16)}`;

    return {
      certificateId,
      mint,
      tokenQuantity,
      costBasisSol,
      executionCostsSol,
      tokenPriceCert,
      solPriceCert,
      referenceGrossValueSol,
      executableNetValueSol,
      referenceGrossValueUsd,
      executableNetValueUsd,
      unrealizedPnLSol,
      unrealizedPnLUsd,
      returnOnInvestmentPct,
      valuedAtMs,
      digest
    };
  }
}
