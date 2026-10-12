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
  const [instructionJson, setInstructionJson] = useState('');
  const [logJson, setLogJson] = useState('');
  const [dualPathResult, setDualPathResult] = useState(null);
  const [dualPathError, setDualPathError] = useState('');
  const [dualPathLoading, setDualPathLoading] = useState(false);

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

  const reconcileDualPath = async (event) => {
    event.preventDefault();
    setDualPathError('');
    setDualPathResult(null);
    const parseEvidence = (raw, label) => {
      if (!raw.trim()) return null;
      const value = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} evidence must be a JSON object.`);
      return value;
    };
    let input;
    try {
      input = {
        instruction: parseEvidence(instructionJson, 'Instruction'),
        log: parseEvidence(logJson, 'Log'),
      };
    } catch (error) {
      setDualPathError(error.message || 'Evidence JSON is invalid.');
      return;
    }
    if (!input.instruction && !input.log) {
      setDualPathError('Paste at least one source record to inspect.');
      return;
    }
    setDualPathLoading(true);
    try {
      const response = await fetch('/api/research/dual-path/reconcile', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(input),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || `Inspection failed (${response.status}).`);
      setDualPathResult(result);
    } catch (error) {
      setDualPathError(error.message || 'Reconciliation service unavailable.');
    } finally {
      setDualPathLoading(false);
    }
  };

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
      <details style={{marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 9}}>
        <summary style={{cursor: 'pointer', color: '#9bcbff', fontSize: '0.75rem', fontWeight: 700}}>Inspect instruction/log reconciliation</summary>
        <p style={{margin: '7px 0', color: '#F59E0B', fontSize: '0.68rem'}} role="note">
          Paste records from your source capture. Protocol must be PUMP_FUN, RAYDIUM_AMM_V4, METEORA_DLMM, or WHIRLPOOL_ORCA; raw amounts must be decimal strings within u64. Inputs are caller-supplied and unauthenticated; this read-only research tool does not verify chain inclusion, decoder correctness, settlement, or execution eligibility.
        </p>
        <form onSubmit={reconcileDualPath} style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8}}>
          <label style={{display: 'grid', gap: 4, color: '#becad6', fontSize: '0.68rem'}}>
            Instruction record · optional
            <textarea aria-label="Instruction evidence JSON" value={instructionJson} onChange={(event) => setInstructionJson(event.target.value)} rows={7} spellCheck="false" placeholder={'JSON fields: protocol, programId, instructionIndex, tokenMint, userPubkey, discriminator, rawAmountIn, rawAmountOut, slot, signature, isSuccess'} style={{width: '100%', resize: 'vertical', padding: 8, borderRadius: 4, background: '#0b111b', color: '#d8e3ef', border: '1px solid rgba(255,255,255,0.15)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.65rem'}} />
          </label>
          <label style={{display: 'grid', gap: 4, color: '#becad6', fontSize: '0.68rem'}}>
            Log record · optional
            <textarea aria-label="Log evidence JSON" value={logJson} onChange={(event) => setLogJson(event.target.value)} rows={7} spellCheck="false" placeholder={'JSON fields: protocol, programId, logIndex, tokenMint, logMessage, slot, signature; optional userPubkey, logDiscriminator, raw amounts, isSuccess'} style={{width: '100%', resize: 'vertical', padding: 8, borderRadius: 4, background: '#0b111b', color: '#d8e3ef', border: '1px solid rgba(255,255,255,0.15)', fontFamily: 'var(--font-mono, monospace)', fontSize: '0.65rem'}} />
          </label>
          <div style={{gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap'}}>
            <button type="submit" className="op-button" disabled={dualPathLoading}>{dualPathLoading ? 'Comparing supplied records…' : 'Reconcile research evidence'}</button>
            {dualPathError && <span role="alert" style={{color: '#FCA5A5', fontSize: '0.7rem'}}>{dualPathError}</span>}
          </div>
        </form>
        {dualPathResult && <div role="status" aria-live="polite" style={{marginTop: 9, padding: 9, border: '1px solid rgba(245,158,11,0.35)', borderRadius: 5, background: 'rgba(245,158,11,0.06)', color: '#e5edf5', fontSize: '0.68rem'}}>
          <strong style={{color: '#F59E0B'}}>Source-reported {dualPathResult.report?.status || 'UNKNOWN'}</strong>
          <div style={{marginTop: 4}}>Conflict flag: {dualPathResult.report?.isConflicted == null ? 'UNKNOWN' : String(dualPathResult.report.isConflicted)} · slot: {dualPathResult.report?.slot ?? 'UNKNOWN'} · signature: {short(dualPathResult.report?.signature || 'UNKNOWN')}</div>
          {dualPathResult.report?.conflictReason && <div>Reason: {dualPathResult.report.conflictReason}</div>}
          <div style={{marginTop: 4}}>Authority: {dualPathResult.authority} · Source: {dualPathResult.evidenceStatus}</div>
          <p style={{margin: '5px 0 0', color: '#F59E0B'}}>{dualPathResult.explanation}</p>
          <details style={{marginTop: 6}}><summary style={{cursor: 'pointer'}}>Show full report and certificate</summary><pre style={{marginTop: 5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{JSON.stringify(dualPathResult, null, 2)}</pre></details>
        </div>}
      </details>
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
                {event.eventType === 'candidate_order_built_v1' && <details style={{marginTop: 7, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 6}}>
                  <summary style={{cursor: 'pointer', color: '#9bcbff', fontSize: '0.68rem'}}>
                    {fields.routeEvidence ? `Jupiter route · ${fields.routeEvidence.routePlan.length} hop${fields.routeEvidence.routePlan.length === 1 ? '' : 's'}` : 'Route evidence unavailable'}
                  </summary>
                  {fields.routeEvidence ? <div style={{marginTop: 6, display: 'grid', gap: 6}}>
                    <div style={{fontSize: '0.64rem', color: '#becad6'}}>
                      {fields.routeEvidence.router} · {fields.routeEvidence.orderMode} · quote {fields.routeEvidence.quoteTimestampMs <= Date.now()
                        ? `${Math.floor((Date.now() - fields.routeEvidence.quoteTimestampMs) / 1000)}s old` : 'timestamp is in the future'} · expiry height {fields.routeEvidence.lastValidBlockHeight}
                    </div>
                    <ol style={{margin: 0, paddingLeft: 18, display: 'grid', gap: 4}}>
                      {fields.routeEvidence.routePlan.map((hop, index) => <li key={`${index}-${hop.inputMint}-${hop.outputMint}`} style={{fontSize: '0.64rem', color: '#becad6', overflowWrap: 'anywhere'}}>
                        <b>{hop.label || 'Unlabeled venue'}</b> · {hop.percent}% · {short(hop.inputMint, 5)} → {short(hop.outputMint, 5)} · raw {hop.inputAmount} → {hop.outputAmount}
                        {hop.feeAmount != null ? ` · fee ${hop.feeAmount} raw${hop.feeMint ? ` (${short(hop.feeMint, 5)})` : ''}` : ''}
                      </li>)}
                    </ol>
                    <span style={{fontSize: '0.62rem', color: '#F59E0B'}}>Instructions only · transaction version unknown · route quote is not a landed trade or realized proceeds.</span>
                  </div> : <span style={{display: 'block', marginTop: 5, fontSize: '0.64rem', color: '#98aabd'}}>This build record has no normalized Jupiter route projection.</span>}
                </details>}
                {event.payloadStatus !== 'PROJECTABLE' && <div style={{marginTop: 3, fontSize: '0.65rem', color: '#F59E0B'}}>Event identity or projection shape is invalid; no payload fields are shown.</div>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
