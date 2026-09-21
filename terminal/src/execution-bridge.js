// Pure translation boundary between the terminal's USD/number ledger and the
// credential-free execution engine's lamport/base-unit contract.
export const LAMPORTS_PER_SOL = 1_000_000_000n;

function finitePositive(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new RangeError(`${name} must be positive`);
  return n;
}

function safeBigInt(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} exceeds safe integer range`);
  return BigInt(value);
}

/** Convert a terminal USD order into an ExecutionEngine OrderRequest. */
export function orderFromUsd({ orderId, tokenMint, poolAddress, side, usdAmount, solPriceUsd,
  tokenDecimals = 9, maxSlippageBps = 300, triggerTimestamp = Date.now(), emergency = false }) {
  const usd = finitePositive(usdAmount, 'usdAmount');
  const sol = finitePositive(solPriceUsd, 'solPriceUsd');
  const decimals = Number.isInteger(tokenDecimals) && tokenDecimals >= 0 && tokenDecimals <= 18 ? tokenDecimals : 9;
  const lamports = Math.round((usd / sol) * Number(LAMPORTS_PER_SOL));
  return { orderId, tokenMint, poolAddress, side, amountLamports: safeBigInt(lamports, 'amountLamports'),
    amountDecimals: side === 'SELL' ? decimals : 9, maxSlippageBps, triggerTimestamp, emergency };
}

/** Project a filled report into the terminal's USD position vocabulary. */
export function fillToTerminal({ report, solPriceUsd, tokenDecimals = 9 }) {
  const sol = finitePositive(solPriceUsd, 'solPriceUsd');
  const decimals = Number.isInteger(tokenDecimals) && tokenDecimals >= 0 && tokenDecimals <= 18 ? tokenDecimals : 9;
  const scale = 10 ** decimals;
  const inputSol = Number(report.inputAmount) / Number(LAMPORTS_PER_SOL);
  const feesSol = Number(report.priorityFeeLamports + report.jitoTipLamports) / Number(LAMPORTS_PER_SOL);
  return { status: report.status, priceUsd: report.execPrice * sol * scale / 1e9,
    inputUsd: inputSol * sol, feesUsd: feesSol * sol,
    outputTokens: Number(report.outputAmount) / scale,
    outputUsd: (Number(report.outputAmount) / Number(LAMPORTS_PER_SOL)) * sol,
    slotLatency: report.slotLatency, failureReason: report.failureReason };
}

export function tokenQtyToBaseUnits(qty, decimals = 9) {
  const n = finitePositive(qty, 'qty');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('invalid decimals');
  return safeBigInt(Math.round(n * 10 ** decimals), 'token amount');
}
