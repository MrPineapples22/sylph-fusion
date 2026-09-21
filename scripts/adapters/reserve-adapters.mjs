/** Decode a standard SPL Token account amount (u64 little-endian at byte 64). */
export function parseSplTokenVaultAmount(accountBuffer) {
  if (!accountBuffer || accountBuffer.length < 72) {
    throw new Error(`Buffer underrun: expected >= 72 bytes, got ${accountBuffer?.length ?? 0}`);
  }
  return accountBuffer.readBigUInt64LE(64);
}

/** Extract Raydium V4 vault public-key byte ranges from a pool account. */
export function parseRaydiumV4PoolState(poolBuffer) {
  if (!poolBuffer || poolBuffer.length < 752) {
    throw new Error(`Invalid Raydium V4 pool state length: ${poolBuffer?.length ?? 0}`);
  }
  return { coinVaultPubkey: poolBuffer.subarray(32, 64), pcVaultPubkey: poolBuffer.subarray(64, 96) };
}

export function normalizeRaydiumReserves({ coinVaultBuffer, pcVaultBuffer, isSolBase, slot }) {
  const coin = parseSplTokenVaultAmount(coinVaultBuffer);
  const pc = parseSplTokenVaultAmount(pcVaultBuffer);
  return { sol: isSolBase ? coin : pc, token: isSolBase ? pc : coin, slot, protocol: 'RAYDIUM_V4' };
}

/** Decode Pump.fun bonding-curve virtual and real reserves. */
export function parsePumpBondingCurve(curveBuffer, slot) {
  if (!curveBuffer || curveBuffer.length < 49) {
    throw new Error(`Invalid Pump bonding curve buffer length: ${curveBuffer?.length ?? 0}`);
  }
  return {
    sol: curveBuffer.readBigUInt64LE(16),
    token: curveBuffer.readBigUInt64LE(8),
    realSol: curveBuffer.readBigUInt64LE(32),
    realToken: curveBuffer.readBigUInt64LE(24),
    complete: curveBuffer.readUInt8(48) === 1,
    slot,
    protocol: 'PUMP_FUN'
  };
}
