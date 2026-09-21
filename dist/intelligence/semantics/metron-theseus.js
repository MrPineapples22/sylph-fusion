/**
 * SYLPH-SOL / AETHER FLUX - Semantic Boundaries (METRON, THESEUS, HEPHAESTUS)
 * Specifications: Sections 40, 41.
 *
 * Implements:
 * 1. METRON: Typed numeric units, conversion contracts & precision safeguards
 * 2. THESEUS: Canonical mint identity & address-dominant resolution
 * 3. HEPHAESTUS: Solana token program semantics & Token-2022 verification
 */
export const LAMPORTS_PER_SOL = 1000000000n;
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/**
 * METRON: Numeric Safety & Typed Conversions
 */
export class MetronUnits {
    static lamportsToSol(lamports) {
        const l = typeof lamports === 'bigint' ? lamports : BigInt(Math.floor(lamports));
        return Number(l) / 1_000_000_000;
    }
    static solToLamports(sol) {
        this.assertValidNumber(sol, 'sol');
        return BigInt(Math.round(sol * 1_000_000_000));
    }
    static baseUnitsToDisplay(baseUnits, decimals) {
        this.assertValidNumber(decimals, 'decimals');
        const factor = 10 ** decimals;
        const bu = typeof baseUnits === 'bigint' ? Number(baseUnits) : baseUnits;
        this.assertValidNumber(bu, 'baseUnits');
        return bu / factor;
    }
    static displayToBaseUnits(displayUnits, decimals) {
        this.assertValidNumber(displayUnits, 'displayUnits');
        this.assertValidNumber(decimals, 'decimals');
        const factor = 10 ** decimals;
        return BigInt(Math.round(displayUnits * factor));
    }
    static bpsToFraction(bps) {
        this.assertValidNumber(bps, 'bps');
        return bps / 10_000;
    }
    static fractionToBps(fraction) {
        this.assertValidNumber(fraction, 'fraction');
        return Math.round(fraction * 10_000);
    }
    static assertValidNumber(val, name) {
        if (val === null || val === undefined || Number.isNaN(val) || !Number.isFinite(val)) {
            throw new Error(`[METRON_NUMERIC_SAFETY] Invalid numeric value for ${name}: ${val}`);
        }
    }
    static clamp(val, min, max) {
        this.assertValidNumber(val, 'val');
        return Math.max(min, Math.min(max, val));
    }
}
/**
 * THESEUS: Canonical Mint Identity
 */
export class TheseusIdentity {
    static canonicalizeMint(rawMint) {
        if (!rawMint || typeof rawMint !== 'string') {
            throw new Error(`[THESEUS_IDENTITY_VIOLATION] Empty or non-string mint identity: ${rawMint}`);
        }
        const trimmed = rawMint.trim();
        if (trimmed.length < 32 || trimmed.length > 44) {
            throw new Error(`[THESEUS_IDENTITY_VIOLATION] Invalid base58 mint length: ${trimmed.length}`);
        }
        return trimmed;
    }
    static verifyMintDominance(mint, symbol) {
        const cMint = this.canonicalizeMint(mint);
        return {
            canonicalKey: `MINT:${cMint}`,
            isDominant: true, // Mint address always strictly dominates symbol identity
        };
    }
    static isWalletAddress(address, isAta) {
        return !isAta && address.length >= 32 && address.length <= 44;
    }
}
/**
 * HEPHAESTUS: Protocol Program Semantics
 */
export class HephaestusSemantics {
    static inspectProgramSemantics(programId, extensions) {
        const isToken2022 = programId === TOKEN_2022_PROGRAM_ID;
        const isStandardSpl = programId === SPL_TOKEN_PROGRAM_ID;
        const hasTransferFee = Boolean(extensions?.includes('TransferFeeConfig'));
        const hasFreezeDelegate = Boolean(extensions?.includes('DefaultAccountState'));
        // Safe core: Non-standard / dangerous transfer fee tokens are restricted from autonomous execution
        const isExecutionPermitted = isStandardSpl || (isToken2022 && !hasTransferFee);
        return {
            isToken2022,
            isStandardSpl,
            hasTransferFee,
            hasFreezeDelegate,
            isExecutionPermitted,
        };
    }
}
//# sourceMappingURL=metron-theseus.js.map