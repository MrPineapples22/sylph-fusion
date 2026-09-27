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
export function asLamports(value) {
    if (typeof value !== 'bigint')
        throw new TypeError('Lamports require bigint');
    return value;
}
export function asTokenBaseUnits(value) {
    if (typeof value !== 'bigint' || value < 0n)
        throw new TypeError('Token base units require nonnegative bigint');
    return value;
}
export function asBasisPoints(value) {
    if (typeof value !== 'bigint')
        throw new TypeError('Basis points require bigint');
    if (value < 0n || value > 10000n) {
        throw new Error(`BasisPoints must be between 0 and 10000, received ${value}`);
    }
    return value;
}
export function asSlot(value) {
    if (typeof value !== 'bigint')
        throw new TypeError('Slot requires bigint');
    if (value < 0n)
        throw new Error(`Slot cannot be negative: ${value}`);
    return value;
}
/**
 * Exact integer division with explicit rounding modes.
 */
export function divExact(numerator, denominator, mode = 'FLOOR') {
    if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint')
        throw new TypeError('Exact division requires bigint');
    if (!['FLOOR', 'CEIL', 'BANKERS', 'CONSERVATIVE_IN', 'CONSERVATIVE_OUT'].includes(mode))
        throw new Error('Unknown rounding mode');
    if (denominator === 0n)
        throw new RangeError('Division by zero');
    if (numerator === 0n)
        return 0n;
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
            if (isNegative)
                adjusted += 1n;
            break;
        case 'CEIL':
            if (!isNegative)
                adjusted += 1n;
            break;
        case 'CONSERVATIVE_IN':
            // Minimize income or credits
            if (isNegative)
                adjusted += 1n;
            break;
        case 'CONSERVATIVE_OUT':
            // Maximize expense or reservation
            if (!isNegative)
                adjusted += 1n;
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
export function mulBpsExact(amount, bps, mode = 'FLOOR') {
    return divExact(amount * BigInt(bps), 10000n, mode);
}
export class NumeraireAuthority {
    /**
     * Verifies the fundamental financial conservation invariant.
     * Throws an invariant error if any lamport is unaccounted for.
     */
    static assertConservation(state) {
        for (const [key, value] of Object.entries(state)) {
            if (typeof value !== 'bigint' || (key !== 'realizedEconomicResult' && value < 0n))
                throw new Error('Invalid exact conservation quantity: ' + key);
        }
        const leftSide = BigInt(state.openingCapital) +
            BigInt(state.externalDeposits) -
            BigInt(state.externalWithdrawals) +
            BigInt(state.realizedEconomicResult);
        const rightSide = BigInt(state.availableBalance) +
            BigInt(state.reservedCapital) +
            BigInt(state.deployedInPositions) +
            BigInt(state.pendingSettlement);
        const discrepancyLamports = leftSide - rightSide;
        if (discrepancyLamports !== 0n) {
            throw new Error(`NUMERAIRE CONSERVATION VIOLATION: Discrepancy of ${discrepancyLamports} lamports detected! ` +
                `Expected ${leftSide}, actual allocation ${rightSide}`);
        }
        return { isConserved: true, discrepancyLamports: 0n };
    }
}
//# sourceMappingURL=numeraire.js.map