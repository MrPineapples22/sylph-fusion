export const DISCOVERY_SORTS = [
  ['ranking', 'Snapshot ranking'], ['liquidity', 'Liquidity: high to low'],
  ['signal', 'HSI: high to low'], ['recent', 'Observation: newest first'], ['symbol', 'Symbol: A to Z'],
];
const tiers = { Watch: 'DEVELOPING', Prime: 'PRIME', Restricted: 'QUARANTINED', Vetoed: 'VETOED' };
export function discoveryRows(tokens, stableOrder, { query = '', filter = 'All evidence', sort = 'ranking' } = {}) {
  const byMint = new Map(tokens.map(token => [token.mint, token]));
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [...new Set(stableOrder)].map(mint => byMint.get(mint)).filter(Boolean).filter(token => {
    const text = `${token.symbol || ''} ${token.mint}`.toLowerCase();
    return terms.every(term => text.includes(term)) && (!tiers[filter] || token.tier === tiers[filter]);
  });
  const field = { liquidity: 'liquidity', signal: 'highSignalIndex', recent: 'at' }[sort];
  if (sort === 'symbol') rows.sort((a, b) => (a.symbol || a.mint).localeCompare(b.symbol || b.mint));
  else if (field) rows.sort((a, b) => {
    const aKnown = Number.isFinite(a[field]) && !(sort === 'signal' && a.isNativeAsset);
    const bKnown = Number.isFinite(b[field]) && !(sort === 'signal' && b.isNativeAsset);
    return aKnown && bKnown ? b[field] - a[field] : Number(bKnown) - Number(aKnown);
  });
  return rows;
}
