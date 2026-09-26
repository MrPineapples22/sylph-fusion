import React, { useEffect, useMemo, useState } from 'react';
import { formatMoney, formatPrice, formatNumber } from '../design-system/format.js';
import { Status, EmptyState } from '../design-system/primitives.jsx';

import { DISCOVERY_SORTS, discoveryRows } from './discovery-view.js';

const PAGE_SIZE = 50;
const age = value => Number.isFinite(value) && value >= 0 ? `${(value / 1000).toFixed(1)}s` : 'Unknown';
const identity = token => token.symbol || token.mint;
const observedAge = (token, current, marketState, generatedAt) => {
  if (!current || !Number.isFinite(token.at)) return 'Unknown';
  const value = age(generatedAt - token.at);
  return marketState === 'CURRENT' || value === 'Unknown' ? value : `Unverified · ${value}`;
};

export function AetherFlux({
  loading = false, onViewSystem = () => {}, tokens = [], stableOrder = [], filter = 'All evidence', query = '', current = true,
  marketState = 'UNKNOWN', generatedAt = Date.now(), lastRefreshedAt = Date.now(),
  page: controlledPage, onPageChange, comparison = [], onFilterChange = () => {}, onQueryChange = () => {},
  onInvestigate = () => {}, onCompare = () => {}, onRefreshRanking = () => {},
}) {
  const [localPage, setLocalPage] = useState(0);
  const [sort, setSort] = useState('ranking');
  const page = controlledPage ?? localPage;
  const setPage = value => { const next=typeof value==='function'?value(page):value; if(onPageChange)onPageChange(next);else setLocalPage(next); };
  const byMint = useMemo(() => new Map(tokens.map(token => [token.mint, token])), [tokens]);
  const rows = useMemo(() => discoveryRows(tokens, stableOrder, { query, filter, sort }), [tokens, stableOrder, query, filter, sort]);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Number.isInteger(page) ? Math.max(0, Math.min(page, pageCount - 1)) : 0;

  useEffect(() => { setPage(value => Math.min(value, pageCount - 1)); }, [pageCount]);
  const visibleRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const clearFilters = () => { setPage(0); onQueryChange(''); onFilterChange('All evidence'); };
  const comparisonFull = comparison.length >= 4;
  const compareButton = token => (
    <button type="button" className="btn-secondary" aria-label={`${comparison.includes(token.mint) ? 'Remove' : 'Compare'} ${identity(token)}${comparison.includes(token.mint) ? ' from comparison' : ''}`}
      aria-pressed={comparison.includes(token.mint)} disabled={comparisonFull && !comparison.includes(token.mint)}
      title={comparisonFull && !comparison.includes(token.mint) ? 'Remove a token to compare another. Maximum four tokens.' : undefined}
      onClick={() => onCompare(token.mint)}>
      {comparison.includes(token.mint) ? '✓ Selected' : 'Compare'}
    </button>
  );
  const tokenButton = token => <button type="button" className="op-token-link" data-token={token.mint} onClick={event => onInvestigate(token, event)}>{identity(token)}</button>;
  const pending = token => token.isNativeAsset ? 'Native asset' : Array.isArray(token.pending) ? `${token.pending.length} pending` : 'Unknown';
  const hsi = token => token.isNativeAsset ? 'N/A' : formatNumber(token.highSignalIndex);
  const flow = token => token.isNativeAsset ? 'N/A' : token.pod || 'Unknown';
  const tierStatus = token => {
    const tier = token.tier || 'UNKNOWN';
    return <Status value={current ? tier : 'UNKNOWN'} label={current ? undefined : tier === 'UNKNOWN' ? 'Historical tier unavailable' : `Historical tier: ${tier.replaceAll('_', ' ').toLowerCase()}`} />;
  };
  const snapshotEmpty = tokens.length > 0 && !stableOrder.some(mint => byMint.has(mint));
  const emptyTitle = snapshotEmpty ? 'Refresh the discovery snapshot' : tokens.length ? 'No candidates match this view' : loading ? 'Connecting to discovery' : current ? 'No observed candidates' : 'Discovery evidence unavailable';
  const emptyDescription = snapshotEmpty ? 'Observations are available, but none belong to the current ranking snapshot. Refresh ranking to include them.' : tokens.length
    ? `${tokens.length} ${current ? 'observed' : 'retained'} candidates remain outside this view. Clear filters to inspect them.`
    : loading ? 'Waiting for discovery observations. Current candidate state is unknown.'
      : current ? 'An empty discovery feed does not establish that the market is safe or inactive.'
        : 'Current candidate state is unknown. View system status for connection and evidence details.';

  return (
    <section className="aether-flux-view" aria-label="Aether Flux token discovery">
      <div className="op-toolbar">
        <div className="op-toolbar-group">
          <label className="op-field">View<select value={filter} onChange={event => { setPage(0); onFilterChange(event.target.value); }}>
            {['All evidence', 'Watch', 'Prime', 'Restricted', 'Vetoed'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label className="op-field">Sort observations<select value={sort} onChange={event => { setPage(0); setSort(event.target.value); }}>
            {DISCOVERY_SORTS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label className="op-field">Find token<input type="search" value={query} onChange={event => { setPage(0); onQueryChange(event.target.value); }} placeholder="Symbol or mint" aria-label="Find token by symbol or mint" /></label>
        </div>
        <div className="op-toolbar-group">
          <span className="op-refresh-meta">{sort === 'ranking' ? 'Order stays stable until ranking is refreshed' : 'Display sort follows observations; snapshot ranking is preserved'}</span>
          <button type="button" className="btn-secondary" onClick={onRefreshRanking}>Refresh ranking</button>
        </div>
      </div>
      <div className="op-toolbar-group" role="group" aria-label="Discovery evidence views">
        {['All evidence', 'Watch', 'Prime', 'Restricted', 'Vetoed'].map(value => <button type="button" key={value} className="btn-secondary"
          aria-pressed={filter === value} onClick={() => { setPage(0); onFilterChange(value); }}>
          {value} · {discoveryRows(tokens, stableOrder, { filter: value }).length}
        </button>)}
      </div>
      <div className="op-filter-summary">
        <span role="status">{filter} · {rows.length} matching · {Math.max(0, tokens.length - rows.length)} hidden{query ? ` · Search: ${query}` : ''}</span>
        {(query || filter !== 'All evidence') && <button type="button" className="btn-secondary" onClick={clearFilters}>Clear filters</button>}
      </div>
      {!current && tokens.length > 0 && <p className="op-muted" role="status">Displayed candidate tiers and observations are historical. Current eligibility is unknown.</p>}
      {comparisonFull && <p className="op-muted" role="status">Four tokens selected. Remove one from comparison to add another.</p>}
      {!rows.length ? <EmptyState title={emptyTitle}
        action={snapshotEmpty ? <button type="button" onClick={onRefreshRanking}>Refresh ranking</button> : tokens.length ? <button type="button" onClick={clearFilters}>Clear filters</button> : <button type="button" onClick={onViewSystem}>View system status</button>}>
        {emptyDescription}
      </EmptyState> : <>
        <div className="op-grid-scroll" role="region" aria-label="Candidate observations table" tabIndex={0}>
          <table className="op-grid" aria-label="Aether Flux token observations">
            <thead><tr>{['Token', 'Price / liquidity', 'Flow', 'HSI', 'Safety', 'Intel', 'State', 'Observed age', 'Compare'].map(label => <th scope="col" key={label} className={['Price / liquidity', 'HSI', 'Observed age'].includes(label) ? 'op-grid-number' : undefined}>{label}</th>)}</tr></thead>
            <tbody>{visibleRows.map(token => <tr key={token.mint}>
              <th scope="row">{tokenButton(token)}<small className="op-cell-detail op-mono" title={token.mint}>{token.mint.slice(0, 5)}…{token.mint.slice(-5)}</small></th>
              <td className="op-grid-number">{formatPrice(token.price)}<small className="op-cell-detail">Liq {formatMoney(token.liquidity)}</small><small className="op-cell-detail">Cap {formatMoney(token.cap)}</small></td>
              <td>{flow(token)}</td><td className="op-grid-number">{hsi(token)}</td>
              <td><Status value={current ? token.safety || 'UNKNOWN' : 'UNKNOWN'} label={!current?'Historical safety':undefined} /></td><td>{pending(token)}</td>
              <td>{tierStatus(token)}</td>
              <td className="op-grid-number" title="Row observation age; current provider evidence is required to verify freshness.">{observedAge(token, current, marketState, generatedAt)}</td>
              <td>{compareButton(token)}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="op-mobile-candidates" aria-label="Candidate observations">
          {visibleRows.map(token => <article className="op-candidate-card" key={token.mint}>
            <div className="op-card-heading"><div>{tokenButton(token)}<small className="op-cell-detail op-mono" title={token.mint}>{token.mint.slice(0, 5)}…{token.mint.slice(-5)}</small></div>{tierStatus(token)}</div>
            <dl className="op-candidate-metrics">
              <div><dt>Observed price</dt><dd>{formatPrice(token.price)}</dd></div><div><dt>Liquidity</dt><dd>{formatMoney(token.liquidity)}</dd></div>
              <div><dt>Intel</dt><dd>{pending(token)}</dd></div>
              <div><dt>Observed age</dt><dd>{observedAge(token, current, marketState, generatedAt)}</dd></div>
            </dl>
            <details className="op-details"><summary>Evidence details</summary><dl className="op-candidate-metrics">
              <div><dt>Market cap</dt><dd>{formatMoney(token.cap)}</dd></div><div><dt>Flow</dt><dd>{flow(token)}</dd></div>
              <div><dt>HSI</dt><dd>{hsi(token)}</dd></div><div><dt>Safety</dt><dd><Status value={current ? token.safety || 'UNKNOWN' : 'UNKNOWN'} label={!current?'Historical safety':undefined} /></dd></div>
              <div><dt>Decision triad</dt><dd className="op-mono">{token.quality || 'UNKNOWN'} · {token.opportunity || (token.tier === 'PRIME' ? 'ELIGIBLE' : 'PENDING')} · {token.execution || 'BLOCKED'}</dd></div>
            </dl></details>
            <div className="op-card-actions"><button type="button" className="btn-secondary" data-token={token.mint} onClick={event => onInvestigate(token, event)}>Investigate {identity(token)}</button>{compareButton(token)}</div>
          </article>)}
        </div>
        <nav className="op-pagination" aria-label="Candidate pages">
          <button type="button" className="btn-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span role="status">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, rows.length)} of {rows.length} · Page {currentPage + 1} of {pageCount}</span>
          <button type="button" className="btn-secondary" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>
      </>}
      {comparison.length > 0 && <section className="op-comparison" aria-label="Token comparison">
        <div className="op-section-heading"><h2>Compare candidates</h2><span className="op-muted">{comparison.length} of 4 selected · Observations only</span></div>
        <div className="op-comparison-grid">{comparison.slice(0, 4).map(mint => {
          const token = byMint.get(mint);
          return <article className="op-comparison-card" key={mint}>
            <div className="op-card-heading"><h3>{token ? identity(token) : `${mint.slice(0, 5)}…${mint.slice(-5)}`}</h3><button type="button" className="btn-secondary" aria-label={`Remove ${token ? identity(token) : mint} from comparison`} onClick={() => onCompare(mint)}>Remove</button></div>
            {token ? <dl className="op-candidate-metrics">
              <div><dt>Price</dt><dd>{formatPrice(token.price)}</dd></div><div><dt>Market cap</dt><dd>{formatMoney(token.cap)}</dd></div>
              <div><dt>Liquidity</dt><dd>{formatMoney(token.liquidity)}</dd></div><div><dt>HSI</dt><dd>{hsi(token)}</dd></div>
              <div><dt>Flow</dt><dd>{flow(token)}</dd></div><div><dt>Intel</dt><dd>{pending(token)}</dd></div>
              <div><dt>Safety</dt><dd><Status value={current ? token.safety || 'UNKNOWN' : 'UNKNOWN'} label={!current?'Historical safety':undefined} /></dd></div><div><dt>State</dt><dd>{tierStatus(token)}</dd></div>
              <div><dt>Observed age</dt><dd>{observedAge(token, current, marketState, generatedAt)}</dd></div>
            </dl> : <p className="op-muted">This token is no longer in the displayed observation feed. Its evidence is unknown.</p>}
          </article>;
        })}</div>
      </section>}
    </section>
  );
}

export default AetherFlux;



