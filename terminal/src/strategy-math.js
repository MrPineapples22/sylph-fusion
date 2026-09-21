export function calculateVelocityBps(currentPrice, prevPrice, elapsedMs, signed = true) {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(prevPrice) || prevPrice <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  const result = Math.round((((currentPrice - prevPrice) / prevPrice) / (elapsedMs / 1000)) * 10_000);
  return signed ? result : Math.abs(result);
}

export function isTrailingStopTriggered(currentPrice, highWaterMark, trailingStopBps) {
  if (!Number.isFinite(currentPrice) || !Number.isFinite(highWaterMark) || highWaterMark <= 0 || currentPrice >= highWaterMark) return false;
  return Math.floor(((highWaterMark - currentPrice) / highWaterMark) * 10_000) >= trailingStopBps;
}
