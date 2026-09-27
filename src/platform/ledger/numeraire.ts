/**
 * SYLPH FUSION — NUMERAIRE: Exact Economic Arithmetic Authority
 * Specifications: Section 7 (Upgrade 3: Numeraire), Section 103 (Invariants 8, 18)
 *
 * Invariants:
 * 1. Eliminate JavaScript `number` from authoritative financial state.
 * 2. Branded integer types: Lamports, TokenBaseUnits, BasisPoints, Slot, ComputeUnits.
 * 3. Exact rational arithmetic with explicit rounding modes:
 *    FLOOR, CEIL, BANKERS, CONSERVATIVE_IN, CONSERVATIVE_OUT.
 * 4. Financial conservation equation:
 *    openingCapital + deposits - withdrawals + realizedResult == available + reserved + deployed + pendingSettlement.
 */

declare const LamportsBrand: unique symbol;
export type Lamports = bigint & { readonly [LamportsBrand]: true };

declare const TokenBaseUnitsBrand: unique symbol;
export type TokenBaseUnits = bigint & { readonly [TokenBaseUnitsBrand]: true };

declare const BasisPointsBrand: unique symbol;
export type BasisPoints = bigint & { readonly [BasisPointsBrand]: true };

declare const SlotBrand: unique symbol;
export type Slot = bigint & { readonly [SlotBrand]: true };

declare const ComputeUnitsBrand: unique symbol;
export type ComputeUnits = bigint & { readonly [ComputeUnitsBrand]: true };

declare const MicroLamportsPerCUBrand: unique symbol;
export type MicroLamportsPerCU = bigint & { readonly [MicroLamportsPerCUBrand]: true };

export function asLamports(value: bigint): Lamports {
  if (typeof value !== 'bigint') throw new TypeError('Lamports require bigint');
  return value as Lamports;
}

export function asTokenBaseUnits(value: bigint): TokenBaseUnits {
  if (typeof value !== 'bigint' || value < 0n) throw new TypeError('Token base units require nonnegative bigint');
  return value as TokenBaseUnits;
}

export function asBasisPoints(value: bigint): BasisPoints {
  if (typeof value !== 'bigint') throw new TypeError('Basis points require bigint');
  if (value < 0n || value > 10_000n) {
    throw new Error(`BasisPoints must be between 0 and 10000, received ${value}`);
  }
  return value as BasisPoints;
}

export function asSlot(value: bigint): Slot {
  if (typeof value !== 'bigint') throw new TypeError('Slot requires bigint');
  if (value < 0n) throw new Error(`Slot cannot be negative: ${value}`);
  return value as Slot;
}

export type RoundingMode =
  | 'FLOOR'
  | 'CEIL'
  | 'BANKERS'
  | 'CONSERVATIVE_IN'  // Rounds in favor of safety (e.g. higher fee, lower payout)
  | 'CONSERVATIVE_OUT'; // Rounds in favor of safety on outflow (e.g. higher deposit required)

/**
 * Exact integer division with explicit rounding modes.
 */
export function divExact(numerator: bigint, denominator: bigint, mode: RoundingMode = 'FLOOR'): bigint {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') throw new TypeError('Exact division requires bigint');
  if (!['FLOOR', 'CEIL', 'BANKERS', 'CONSERVATIVE_IN', 'CONSERVATIVE_OUT'].includes(mode)) throw new Error('Unknown rounding mode');
  if (denominator === 0n) throw new RangeError('Division by zero');
  if (numerator === 0n) return 0n;

  const isNegative = (numerator < 0n) !== (denominator < 0n);
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;

  const quotient = absNum / absDen;
  const remainder = absNum % absDen;

  if (remainder === 0n) {
    return isNegative ? -quotient : quotient;
  }

  let adjusted = quotient;

  switch (mode) {
    case 'FLOOR':
      if (isNegative) adjusted += 1n;
      break;

    case 'CEIL':
      if (!isNegative) adjusted += 1n;
      break;

    case 'CONSERVATIVE_IN':
      // Minimize income or credits
      if (isNegative) adjusted += 1n;
      break;

    case 'CONSERVATIVE_OUT':
      // Maximize expense or reservation
      if (!isNegative) adjusted += 1n;
      break;

    case 'BANKERS': {
      const half = absDen / 2n;
      const exactHalf = absDen % 2n === 0n && remainder === half;
      if (remainder > half || (exactHalf && quotient % 2n !== 0n)) {
        adjusted += 1n;
      }
      break;
    }
  }

  return isNegative ? -adjusted : adjusted;
}

/**
 * Exact basis points multiplication: (amount * bps) / 10000
 */
export function mulBpsExact(amount: bigint, bps: BasisPoints, mode: RoundingMode = 'FLOOR'): bigint {
  return divExact(amount * BigInt(bps), 10_000n, mode);
}

export interface ConservationLedgerState {
  readonly openingCapital: Lamports;
  readonly externalDeposits: Lamports;
  readonly externalWithdrawals: Lamports;
  readonly realizedEconomicResult: Lamports;
  readonly availableBalance: Lamports;
  readonly reservedCapital: Lamports;
  readonly deployedInPositions: Lamports;
  readonly pendingSettlement: Lamports;
}

export class NumeraireAuthority {
  /**
   * Verifies the fundamental financial conservation invariant.
   * Throws an invariant error if any lamport is unaccounted for.
   */
  public static assertConservation(state: ConservationLedgerState): { isConserved: boolean; discrepancyLamports: bigint } {
    for (const [key, value] of Object.entries(state)) {
      if (typeof value !== 'bigint' || (key !== 'realizedEconomicResult' && value < 0n)) throw new Error('Invalid exact conservation quantity: ' + key);
    }
    const leftSide =
      BigInt(state.openingCapital) +
      BigInt(state.externalDeposits) -
      BigInt(state.externalWithdrawals) +
      BigInt(state.realizedEconomicResult);

    const rightSide =
      BigInt(state.availableBalance) +
      BigInt(state.reservedCapital) +
      BigInt(state.deployedInPositions) +
      BigInt(state.pendingSettlement);

    const discrepancyLamports = leftSide - rightSide;

    if (discrepancyLamports !== 0n) {
      throw new Error(
        `NUMERAIRE CONSERVATION VIOLATION: Discrepancy of ${discrepancyLamports} lamports detected! ` +
        `Expected ${leftSide}, actual allocation ${rightSide}`
      );
    }

    return { isConserved: true, discrepancyLamports: 0n };
  }
}
