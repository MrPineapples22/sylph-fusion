/**
 * SYLPH-SOL / AETHER FLUX - Semantic Boundaries (METRON, THESEUS, HEPHAESTUS)
 * Specifications: Sections 40, 41.
 *
 * Implements:
 * 1. METRON: Typed numeric units, conversion contracts & precision safeguards
 * 2. THESEUS: Canonical mint identity & address-dominant resolution
 * 3. HEPHAESTUS: Solana token program semantics & Token-2022 verification
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * METRON: Numeric Safety & Typed Conversions
 */
export class MetronUnits {
  public static lamportsToSol(lamports: bigint | number): number {
    const l = typeof lamports === 'bigint' ? lamports : BigInt(Math.floor(lamports));
    return Number(l) / 1_000_000_000;
  }

  public static solToLamports(sol: number): bigint {
    this.assertValidNumber(sol, 'sol');
    return BigInt(Math.round(sol * 1_000_000_000));
  }

  public static baseUnitsToDisplay(baseUnits: bigint | number, decimals: number): number {
    this.assertValidNumber(decimals, 'decimals');
    const factor = 10 ** decimals;
    const bu = typeof baseUnits === 'bigint' ? Number(baseUnits) : baseUnits;
    this.assertValidNumber(bu, 'baseUnits');
    return bu / factor;
  }

  public static displayToBaseUnits(displayUnits: number, decimals: number): bigint {
    this.assertValidNumber(displayUnits, 'displayUnits');
    this.assertValidNumber(decimals, 'decimals');
    const factor = 10 ** decimals;
    return BigInt(Math.round(displayUnits * factor));
  }

  public static bpsToFraction(bps: number): number {
    this.assertValidNumber(bps, 'bps');
    return bps / 10_000;
  }

  public static fractionToBps(fraction: number): number {
    this.assertValidNumber(fraction, 'fraction');
    return Math.round(fraction * 10_000);
  }

  public static assertValidNumber(val: number, name: string): void {
    if (val === null || val === undefined || Number.isNaN(val) || !Number.isFinite(val)) {
      throw new Error(`[METRON_NUMERIC_SAFETY] Invalid numeric value for ${name}: ${val}`);
    }
  }

  public static clamp(val: number, min: number, max: number): number {
    this.assertValidNumber(val, 'val');
    return Math.max(min, Math.min(max, val));
  }
}

/**
 * THESEUS: Canonical Mint Identity
 */
export class TheseusIdentity {
  public static canonicalizeMint(rawMint: string): string {
    if (!rawMint || typeof rawMint !== 'string') {
      throw new Error(`[THESEUS_IDENTITY_VIOLATION] Empty or non-string mint identity: ${rawMint}`);
    }
    const trimmed = rawMint.trim();
    if (trimmed.length < 32 || trimmed.length > 44) {
      throw new Error(`[THESEUS_IDENTITY_VIOLATION] Invalid base58 mint length: ${trimmed.length}`);
    }
    return trimmed;
  }

  public static verifyMintDominance(mint: string, symbol: string): {
    canonicalKey: string;
    isDominant: boolean;
  } {
    const cMint = this.canonicalizeMint(mint);
    return {
      canonicalKey: `MINT:${cMint}`,
      isDominant: true, // Mint address always strictly dominates symbol identity
    };
  }

  public static isWalletAddress(address: string, isAta: boolean): boolean {
    return !isAta && address.length >= 32 && address.length <= 44;
  }
}

/**
 * HEPHAESTUS: Protocol Program Semantics
 */
export class HephaestusSemantics {
  public static inspectProgramSemantics(programId: string, extensions?: readonly string[]): {
    isToken2022: boolean;
    isStandardSpl: boolean;
    hasTransferFee: boolean;
    hasFreezeDelegate: boolean;
    isExecutionPermitted: boolean;
  } {
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
