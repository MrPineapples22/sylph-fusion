const money = new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2});
const number = new Intl.NumberFormat('en-US', {maximumFractionDigits:2, notation:'compact'});
export const formatMoney = value => Number.isFinite(value) ? money.format(value) : 'Unknown';
export const formatNumber = value => Number.isFinite(value) ? number.format(value) : 'Unknown';
export function formatPrice(value) {
  if (!Number.isFinite(value)) return 'Unknown';
  if (value === 0) return '$0.00';
  if (Math.abs(value) < .00000001) return '$' + value.toExponential(4);
  return new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', minimumFractionDigits:2, maximumFractionDigits:Math.abs(value)<1?10:2}).format(value);
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
