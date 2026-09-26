import React, { useEffect, useState } from 'react';
import { BrainCircuit, ShieldCheck, Clock3, LockKeyhole } from 'lucide-react';
import { readJson } from '../read-json.js';

export function HostedJevControl() {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    readJson('/api/intelligence/jev-hosted', controller.signal, 3500)
      .then(value => setState(value))
      .catch(() => setError('Hosted Jev status is unavailable. No inference result is assumed.'));
    return () => controller.abort();
  }, []);

  const enabled = state?.status === 'AWAITING_CERTIFIED_CONTEXT';
  return <section className="op-section" aria-label="TypeSafe hosted Jev control plane">
    <div className="op-eyebrow"><BrainCircuit size={14} aria-hidden="true"/> TYPE-SAFE HOSTED JEV · RESEARCH LANE</div>
    <h2>Decision control plane</h2>
    <p>{error || state?.reason || 'Checking the local hosted-model boundary.'}</p>
    <div className="op-evidence-columns">
      <section><h3>Provider state</h3><p><b style={{color: enabled ? '#F59E0B' : '#8E95A5'}}>{state?.status || 'UNKNOWN'}</b></p><p className="op-muted">{state?.model || 'Pinned model unknown'}</p></section>
      <section><h3>Decision contracts</h3><p>{state?.primitives?.join(' · ') || 'Choice · Score · Noul'}</p><p className="op-muted">Typed output only; no free-form trading instruction.</p></section>
      <section><h3>Authority boundary</h3><p><LockKeyhole size={14} aria-hidden="true"/> {state?.authority || 'ADVISORY_ONLY'}</p><p className="op-muted">Execution authorization: false</p></section>
    </div>
    <div className="op-evidence-columns">
      <section><h3><ShieldCheck size={14} aria-hidden="true"/> Safety controls</h3><ul className="op-transition-list">{(state?.safeguards || ['Server-side secret only', 'No command authority']).map(item => <li key={item}>{item}</li>)}</ul></section>
      <section><h3><Clock3 size={14} aria-hidden="true"/> Promotion state</h3><p className="op-muted">Hosted outputs remain separate from the deterministic Jev rule engine. Calibration, data-rights, and verification evidence are required before any promotion.</p></section>
    </div>
  </section>;
}
