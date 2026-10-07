import React, {useCallback, useEffect, useState} from 'react';
import {Activity, RefreshCw} from 'lucide-react';
import {parseEngineResearchAuditResponse, parseRuntimeIdentityResponse, summarizeEngineResearchCosts} from './engine-research-audit.js';

function short(value, head = 10) {
  return typeof value === 'string' && value.length > head * 2 + 3
    ? `${value.slice(0, head)}…${value.slice(-head)}` : value;
}

export function EngineResearchAuditPanel() {
  const [audit, setAudit] = useState({status: 'UNKNOWN', events: [], returnedEventCount: 0,
    invalidEventCount: 0, truncated: false, knownPrunedAuditRows: null, researchEvidenceLossMarker: 'UNAVAILABLE'});
  const [loading, setLoading] = useState(false);
  const [runtimeIdentity, setRuntimeIdentity] = useState({status: 'UNKNOWN', changedArtifactCount: null, changedArtifacts: []});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [auditResponse, identityResponse] = await Promise.allSettled([
        fetch('/api/engine/research-audit'),
        fetch('/api/runtime/identity'),
      ]);
      if (auditResponse.status === 'fulfilled' && auditResponse.value.ok) {
        setAudit(parseEngineResearchAuditResponse(await auditResponse.value.json()));
      } else {
        setAudit({status: 'UNKNOWN', events: [], returnedEventCount: 0, truncated: false,
          invalidEventCount: 0, knownPrunedAuditRows: null, researchEvidenceLossMarker: 'UNAVAILABLE'});
      }
      if (identityResponse.status === 'fulfilled' && identityResponse.value.ok) {
        setRuntimeIdentity(parseRuntimeIdentityResponse(await identityResponse.value.json()));
      } else {
        setRuntimeIdentity(parseRuntimeIdentityResponse(null));
      }
    } catch {
      setAudit({status: 'UNKNOWN', events: [], returnedEventCount: 0, truncated: false,
        invalidEventCount: 0, knownPrunedAuditRows: null, researchEvidenceLossMarker: 'UNAVAILABLE'});
      setRuntimeIdentity(parseRuntimeIdentityResponse(null));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <section className="sb-glass-card" aria-labelledby="engine-research-audit-title">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
        <h3 id="engine-research-audit-title" style={{margin: 0, fontSize: '0.95rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: 7}}>
          <Activity size={15} color="#9bcbff" /> Engine Candidate Audit
        </h3>
        <button type="button" className="op-button" onClick={refresh} disabled={loading} aria-label="Refresh Engine candidate audit">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      <p style={{margin: '8px 0', color: '#98aabd', fontSize: '0.73rem'}}>
        Read-only retained events from the configured Engine database. This event view is not the separate linear flight-recorder store; completeness remains UNKNOWN. Paper fills are simulation evidence, never chain settlement.
      </p>
      <div style={{display: 'flex', gap: 14, flexWrap: 'wrap', color: '#becad6', fontSize: '0.7rem', fontFamily: 'var(--font-mono, monospace)'}}>
        <span>Status: <strong>{audit.status}</strong></span>
        <span>Returned rows: <strong>{audit.returnedEventCount}</strong>{audit.truncated ? ' (newest 250; more retained)' : ''}</span>
        <span>Unprojectable rows: <strong>{audit.invalidEventCount}</strong></span>
        <span>Known globally pruned audit rows: <strong>{audit.knownPrunedAuditRows === null ? 'UNKNOWN' : audit.knownPrunedAuditRows}</strong></span>
        <span>Persisted loss marker: <strong>{audit.researchEvidenceLossMarker}</strong></span>
        <span>Runtime files: <strong>{runtimeIdentity.status}</strong>{runtimeIdentity.status === 'CHANGED_SINCE_STARTUP'
          ? ` · ${runtimeIdentity.changedArtifactCount} changed` : ''}</span>
      </div>
      {runtimeIdentity.status === 'CHANGED_SINCE_STARTUP' && <p style={{margin: '8px 0 0', color: '#F59E0B', fontSize: '0.72rem'}}>
        Runtime artifacts on disk changed after startup. This identifies disk drift only; it does not prove loaded-code identity. Restart and verify the diagnostic before relying on a new build.
      </p>}
      {runtimeIdentity.status === 'UNKNOWN' && <p style={{margin: '8px 0 0', color: '#F59E0B', fontSize: '0.72rem'}}>
        Runtime identity is unavailable or unverified. The server may be older than this diagnostic or its artifact scan failed.
      </p>}
      {audit.status === 'EMPTY' && <p style={{margin: '10px 0 0', color: '#F59E0B', fontSize: '0.75rem'}}>
        No matching candidate or attempt events were found in the retained audit rows. Older rows may have been pruned, and this does not prove no attempts occurred.
      </p>}
      {audit.status === 'UNKNOWN' && <p style={{margin: '10px 0 0', color: '#F59E0B', fontSize: '0.75rem'}}>
        Engine audit data is unavailable or its schema is unrecognized. No completeness claim is available.
      </p>}
      {audit.events.length > 0 && (
        <ol aria-label="Retained Engine candidate and attempt events" style={{listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 7}}>
          {audit.events.map(event => {
            const fields = event.fields;
            const identity = fields.attemptId || fields.candidateGenerationId || fields.candidateId || 'IDENTITY_UNAVAILABLE';
            const mint = fields.mint;
            const costSummary = summarizeEngineResearchCosts(fields);
            return (
              <li key={event.sequence} style={{padding: '8px 10px', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 5, background: 'rgba(0,0,0,0.16)'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap'}}>
                  <strong style={{fontSize: '0.72rem', color: event.payloadStatus === 'PROJECTABLE' ? '#9bcbff' : '#F59E0B'}}>{event.eventType}</strong>
                  <time dateTime={new Date(event.recordedAtMs).toISOString()} style={{fontSize: '0.67rem', color: '#98aabd'}}>
                    {new Date(event.recordedAtMs).toISOString()}
                  </time>
                </div>
                <div style={{marginTop: 4, fontSize: '0.68rem', color: '#becad6', fontFamily: 'var(--font-mono, monospace)', overflowWrap: 'anywhere'}}>
                  ID: {short(identity)}{fields.attemptNumber ? ` · Try ${fields.attemptNumber}` : ''}{fields.side ? ` · ${fields.side.toUpperCase()}` : ''}{mint ? ` · Mint ${short(mint, 7)}` : ''}
                </div>
                {fields.outcomeEvidenceClass && <div style={{marginTop: 3, fontSize: '0.65rem', color: '#F59E0B'}}>Evidence: {fields.outcomeEvidenceClass}</div>}
                {(fields.scope || fields.effect || fields.reasonCode || fields.failureClass || fields.blockReason) && <div style={{marginTop: 3, fontSize: '0.65rem', color: '#F59E0B'}}>
                  {fields.scope && fields.effect ? `Restriction: ${fields.scope} · ${fields.effect}` : fields.failureClass ? `Build result: ${fields.failureClass}` : 'Submission blocked'}
                  {(fields.reasonCode || fields.blockReason) ? ` · ${fields.reasonCode || fields.blockReason}` : ''}
                </div>}
                {costSummary && <div style={{marginTop: 3, fontSize: '0.65rem', color: '#becad6'}}>
                  {costSummary}
                </div>}
                {event.payloadStatus !== 'PROJECTABLE' && <div style={{marginTop: 3, fontSize: '0.65rem', color: '#F59E0B'}}>Event identity or projection shape is invalid; no payload fields are shown.</div>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
