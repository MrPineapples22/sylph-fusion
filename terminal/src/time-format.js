/**
 * Time formatting and data freshness utility for Sylph Fusion.
 * Handles UTC / Local toggling and exact freshness metric ages.
 */

export function formatTime(timestamp, mode = 'local', includeDate = false) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '—';

  if (mode === 'utc') {
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const mins = String(d.getUTCMinutes()).padStart(2, '0');
    const secs = String(d.getUTCSeconds()).padStart(2, '0');
    const timeStr = `${hours}:${mins}:${secs} UTC`;

    if (includeDate) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day} ${timeStr}`;
    }
    return timeStr;
  }

  // Local mode
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  const timeStr = `${hours}:${mins}:${secs}`;

  if (includeDate) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day} ${timeStr}`;
  }
  return timeStr;
}

export function formatFreshness(ageMs) {
  if (ageMs == null || ageMs < 0) return '—';
  if (ageMs < 1000) return `${Math.round(ageMs)}ms`;
  if (ageMs < 60000) return `${(ageMs / 1000).toFixed(1)}s`;
  const mins = Math.floor(ageMs / 60000);
  const secs = Math.floor((ageMs % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function getFreshnessBadge(ageMs, isError = false) {
  if (isError) {
    return {
      status: 'disconnected',
      label: 'DISCONNECTED',
      tone: 'negative',
      ageFormatted: formatFreshness(ageMs),
    };
  }

  if (ageMs == null || isNaN(ageMs)) {
    return {
      status: 'unknown',
      label: 'UNKNOWN',
      tone: 'muted',
      ageFormatted: '—',
    };
  }

  if (ageMs > 5000) {
    return {
      status: 'stale',
      label: 'STALE',
      tone: 'warning',
      ageFormatted: formatFreshness(ageMs),
    };
  }

  return {
    status: 'live',
    label: 'LIVE',
    tone: 'positive',
    ageFormatted: formatFreshness(ageMs),
  };
}
