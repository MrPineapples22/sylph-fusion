/**
 * A current operator projection replaces all cached fallback display state.
 * Missing or expired evidence must therefore render as unknown, never as the
 * previous healthy status.
 */
export function selectSystemStrip(projection, isStale, cachedStrip) {
  return projection
    ? (isStale ? null : (projection.systemStrip ?? null))
    : cachedStrip;
}
