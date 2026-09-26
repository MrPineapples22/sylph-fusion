import { calculateOptimalBuyPositionValue } from '../position-sizer.js';
import React from 'react';
import { ArrowUpRight, Activity, ShieldCheck, Lock } from 'lucide-react';
import { EmptyState, Status } from '../design-system/primitives.jsx';
import { formatMoney, formatNumber, formatPrice } from '../design-system/format.js';

const readable = value => value ? String(value).replaceAll('_', ' ').toLowerCase() : 'Unknown';

export function CommandCenterView({ projection, current = false, loading = false, onNavigate, onInvestigate, onPaperBuy, autoTradePrime = false, onToggleAutoTradePrime }) {
  const sourceRows = projection?.rows ?? projection?.tokens;
  const rows = Array.isArray(sourceRows) ? sourceRows.filter(Boolean) : null;
  const candidates = rows?.filter(row => row.tier === 'PRIME') ?? [];
  const developing = rows?.filter(row => row.tier === 'DEVELOPING') ?? [];
  const positions = Array.isArray(projection?.positions) ? projection.positions.filter(Boolean) : null;
  const context = current ? 'Current projection' : projection ? 'Historical / unverified projection' : 'Evidence unavailable';
  const capabilityEntries = ['open', 'increase', 'reduce', 'close'].map(name => ({ name, ...projection?.capabilities?.[name] }));
  const isIdleNoPosition = (entry) => {
    const reasons = (entry.reasonCodes || []).map(r => String(r).toUpperCase());
    return (positions?.length === 0 || !positions) && (reasons.includes('NO_POSITION') || reasons.includes('NO POSITION'));
  };
  const attention = current ? capabilityEntries.filter(entry => entry.state && entry.state !== 'READY' && !isIdleNoPosition(entry)) : [];
  const idleCount = current ? capabilityEntries.filter(entry => entry.state && entry.state !== 'READY' && isIdleNoPosition(entry)).length : 0;
  const unknownCount = capabilityEntries.filter(entry => !entry.state || entry.state === 'UNKNOWN').length;
  const headline = !projection ? 'Waiting for backend evidence' : !current ? 'Current capability is unknown' : attention.length ? `${formatNumber(attention.length)} capabilities need inspection` : unknownCount ? 'Capability evidence is incomplete' : idleCount > 0 ? 'Waiting for position entry' : 'Review current observations';

  return <div className="op-command-center op-stack" role="region" aria-label="Command overview" aria-busy={loading}>
    <section className="op-section op-command-lead">
      <div className="op-command-lead-top"><span className="op-command-kicker"><Activity size={16} aria-hidden="true"/> Operations overview</span><span className="op-command-readonly">Read-only evidence</span></div>
      <div className="op-command-lead-grid"><div>
      <div className="op-eyebrow">{context}</div>
      <h2>{headline}</h2>
      <p className="op-muted">{!projection ? loading ? 'Connecting to backend evidence. Operational capability is unknown.' : 'Backend evidence is unavailable. Reconnecting automatically.' : !current ? 'Retained observations are historical. Current capability remains unknown.' : attention.length ? 'Inspect the reported constraints before taking action.' : 'Review observations and evidence before preparing an action.'}</p>
      {attention.length > 0 && <div className="op-command-attention"><p><strong>{readable(attention[0].name)}: {readable(attention[0].state)}.</strong> {attention[0].reasonCodes?.length ? attention[0].reasonCodes.map(readable).join(' · ') : 'Reason unavailable.'}</p>{attention.length > 1 && <details><summary>View all {attention.length} capability reasons</summary>{attention.slice(1).map(entry=><p key={entry.name}><strong>{readable(entry.name)}: {readable(entry.state)}.</strong> {entry.reasonCodes?.length ? entry.reasonCodes.map(readable).join(' · ') : 'Reason unavailable.'}</p>)}</details>}</div>}
      <div className="op-command-actions">
        {onNavigate && <button type="button" className={attention.length ? 'op-button op-primary' : 'op-button'} onClick={() => onNavigate(attention.length ? 'System' : 'Aether Flux')}>{attention.length ? 'Inspect system details' : 'Explore discovery'}</button>}
        {onNavigate && <button type="button" className="op-button" onClick={() => onNavigate('Positions')}>Inspect reported capital</button>}
      </div>
      </div><aside className="op-command-brief" aria-label="Evidence brief"><span className="op-command-label">At a glance</span><dl><div><dt>Observed candidates</dt><dd>{rows ? formatNumber(rows.length) : 'Unknown'}</dd></div><div><dt>Reported positions</dt><dd>{positions ? formatNumber(positions.length) : 'Unknown'}</dd></div><div><dt>Capabilities reported</dt><dd>{current && projection ? `${4 - unknownCount} / 4` : 'Unknown'}</dd></div></dl><p className="op-muted">{current ? 'Facts from the current projection.' : 'Current operational state is unknown.'}</p></aside></div>
    </section>
    <div className="op-command-summary">
      <section className="op-section op-command-fact"><h3>Discovery evidence</h3><p className="op-command-key-value">{rows ? (candidates.length > 0 ? `${formatNumber(candidates.length)} Prime · ${formatNumber(developing.length)} Developing` : `${formatNumber(developing.length)} Developing`) : 'Unknown'}</p><p className="op-muted">{rows ? `${formatNumber(rows.length)} observed candidates · ${context}` : 'Candidate evidence unavailable.'} A discovery tier does not grant execution permission.</p></section>
      <section className="op-section op-command-fact"><h3>Reported capital</h3><dl className="op-command-values"><div><dt>Available · USD</dt><dd>{formatMoney(projection?.capital?.available)}</dd></div><div><dt>Reserved · USD</dt><dd>{formatMoney(projection?.capital?.reserved)}</dd></div></dl><p className="op-muted">{context} · Ledger values only; live wallet exposure is unknown.</p></section>
      <section className="op-section op-command-fact"><h3>Position evidence</h3><p className="op-command-key-value">{positions ? `${formatNumber(positions.length)} reported` : 'Unknown'}</p><p className="op-muted">Exposure: Unknown. {positions ? 'A position count does not establish reconciliation or live exposure.' : 'Position records are unavailable.'}</p></section>
      <section className="op-section op-command-fact"><h3>Exit Guardian &amp; Learning</h3><p className="op-command-key-value" style={{color:'#14F195',fontSize:'15px',fontWeight:700}}>MFE / MAE Active</p><p className="op-muted">Dynamic Trailing (+15%), False Breakout Cut (&le; -2.5%), Hard Stop (-12%). Pavlov attribution armed.</p></section>
    </div>
    <section className="op-section op-command-veto">
      <div className="op-section-heading">
        <div>
          <div className="op-command-kicker"><Lock size={16} aria-hidden="true"/> Safety &amp; Veto Evidence</div>
          <h3>Verification Evidence Availability</h3>
          <p className="op-muted">Epistemic doctrine: VETO MEANS PROVEN VETO (VETO !== UNKNOWN · VETO !== PENDING · VETO !== BLOCKED)</p>
        </div>
        {onNavigate && <button type="button" className="op-button" onClick={() => onNavigate('System')}>Inspect Sentinel <ArrowUpRight size={15} aria-hidden="true"/></button>}
      </div>
      <div className="op-command-capability-grid">
        <article className="op-command-capability">
          <div className="op-command-capability-heading">
            <h4>Safety Rule Registry</h4>
            <Status value="UNKNOWN" />
          </div>
          <p className="op-muted">Registry signature, rule count, and epoch are not present in this operator projection.</p>
        </article>
        <article className="op-command-capability">
          <div className="op-command-capability-heading">
            <h4>Dual Monotonicity</h4>
            <Status value="UNKNOWN" />
          </div>
          <p className="op-muted">A safety-kernel claim requires a current, independently verifiable release artifact.</p>
        </article>
        <article className="op-command-capability">
          <div className="op-command-capability-heading">
            <h4>Sentinel Binary Probes</h4>
            <Status value="UNKNOWN" />
          </div>
          <p className="op-muted">Replay-probe results are not present in this operator projection.</p>
        </article>
        <article className="op-command-capability">
          <div className="op-command-capability-heading">
            <h4>Merkle Proof Vault</h4>
            <Status value="UNKNOWN" />
          </div>
          <p className="op-muted">Proof-vault availability and tombstone state are not present in this operator projection.</p>
        </article>
      </div>
    </section>
    <section className="op-section op-command-context"><h3>Observation context</h3><div className="op-command-context-grid">
      <div><span className="op-command-label">System</span><Status value={current ? projection?.system?.state : 'UNKNOWN'} /><p className="op-muted">{projection?.system?.reason || 'Reason unavailable.'}</p></div>
      <div><span className="op-command-label">Market data</span><Status value={current ? projection?.marketData?.state : 'UNKNOWN'} /><p className="op-muted">{Number.isFinite(projection?.marketData?.ageMs) ? `Age at projection: ${(projection.marketData.ageMs / 1000).toFixed(1)}s` : 'Observation age unknown.'}</p></div>
    </div></section>
    <section className="op-section"><div className="op-section-heading"><div><h3>{candidates.length > 0 ? 'Prime candidates' : 'Developing candidates'}</h3><p className="op-muted">{context} · Investigation only</p></div><div style={{display:'flex',gap:'8px',alignItems:'center'}}>{onToggleAutoTradePrime && <button type="button" className={`op-button ${autoTradePrime ? 'op-primary' : ''}`} style={autoTradePrime ? {background:'rgba(20,241,149,0.15)',borderColor:'#14F195',color:'#14F195',fontWeight:700} : {}} onClick={onToggleAutoTradePrime}>🤖 Auto-Trade Prime: {autoTradePrime ? 'ARMED' : 'OFF'}</button>}{onNavigate && <button type="button" className="op-button" onClick={() => onNavigate('Aether Flux')}>View discovery</button>}</div></div>
      {candidates.length > 0 ? <div className="op-command-candidates">{candidates.slice(0, 6).map((token, index) => <article key={`${token.mint || 'candidate'}-${index}`} className="op-data-card"><h4>{token.symbol || 'Unknown token'}</h4><p className="op-mono op-muted">{token.mint || 'Mint unknown'}</p><p className="op-muted">{current ? 'Prime at current projection' : 'Historical Prime tier'} · Price {formatPrice(token.price)}</p><div style={{display:'flex',gap:'6px',marginTop:'8px'}}><button type="button" className="op-button" data-token={token.mint} disabled={!token.mint || !onInvestigate} onClick={event => onInvestigate?.(token, event)}>Investigate {token.symbol || token.mint || 'token'}</button>{onPaperBuy && (() => {
  const sizing = calculateOptimalBuyPositionValue(token, { capital: projection?.capital, activePositionsCount: (projection?.positions || []).length, maxPositions: 2 });
  return (
    <button type="button" className="op-button" style={{color:'#10B981',borderColor:'rgba(16,185,129,0.3)',background:'rgba(16,185,129,0.08)',fontWeight:600}} onClick={() => onPaperBuy(token, sizing.optimalUsd)} title={sizing.rationale}>
      ⚡ Buy ${sizing.optimalUsd.toFixed(2)}
    </button>
  );
})()}</div></article>)}</div>
        : developing.length > 0 ? <div className="op-command-candidates">{developing.slice(0, 6).map((token, index) => <article key={`${token.mint || 'candidate'}-${index}`} className="op-data-card"><h4>{token.symbol || 'Unknown token'}</h4><p className="op-mono op-muted">{token.mint || 'Mint unknown'}</p><p className="op-muted">{current ? 'Developing (Passes Quality)' : 'Historical Developing'} · Price {formatPrice(token.price)}</p><div style={{display:'flex',gap:'6px',marginTop:'8px'}}><button type="button" className="op-button" data-token={token.mint} disabled={!token.mint || !onInvestigate} onClick={event => onInvestigate?.(token, event)}>Investigate {token.symbol || token.mint || 'token'}</button>{onPaperBuy && (() => {
  const sizing = calculateOptimalBuyPositionValue(token, { capital: projection?.capital, activePositionsCount: (projection?.positions || []).length, maxPositions: 2 });
  return (
    <button type="button" className="op-button" style={{color:'#10B981',borderColor:'rgba(16,185,129,0.3)',background:'rgba(16,185,129,0.08)',fontWeight:600}} onClick={() => onPaperBuy(token, sizing.optimalUsd)} title={sizing.rationale}>
      ⚡ Buy ${sizing.optimalUsd.toFixed(2)}
    </button>
  );
})()}</div></article>)}</div>
        : <EmptyState title={loading ? 'Loading candidates' : rows ? 'No candidates reported' : 'Candidate evidence unavailable'}>{rows ? 'No candidates appear in this projection. This does not establish that any token is safe or executable.' : 'Wait for a projection to inspect discovery evidence.'}</EmptyState>}
    </section>
  </div>;
}

export default CommandCenterView;
