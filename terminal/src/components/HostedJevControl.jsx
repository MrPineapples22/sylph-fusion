import React, { useEffect, useState } from 'react';
import {
  BrainCircuit,
  ShieldCheck,
  LockKeyhole,
  CheckCircle2,
  AlertTriangle,
  FileCheck2,
  Activity,
  Sparkles,
} from 'lucide-react';
import { readJson } from '../read-json.js';

export function HostedJevControl() {
  const [hostedState, setHostedState] = useState(null);
  const [shadowProjection, setShadowProjection] = useState(null);
  const [latestRecord, setLatestRecord] = useState(null);
  const [evalToken, setEvalToken] = useState('');
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isRefreshingHostedEvidence, setIsRefreshingHostedEvidence] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [hostedComparison, setHostedComparison] = useState(null);
  const [error, setError] = useState('');
  const [evalNotice, setEvalNotice] = useState('');

  const loadData = async (signal) => {
    try {
      const [hState, sProj] = await Promise.all([
        readJson(`/api/intelligence/jev-hosted?mint=${encodeURIComponent(evalToken.trim())}`, signal, 12000).catch(() => null),
        readJson('/api/intelligence/jev/shadow', signal, 3500).catch(() => null),
      ]);
      if (hState) setHostedState(hState);
      if (sProj?.projection) {
        setShadowProjection(sProj.projection);
        const tokens = Object.values(sProj.projection.latestByToken || {});
        if (tokens.length > 0 && !latestRecord) {
          setLatestRecord(tokens[tokens.length - 1]);
        }
      }
    } catch (err) {
      setError(err?.message || 'Shadow status check failed.');
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => loadData(controller.signal), 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [evalToken]);

  const handleRunEvaluation = async () => {
    setIsEvaluating(true);
    setError('');
    setEvalNotice('');
    try {
      const mint = evalToken.trim() || 'SAMPLE_ALPHA_MINT';
      const res = await fetch('/api/intelligence/jev/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `Evaluation failed (${res.status})`);
      }
      setLatestRecord(data.record);
      setEvalNotice(`Local synthetic preview recorded for ${mint}`);
      const controller = new AbortController();
      loadData(controller.signal);
    } catch (err) {
      setError(err?.message || 'Evaluation error');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleRunHostedComparison = async () => {
    setIsComparing(true);
    setError('');
    setEvalNotice('');
    setHostedComparison(null);
    try {
      const mint = evalToken.trim();
      const res = await fetch('/api/intelligence/jev-hosted/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mint }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.readiness?.status || data?.error || `Comparison unavailable (${res.status})`);
      }
      setHostedComparison(data.comparison);
      setEvalNotice(`Advisory comparison completed on snapshot ${data.comparison.featureSnapshotHash.slice(0, 12)}…`);
      const controller = new AbortController();
      loadData(controller.signal);
    } catch (err) {
      setError(err?.message || 'Hosted comparison unavailable');
    } finally {
      setIsComparing(false);
    }
  };

  const handleRefreshHostedEvidence = async () => {
    const mint = evalToken.trim();
    if (!mint) return;
    setIsRefreshingHostedEvidence(true);
    setError('');
    setEvalNotice('');
    try {
      const controller = new AbortController();
      const status = await readJson(`/api/intelligence/jev-hosted?mint=${encodeURIComponent(mint)}`, controller.signal, 12000);
      setHostedState(status);
      setEvalNotice(status.contextStatus === 'READY'
        ? `Fresh market evidence ready · ${Math.round((status.featureCoverage || 0) * 16)}/16 features`
        : status.contextStatus || status.reason || 'Fresh certified market evidence is not ready yet');
    } catch (err) {
      setError(err?.message || 'Live evidence refresh failed');
    } finally {
      setIsRefreshingHostedEvidence(false);
    }
  };

  const getClassificationColor = (cls) => {
    switch (cls) {
      case 'HIGH_INTEREST': return '#10B981';
      case 'WATCH': return '#06B6D4';
      case 'LOW_INTEREST': return '#94A3B8';
      case 'NEED_MORE_EVIDENCE': return '#F59E0B';
      case 'OOD': return '#F43F5E';
      default: return '#E2E8F0';
    }
  };

  const getHypothesisBarColor = (name) => {
    switch (name) {
      case 'organicContinuation': return '#10B981';
      case 'reflexiveChase': return '#F59E0B';
      case 'distribution': return '#F97316';
      case 'exhaustion': return '#A855F7';
      case 'liquidityFailure': return '#EF4444';
      case 'syntheticFlow': return '#8B5CF6';
      default: return '#3B82F6';
    }
  };

  const formatHypothesisLabel = (key) => {
    switch (key) {
      case 'organicContinuation': return 'Organic Continuation';
      case 'reflexiveChase': return 'Reflexive Chase';
      case 'distribution': return 'Distribution Pressure';
      case 'exhaustion': return 'Buyer Exhaustion';
      case 'liquidityFailure': return 'Liquidity Failure';
      case 'syntheticFlow': return 'Synthetic Flow';
      default: return key;
    }
  };

  const hostedQuestionLabel = (key) => ({
    organic_continuation: 'Organic continuation',
    reflexive_chase: 'Reflexive chase',
    distribution: 'Distribution risk',
    exhaustion: 'Buyer exhaustion',
    liquidity_failure: 'Liquidity failure',
    synthetic_flow: 'Synthetic flow',
    evidence_sufficiency: 'Evidence sufficiency',
  }[key] || key.replaceAll('_', ' '));

  const decision = latestRecord?.decision;
  const assessment = latestRecord?.assessment;
  const disagreement = latestRecord?.disagreement;

  return (
    <section className="op-section" aria-label="JEV & Laya System-1 Advisory Control Plane">
      <div className="op-eyebrow">
        <BrainCircuit size={14} aria-hidden="true" /> JEV & LAYA SYSTEM-1 · ADVISORY SHADOW LANE
      </div>
      <h2>JEV and Laya advisory research</h2>
      <p>
        Local rule-based previews and optional hosted model comparisons. Hosted calls require a certified,
        point-in-time feature snapshot. All results are advisory and have no execution authority.
      </p>

      {/* Metric Cards */}
      <div className="op-evidence-columns">
        <section>
          <h3>Local preview</h3>
          <p><b style={{ color: shadowProjection?.totalRecords > 0 ? '#F59E0B' : '#8E95A5' }}>{hostedState?.status || 'STATUS_UNAVAILABLE'}</b></p>
          <p className="op-muted">Engines: local JEV and Laya rules</p>
          <p className="op-muted">Fallback inputs are synthetic preview data, not certified market evidence.</p>
        </section>

        <section>
          <h3>Retained Journal Chain</h3>
          <p><b>{shadowProjection?.totalRecords ?? 0} Inferences</b></p>
          <p className="op-muted" style={{ fontFamily: 'monospace', fontSize: '11px' }}>
            Head: {shadowProjection?.chainHead ? `${shadowProjection.chainHead.slice(0, 16)}...` : 'EMPTY'}
          </p>
          <p className="op-muted">Hash-chained local preview records (capacity 500); hashes do not certify market evidence.</p>
        </section>

        <section>
          <h3>Authority Boundary</h3>
          <p><LockKeyhole size={14} aria-hidden="true" /> <b>ADVISORY_ONLY</b></p>
          <p className="op-muted" style={{ color: '#EF4444' }}>Execution authority: none</p>
          <p className="op-muted">This panel cannot authorize a transaction.</p>
        </section>
      </div>

      {/* Interactive Evaluation Action */}
      <div style={{
        marginTop: '16px',
        padding: '14px',
        background: 'rgba(21, 35, 49, 0.7)',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.08)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: '#94A3B8' }} htmlFor="jev-eval-input">
            Solana mint for live feature evidence:
          </label>
          <input
            id="jev-eval-input"
            type="text"
            value={evalToken}
            onChange={(e) => setEvalToken(e.target.value)}
            placeholder="Paste a Solana token mint"
            style={{
              flex: '1 1 240px',
              padding: '6px 10px',
              background: '#0B131D',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '4px',
              color: '#F8FAFC',
              fontSize: '12px',
              fontFamily: 'monospace'
            }}
          />
          <button
            type="button"
            className="op-button op-primary"
            onClick={handleRunEvaluation}
            disabled={isEvaluating}
            style={{
              padding: '6px 16px',
              background: '#10B981',
              borderColor: '#10B981',
              color: '#042F2E',
              fontWeight: 700,
              cursor: isEvaluating ? 'not-allowed' : 'pointer'
            }}
          >
            {isEvaluating ? 'Evaluating...' : 'Run local preview'}
          </button>
        </div>
        {evalNotice && <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#10B981' }}>✓ {evalNotice}</p>}
        {error && <p style={{ margin: '8px 0 0 0', fontSize: '12px', color: '#EF4444' }}>⚠ {error}</p>}
      </div>

      <div style={{ marginTop: '12px', padding: '14px', background: 'rgba(21, 35, 49, 0.55)', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="op-button"
            onClick={handleRefreshHostedEvidence}
            disabled={isRefreshingHostedEvidence || !evalToken.trim()}
            title="Refresh live provider observations for this mint"
          >
            {isRefreshingHostedEvidence ? 'Refreshing evidence…' : 'Refresh live evidence'}
          </button>
          <button
            type="button"
            className="op-button op-primary"
            onClick={handleRunHostedComparison}
            disabled={isComparing || !hostedState?.comparisonReady}
            title={hostedState?.contextStatus || 'Waiting for a fresh certified feature context'}
          >
            {isComparing ? 'Comparing…' : 'Compare latest JEV + Laya'}
          </button>
          <span className="op-muted" style={{ fontSize: '12px' }}>
            {hostedState?.contextStatus || 'Waiting for upstream feature context'}
            {Number.isFinite(hostedState?.featureContextAgeMs) ? ` · ${hostedState.featureContextAgeMs} ms old` : ''}
            {Number.isFinite(hostedState?.featureCoverage) ? ` · ${Math.round(hostedState.featureCoverage * 16)}/16 features` : ''}
          </span>
        </div>
        <p className="op-muted" style={{ marginBottom: 0, fontSize: '11px' }}>
          This action sends only the latest fresh upstream feature snapshot to configured providers. Synthetic previews are never sent.
        </p>
        {hostedComparison && (
          <div style={{ marginTop: '12px' }} aria-live="polite">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
              {[['TypeSafe Jev', hostedComparison.typesafeJev], ['Laya · Clef Flash', hostedComparison.laya]].map(([name, provider]) => (
                <section key={name}>
                  <h3>{name}</h3>
                  <b>{provider.status}</b>
                  <p className="op-muted">Model: {provider.resolvedModel || provider.requestedModel} · {Number(provider.latencyMs || 0)} ms</p>
                  {provider.inputTokens != null && <p className="op-muted">Input tokens: {provider.inputTokens}</p>}
                  {provider.errorCode && <p role="status" className="op-muted">Unavailable: {provider.errorCode}</p>}
                </section>
              ))}
              <section>
                <h3>Hosted agreement</h3>
                <b>{hostedComparison.status}</b>
                <p className="op-muted">Largest probability difference: {hostedComparison.maximumHostedProbabilityDelta == null ? 'Unavailable' : `${(hostedComparison.maximumHostedProbabilityDelta * 100).toFixed(1)} points`}</p>
                <p className="op-muted">Calibration: {hostedComparison.calibrationState || 'NOT_ESTABLISHED'}</p>
              </section>
            </div>
            {hostedComparison.hostedProbabilityDeltas && (
              <div style={{ overflowX: 'auto', marginTop: '10px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <caption style={{ textAlign: 'left', padding: '6px 0', color: '#94A3B8' }}>Same-snapshot advisory probabilities</caption>
                  <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Signal</th><th scope="col">Jev</th><th scope="col">Laya</th><th scope="col">Difference</th></tr></thead>
                  <tbody>{Object.entries(hostedComparison.hostedProbabilityDeltas).map(([key, delta]) => {
                    const jevValue = hostedComparison.typesafeJev.answers?.[key]?.noul;
                    const layaValue = hostedComparison.laya.answers?.[key]?.noul;
                    return <tr key={key}>
                      <th scope="row" style={{ textAlign: 'left', padding: '6px 8px' }}>{hostedQuestionLabel(key)}</th>
                      <td style={{ textAlign: 'center' }}>{Number.isFinite(jevValue) ? `${(jevValue * 100).toFixed(1)}%` : '—'}</td>
                      <td style={{ textAlign: 'center' }}>{Number.isFinite(layaValue) ? `${(layaValue * 100).toFixed(1)}%` : '—'}</td>
                      <td style={{ textAlign: 'center' }}>{(delta * 100).toFixed(1)} points</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            )}
            <p className="op-muted" style={{ marginBottom: 0, marginTop: '8px', fontFamily: 'monospace', fontSize: '10px', overflowWrap: 'anywhere' }}>Snapshot: {hostedComparison.featureSnapshotHash}</p>
          </div>
        )}
      </div>

      {/* Latest Evaluation Result Details */}
      {latestRecord && (
        <div style={{
          marginTop: '16px',
          padding: '16px',
          background: 'rgba(11, 19, 29, 0.85)',
          borderRadius: '8px',
          border: '1px solid rgba(255, 255, 255, 0.12)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            <div>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', color: '#64748B', letterSpacing: '0.05em' }}>
                Latest Local Preview
              </span>
              <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '14px', color: '#F1F5F9' }}>
                {latestRecord.tokenId}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{
                padding: '4px 10px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 800,
                background: `${getClassificationColor(decision?.classification)}22`,
                color: getClassificationColor(decision?.classification),
                border: `1px solid ${getClassificationColor(decision?.classification)}`
              }}>
                {decision?.classification || 'UNKNOWN'}
              </span>
              <span style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#94A3B8'
              }}>
                Seq #{latestRecord.sequence}
              </span>
            </div>
          </div>

          {/* 6-Hypothesis Probability Bars */}
          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#94A3B8', fontWeight: 600 }}>
              Local rule scores · synthetic preview only
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
              {decision?.hypothesisProbabilities && Object.entries(decision.hypothesisProbabilities).map(([key, val]) => {
                const pct = Math.round(val * 100);
                const color = getHypothesisBarColor(key);
                return (
                  <div key={key} style={{ background: 'rgba(255, 255, 255, 0.03)', padding: '8px', borderRadius: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '4px' }}>
                      <span style={{ color: '#CBD5E1' }}>{formatHypothesisLabel(key)}</span>
                      <span style={{ fontWeight: 700, color }}>{pct}%</span>
                    </div>
                    <div style={{ width: '100%', height: '6px', background: 'rgba(255, 255, 255, 0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s ease' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Laya Second-Order & Disagreement */}
          <div className="op-evidence-columns">
            <section>
              <h3>Local Laya rule comparison</h3>
              <p><b>{assessment ? `${Math.round(assessment.agreementWithJEV * 100)}%` : '—'}</b></p>
              <p className="op-muted">Local advisory state: <b style={{ color: '#06B6D4' }}>{assessment?.state || 'UNKNOWN'}</b></p>
              <p className="op-muted">Disagreement: {disagreement ? `${disagreement.classification} (${Math.round(disagreement.magnitude * 100)}%)` : 'UNKNOWN'}</p>
            </section>

            <section>
              <h3>Uncertainty & Gating</h3>
              <p><b>{decision ? `${(decision.uncertainty * 100).toFixed(1)}%` : '—'}</b></p>
              <p className="op-muted">Evidence coverage: {decision ? `${Math.round(decision.evidenceCoverage * 100)}% · synthetic preview` : 'UNKNOWN'}</p>
              <p className="op-muted">Escalation: {decision?.escalation ? (decision.escalation.required ? `Required (${decision.escalation.preferredAgent})` : 'Not required by local rule') : 'UNKNOWN'}</p>
            </section>

            <section>
              <h3>Inference Certificates</h3>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#10B981' }}>
                {latestRecord.certificates?.[0]?.outputHash ? <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }} /> : null}
                JEV hash: {latestRecord.certificates?.[0]?.outputHash ? `${latestRecord.certificates[0].outputHash.slice(0, 12)}...` : 'UNAVAILABLE'}
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#06B6D4' }}>
                {latestRecord.certificates?.[1]?.outputHash ? <CheckCircle2 size={12} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }} /> : null}
                Local Laya hash: {latestRecord.certificates?.[1]?.outputHash ? `${latestRecord.certificates[1].outputHash.slice(0, 12)}...` : 'UNAVAILABLE'}
              </p>
              <p className="op-muted" style={{ fontFamily: 'monospace', fontSize: '10px' }}>
                Record: {latestRecord.recordHash.slice(0, 16)}...
              </p>
            </section>
          </div>
        </div>
      )}

      {/* Hosted Provider Boundary */}
      <div className="op-evidence-columns" style={{ marginTop: '16px' }}>
        {(hostedState?.providers || [
          { id: 'typesafe-jev', provider: 'TypeSafe Hosted', model: 'typesafe/jev-1.13', status: 'DISABLED' },
          { id: 'laya', provider: 'Laya Remote API', model: 'clef-flash', status: 'DISABLED' },
        ]).map((p) => (
          <section key={p.id}>
            <h3>{p.provider}</h3>
            <p><b style={{ color: p.status === 'AWAITING_CERTIFIED_CONTEXT' ? '#F59E0B' : '#8E95A5' }}>{p.status}</b></p>
            <p className="op-muted">Model: {p.model}</p>
            <p className="op-muted">Remote API key: {p.credentialConfigured ? 'Configured' : 'Unconfigured'}</p>
            {p.id === 'typesafe-jev' && <p className="op-muted">Endpoint: {p.endpoint || 'https://api.typesafe.ai/v1/systemone'}</p>}
          </section>
        ))}
        <section>
          <h3><ShieldCheck size={14} aria-hidden="true" /> Safety Controls</h3>
          <ul className="op-transition-list">
            <li>ADVISORY_ONLY output boundary</li>
            <li>Zero execution or signer authority</li>
            <li>Fail-closed Guardian & Capital gate</li>
            <li>Cryptographic hash-chain provenance</li>
          </ul>
        </section>
      </div>
    </section>
  );
}
