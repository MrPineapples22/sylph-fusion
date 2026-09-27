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
    constructor(message) {
        super(message);
        this.name = 'DimensionMismatchError';
    }
}
/**
 * Strongly typed dimension-safe asset amount.
 * Prevents mathematical operations between incompatible mints or decimals.
 */
export class AssetAmount {
    mint;
    decimals;
    raw;
    assetType;
    constructor(mint, decimals, raw, assetType = 'SPL_TOKEN') {
        if (decimals < 0 || decimals > 18) {
            throw new DimensionMismatchError(`Invalid decimals ${decimals}`);
        }
        this.mint = mint;
        this.decimals = decimals;
        this.raw = raw;
        this.assetType = mint === 'SOL' ? 'SOL' : assetType;
    }
    static sol(lamports) {
        return new AssetAmount('SOL', 9, lamports, 'SOL');
    }
    static spl(mint, decimals, raw) {
        if (mint === 'SOL') {
            throw new DimensionMismatchError('Cannot create SPL asset with reserved mint SOL');
        }
        return new AssetAmount(mint, decimals, raw, 'SPL_TOKEN');
    }
    static token2022(mint, decimals, raw) {
        if (mint === 'SOL') {
            throw new DimensionMismatchError('Cannot create Token-2022 asset with reserved mint SOL');
        }
        return new AssetAmount(mint, decimals, raw, 'TOKEN_2022');
    }
    static zero(mint, decimals, assetType = 'SPL_TOKEN') {
        return new AssetAmount(mint, decimals, 0n, assetType);
    }
    assertCompatible(other) {
        if (this.mint !== other.mint) {
            throw new DimensionMismatchError(`Asset mint mismatch: cannot combine mint ${this.mint} with ${other.mint}`);
        }
        if (this.decimals !== other.decimals) {
            throw new DimensionMismatchError(`Asset decimal mismatch: mint ${this.mint} decimals ${this.decimals} != ${other.decimals}`);
        }
    }
    add(other) {
        this.assertCompatible(other);
        return new AssetAmount(this.mint, this.decimals, this.raw + other.raw, this.assetType);
    }
    sub(other) {
        this.assertCompatible(other);
        return new AssetAmount(this.mint, this.decimals, this.raw - other.raw, this.assetType);
    }
    isZero() {
        return this.raw === 0n;
    }
    isPositive() {
        return this.raw > 0n;
    }
    isNegative() {
        return this.raw < 0n;
    }
    equals(other) {
        return this.mint === other.mint && this.decimals === other.decimals && this.raw === other.raw;
    }
    toUiNumber() {
        return Number(this.raw) / Math.pow(10, this.decimals);
    }
    toUiString() {
        const divisor = 10n ** BigInt(this.decimals);
        const whole = this.raw / divisor;
        const remainder = this.raw < 0n ? -(this.raw % divisor) : this.raw % divisor;
        if (this.decimals === 0)
            return whole.toString();
        const fracStr = remainder.toString().padStart(this.decimals, '0').replace(/0+$/, '');
        return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
    }
}
export function createPriceCertificate(params) {
    const digestPayload = `${params.pair}:${params.baseAsset}:${params.quoteAsset}:${params.referenceMark}:${params.executableLiquidationValue}:${params.slot}:${params.timestampMs}:${params.providerSet.join(',')}`;
    const digest = createHash('sha256').update(digestPayload).digest('hex');
    const certificateId = `PRICECERT-${params.slot}-${digest.slice(0, 12)}`;
    return {
        ...params,
        certificateId,
        digest
    };
}
/**
 * DimensionLedger maintains typed sub-ledgers preventing unit-contamination
 * and produces verifiable PnLValuationCertificates.
 */
export class DimensionLedger {
    entries = [];
    sequenceCounter = 0;
    // Discrete balances keyed by mint
    balances = new Map();
    constructor(initialSolLamports = 0n) {
        this.balances.set('SOL', { decimals: 9, raw: initialSolLamports, assetType: 'SOL' });
        if (initialSolLamports > 0n) {
            this.recordEntry('INITIAL_CAPITAL', AssetAmount.sol(initialSolLamports), 'Genesis initial capital');
        }
    }
    recordEntry(type, amount, notes, metadata) {
        this.sequenceCounter++;
        const entryId = `LEDGER-${this.sequenceCounter.toString().padStart(6, '0')}`;
        // Update internal typed balance
        const current = this.balances.get(amount.mint) ?? {
            decimals: amount.decimals,
            raw: 0n,
            assetType: amount.assetType
        };
        if (current.decimals !== amount.decimals) {
            throw new DimensionMismatchError(`Ledger integrity error: existing balance for ${amount.mint} has ${current.decimals} decimals, received ${amount.decimals}`);
        }
        this.balances.set(amount.mint, {
            decimals: amount.decimals,
            raw: current.raw + amount.raw,
            assetType: amount.assetType
        });
        const entry = {
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
    getBalance(mint, decimals) {
        const b = this.balances.get(mint);
        if (!b) {
            return AssetAmount.zero(mint, decimals ?? (mint === 'SOL' ? 9 : 6));
        }
        return new AssetAmount(mint, b.decimals, b.raw, b.assetType);
    }
    getSolBalance() {
        return this.getBalance('SOL', 9);
    }
    getAllEntries() {
        return this.entries;
    }
    /**
     * Evaluates PnL using explicit PriceCertificates.
     * NEVER combines raw token units with SOL lamports.
     */
    evaluatePositionPnL(params) {
        const { mint, tokenQuantity, costBasisSol, executionCostsSol, tokenPriceCert, solPriceCert } = params;
        if (tokenQuantity.mint !== mint) {
            throw new DimensionMismatchError(`Token quantity mint ${tokenQuantity.mint} does not match evaluated mint ${mint}`);
        }
        if (tokenPriceCert.baseAsset !== mint) {
            throw new DimensionMismatchError(`Token price certificate base asset ${tokenPriceCert.baseAsset} does not match evaluated mint ${mint}`);
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
//# sourceMappingURL=dimension-ledger.js.map