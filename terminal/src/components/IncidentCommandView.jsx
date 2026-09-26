import React, { useState } from 'react';
import { formatNumber } from '../design-system/format.js';
import { Status, EmptyState } from '../design-system/primitives.jsx';

const timestamp = value => {
  if (value == null || value === '') return 'Time unknown';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Time unknown';
};

export function IncidentCommandView({ incidents = [], changes = [], current = false, loading = false, mode = 'UNKNOWN' }) {
  const [seen, setSeen] = useState(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  const records = Array.isArray(incidents) ? incidents.filter(Boolean) : [];
  const transitions = Array.isArray(changes) ? changes.filter(Boolean) : [];
  return (
    <div className="incident-command-view op-stack" role="region" aria-label="Incidents and operational history" aria-busy={loading}>
      <header><div className="op-eyebrow">{mode} · {current ? 'Current projection' : 'Historical / unverified evidence'}</div><h2>Incidents and blockers</h2><p className="op-muted">Marking an item seen changes this view only. It does not acknowledge or resolve an incident in the backend, and resets when this view is closed.</p></header>
      <p className="op-sr-only" role="status" aria-live="polite">{announcement}</p>
      {!current && <p className="op-notice">Current incident evidence is unavailable. Retained records are historical and may not describe current conditions.</p>}
      <section className="op-section">
        <h3>Reported incidents ({formatNumber(records.length)})</h3>
        {records.length ? <div className="op-stack">{records.map((incident, index) => {
          const key = incident.incidentId || JSON.stringify([incident.reasonCode, incident.detectedAt, incident.operatorAction, index]);
          const isSeen = seen.has(key);
          return <article key={key} className="op-incident-card">
            <div className="op-card-header"><h4>{incident.reasonCode || 'Incident details unknown'}</h4><Status value={current ? incident.state || 'UNKNOWN' : 'UNKNOWN'} label={current ? incident.state || 'State unknown' : 'Historical / unverified'} /></div>
            <p className="op-muted">Priority: {incident.priority || 'Unknown'} · {timestamp(incident.detectedAt)}</p>
            <p>{incident.operatorAction || 'No operator action was supplied with this record.'}</p>
            <div className="op-card-footer"><span className="op-muted">{isSeen ? 'Seen locally · this view only' : 'Not marked seen locally'}</span><button type="button" className="op-button" disabled={isSeen} onClick={() => { setSeen(previous => new Set(previous).add(key)); setAnnouncement(`${incident.reasonCode || 'Incident'} marked seen locally. Backend state is unchanged.`); }}>{isSeen ? 'Seen locally' : 'Mark seen locally'}</button></div>
          </article>;
        })}</div> : <EmptyState title={loading ? 'Loading incident evidence' : current ? 'No incidents reported' : 'Incident evidence unavailable'}>{current ? 'This projection contains no incident records. It does not establish that all systems are healthy.' : 'A current projection is needed to inspect reported incidents.'}</EmptyState>}
      </section>
      <section className="op-section"><h3>Operational history</h3>{transitions.length ? <ol className="op-transition-list">{transitions.map((change, index) => <li key={change.id || index} className="op-transition-row"><span className="op-mono op-muted">{timestamp(change.at)}</span><span>{change.text || 'Transition details unavailable'}</span></li>)}</ol> : <EmptyState title={loading ? 'Loading operational history' : 'No transitions reported'}>No operational transition records are available in this projection.</EmptyState>}</section>
    </div>
  );
}
export default IncidentCommandView;
