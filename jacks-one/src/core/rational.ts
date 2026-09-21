/**
 * Exact Rational Arithmetic using BigInt.
 * Invariant: denominator is always > 0n, fractions are automatically reduced by gcd.
 */

export interface Rational {
  readonly num: bigint;
  readonly den: bigint;
}

export function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x === 0n ? 1n : x;
}

export function makeRational(numerator: bigint | number, denominator: bigint | number = 1n): Rational {
  let n = typeof numerator === 'number' ? BigInt(Math.trunc(numerator)) : numerator;
  let d = typeof denominator === 'number' ? BigInt(Math.trunc(denominator)) : denominator;

  if (d === 0n) {
    throw new Error('Denominator cannot be zero.');
  }

  if (d < 0n) {
    n = -n;
    d = -d;
  }

  const divisor = gcd(n, d);
  return {
    num: n / divisor,
    den: d / divisor,
  };
}

export const ZERO = makeRational(0n, 1n);
export const ONE = makeRational(1n, 1n);

export function addRational(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function subRational(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.den - b.num * a.den, a.den * b.den);
}

export function mulRational(a: Rational, b: Rational): Rational {
  return makeRational(a.num * b.num, a.den * b.den);
}

export function divRational(a: Rational, b: Rational): Rational {
  if (b.num === 0n) {
    throw new Error('Division by zero rational');
  }
  return makeRational(a.num * b.den, a.den * b.num);
}

export function compareRational(a: Rational, b: Rational): number {
  const diff = a.num * b.den - b.num * a.den;
  if (diff < 0n) return -1;
  if (diff > 0n) return 1;
  return 0;
}

export function rationalToNumber(r: Rational): number {
  return Number(r.num) / Number(r.den);
}

export function rationalToDecimalString(r: Rational, digits = 8): string {
  if (r.den === 1n) {
    return r.num.toString() + '.' + '0'.repeat(digits);
  }

  const negative = r.num < 0n;
  const absNum = negative ? -r.num : r.num;

  const integerPart = absNum / r.den;
  let remainder = absNum % r.den;

  let dec = '';
  for (let i = 0; i < digits; i++) {
    remainder *= 10n;
    dec += (remainder / r.den).toString();
    remainder %= r.den;
  }

  return (negative ? '-' : '') + integerPart.toString() + '.' + dec;
}

export function rationalToJSON(r: Rational) {
  return {
    numerator: r.num.toString(),
    denominator: r.den.toString(),
    decimal_approx: rationalToNumber(r),
  };
}
