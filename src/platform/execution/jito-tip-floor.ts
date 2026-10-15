/** Convert Jito's decimal SOL tip-floor observation to lamports without float multiplication. */
export function solTipFloorToLamports(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const match = /^([0-9]+)(?:\.([0-9]*))?(?:e([+-]?[0-9]+))?$/i.exec(value.toString());
  if (!match) return null;
  const exponent = Number(match[3] ?? 0);
  const fraction = match[2] ?? '';
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
  const digits = BigInt(`${match[1]}${fraction}` || '0');
  const shift = exponent - fraction.length + 9;
  if (shift >= 0) return digits * (10n ** BigInt(shift));
  const divisor = 10n ** BigInt(-shift);
  const quotient = digits / divisor;
  return digits % divisor === 0n ? quotient : quotient + 1n;
}

export function boundedSolTipFloorToLamports(value: unknown, maximumLamports: number): bigint | null {
  if (!Number.isSafeInteger(maximumLamports) || maximumLamports < 0) return null;
  const parsed = solTipFloorToLamports(value);
  if (parsed === null) return null;
  const maximum = BigInt(maximumLamports);
  return parsed > maximum ? maximum : parsed;
}
