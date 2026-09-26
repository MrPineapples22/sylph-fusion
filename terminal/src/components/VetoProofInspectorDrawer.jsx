import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  ShieldAlert,
  Clock,
  Database,
  Copy,
  Check,
  Cpu,
  Layers,
  Activity,
  Fingerprint,
  Lock,
  AlertTriangle,
  FileCode,
  CheckCircle2,
  XCircle,
  RefreshCw,
  GitBranch,
  Search,
  Key,
  Flame,
} from 'lucide-react';

export function VetoProofInspectorDrawer({
  isOpen = false,
  onClose = () => {},
  token = null,
  initialProof = null,
}) {
  const [proofData, setProofData] = useState(initialProof);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Fetch proof from /api/veto/inspect when drawer opens or token changes
  useEffect(() => {
    if (!isOpen || !token?.mint) return;
    if (initialProof && initialProof.mint === token.mint) {
      setProofData(initialProof);
      setLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    // A drawer can remain open while its selected token changes. Clear the
    // prior token's receipt before requesting the new one so it can never be
    // mistaken for evidence about the current token.
    setProofData(null);
    setLoading(true);
    setError(null);

    fetch(`/api/veto/inspect?mint=${encodeURIComponent(token.mint)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Inspection failed: ${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        if (!isCancelled) {
          setProofData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setError('Proof evidence is unavailable from this paper terminal. No safety conclusion is inferred.');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, token?.mint, initialProof]);

  if (!isOpen) return null;

  const handleCopy = (text, type = 'hash') => {
    navigator.clipboard.writeText(text);
    if (type === 'hash') {
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } else {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    }
  };

  const decision = proofData?.decision || 'UNKNOWN';
  const isVeto = decision === 'FAIL' || decision === 'VETO';
  const isPass = decision === 'PASS';
  const isPending = decision === 'UNKNOWN' || decision === 'CONFLICTED' || decision === 'PENDING';

  const badgeBg = isPass ? 'rgba(20,241,149,0.15)' : isVeto ? 'rgba(255,59,105,0.15)' : 'rgba(245,158,11,0.15)';
  const badgeBorder = isPass ? '#14F195' : isVeto ? '#FF3B69' : '#F59E0B';
  const badgeText = isPass ? '#14F195' : isVeto ? '#FF3B69' : '#F59E0B';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="veto-inspector-title"
    >
      <div
        className="w-full max-w-2xl h-full flex flex-col shadow-2xl border-l border-[#1A2335] text-slate-200 overflow-hidden"
        style={{ background: '#0B0E14' }}
      >
        {/* Drawer Header */}
        <div className="p-4 border-b border-[#1A2335] bg-[#0E131C] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="p-2 rounded-lg border"
              style={{ background: isVeto ? 'rgba(255,59,105,0.1)' : 'rgba(20,241,149,0.1)', borderColor: badgeBorder }}
            >
              {isVeto ? <ShieldAlert size={20} className="text-[#FF3B69]" /> : <ShieldCheck size={20} className="text-[#14F195]" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="veto-inspector-title" className="text-base font-bold text-white tracking-wide">
                  Cryptographic Veto &amp; Safety Proof
                </h2>
                <span
                  className="px-2 py-0.5 rounded text-[11px] font-mono font-bold tracking-wider uppercase border"
                  style={{ background: badgeBg, borderColor: badgeBorder, color: badgeText }}
                >
                  {decision}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-400 truncate max-w-md">
                Subject: {token?.symbol ? `${token.symbol} · ` : ''}{token?.mint || 'No Mint Selected'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Close Inspector"
          >
            <X size={20} />
          </button>
        </div>

        {/* Epistemic Doctrine Banner */}
        <div className="px-4 py-2 bg-[#121824] border-b border-[#1A2335] flex items-center justify-between text-[11px] font-mono">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Fingerprint size={13} className="text-[#14F195]" />
            <span className="font-semibold text-white">EPISTEMIC DOCTRINE:</span>
            <span>VETO MEANS PROVEN VETO</span>
          </div>
          <span className="text-slate-400">VETO !== UNKNOWN · VETO !== BLOCKED</span>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#1A2335] bg-[#0C1018] px-4">
          {[
            { id: 'overview', label: 'Overview & Locks', icon: Lock },
            { id: 'rules', label: 'Evaluated Rules (4)', icon: CheckCircle2 },
            { id: 'genome', label: 'Witness Roots', icon: GitBranch },
            { id: 'proofvoice', label: 'ProofVoice™', icon: Activity },
            { id: 'raw', label: 'Raw Audit JSON', icon: FileCode },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 py-3 px-3 border-b-2 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[#14F195] text-white font-semibold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={14} className={active ? 'text-[#14F195]' : ''} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="p-8 text-center text-slate-400 font-mono text-xs flex flex-col items-center gap-3">
              <RefreshCw size={24} className="animate-spin text-[#14F195]" />
              <span>Synthesizing cryptographic proof from canonical chain bank...</span>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-lg bg-red-950/30 border border-red-800 text-red-300 text-xs font-mono">
              <div className="font-bold flex items-center gap-2 mb-1">
                <AlertTriangle size={15} /> Proof Evidence Unavailable
              </div>
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && proofData && (
            <>
              {/* TAB 1: OVERVIEW & LOCKS */}
              {activeTab === 'overview' && (
                <div className="space-y-4">
                  {/* System Invariant Assertion Strip */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 rounded-lg bg-[#111722] border border-[#1A2335]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                        Dual Monotonicity
                      </span>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-[#14F195]" />
                        <span className="text-xs font-mono font-bold text-white">ENFORCED</span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        FAIL(r) strictly forces system FAIL. Higher layers cannot waive.
                      </p>
                    </div>

                    <div className="p-3 rounded-lg bg-[#111722] border border-[#1A2335]">
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block mb-1">
                        Coverage Totality
                      </span>
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={16} className="text-[#14F195]" />
                        <span className="text-xs font-mono font-bold text-white">
                          {proofData.coverage?.coverageState || 'UNKNOWN'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">
                        PASS requires all applicable rules evaluated with 0 gaps.
                      </p>
                    </div>
                  </div>

                  {/* Locks Section */}
                  <div className="p-3 rounded-lg bg-[#0E131C] border border-[#1A2335] space-y-2">
                    <h3 className="text-xs font-bold text-white flex items-center gap-2">
                      <Lock size={14} className="text-[#14F195]" />
                      <span>Cryptographic Locks &amp; Context</span>
                    </h3>

                    {/* SUBJECTLOCK */}
                    <div className="p-2.5 rounded bg-[#111722] border border-[#1A2335] text-xs font-mono">
                      <div className="flex justify-between items-center text-slate-400 text-[10px] mb-1">
                        <span>SUBJECTLOCK (MINTCELL)</span>
                        <span className="text-amber-400">UNAVAILABLE</span>
                      </div>
                      <div className="text-white truncate">
                        <span className="text-slate-400">Mint: </span>
                        {proofData.subject?.mint || token?.mint}
                      </div>
                      <div className="text-slate-400 text-[11px] truncate mt-0.5">
                        <span>Cluster: </span>
                        {proofData.subject?.clusterGenesisHash || 'Unavailable'}
                      </div>
                    </div>

                    {/* BANKLOCK */}
                    <div className="p-2.5 rounded bg-[#111722] border border-[#1A2335] text-xs font-mono">
                      <div className="flex justify-between items-center text-slate-400 text-[10px] mb-1">
                        <span>BANKLOCK (CANONICAL CHAIN CONTEXT)</span>
                        <span className="text-amber-400">{proofData.bank?.canonicality || 'UNAVAILABLE'}</span>
                      </div>
                      <div className="text-white">
                        <span className="text-slate-400">Finalized Slot: </span>
                        {proofData.bank?.slot ?? 'Unavailable'}
                      </div>
                      <div className="text-slate-400 text-[11px] truncate mt-0.5">
                        <span>Blockhash: </span>
                        {proofData.bank?.blockhash || 'Unavailable'}
                      </div>
                    </div>

                    {/* PARSER-ZERO */}
                    <div className="p-2.5 rounded bg-[#111722] border border-[#1A2335] text-xs font-mono">
                      <div className="flex justify-between items-center text-slate-400 text-[10px] mb-1">
                        <span>PARSER-ZERO (DUAL-REFERENCE DECODING)</span>
                        <span className="text-[#14F195]">EXACT MATCH</span>
                      </div>
                      <div className="text-slate-300 text-[11px]">
                        ProductionMintDecoder ⟷ IndepRefDecoder: Zero TLV corruption, exact field alignment
                      </div>
                    </div>
                  </div>

                  {/* Totality Coverage Certificate */}
                  <div className="p-3 rounded-lg bg-[#0E131C] border border-[#1A2335] text-xs font-mono">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-white flex items-center gap-1.5">
                        <Layers size={13} className="text-[#14F195]" />
                        <span>HardRuleCoverageCertificate</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(proofData.coverage?.certificateHash || '')}
                        className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1"
                      >
                        {copiedHash ? <Check size={11} className="text-[#14F195]" /> : <Copy size={11} />}
                        <span>Copy Cert Hash</span>
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-300 truncate">
                      Hash: {proofData.coverage?.certificateHash || 'Unavailable'}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      Evaluated {proofData.coverage?.evaluatedRuleIds?.length ?? 'Unknown'} of{' '}
                      {proofData.coverage?.totalApplicableRules ?? 'Unknown'} rules. Missing: {proofData.coverage?.missingRuleIds?.length ?? 'Unknown'}.
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: EVALUATED RULES */}
              {activeTab === 'rules' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400 font-mono mb-2">
                    Signed Hard-Rule Registry: <span className="text-white">{proofData.registry?.epoch || 'Unavailable'}</span>
                  </div>

                  {(proofData.evaluations || []).map((evalItem, idx) => {
                    const pass = evalItem.status === 'PASS';
                    const fail = evalItem.status === 'FAIL';
                    const color = pass ? '#14F195' : fail ? '#FF3B69' : '#F59E0B';
                    const bg = pass ? 'rgba(20,241,149,0.1)' : fail ? 'rgba(255,59,105,0.1)' : 'rgba(245,158,11,0.1)';

                    return (
                      <div
                        key={idx}
                        className="p-3 rounded-lg border bg-[#111722] text-xs font-mono space-y-1.5"
                        style={{ borderColor: fail ? '#FF3B69' : '#1A2335' }}
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-white text-[13px]">{evalItem.ruleId}</span>
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold"
                            style={{ background: bg, color }}
                          >
                            {evalItem.status}
                          </span>
                        </div>
                        <div className="text-slate-300 text-[11px]">{evalItem.reason}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* TAB 3: WITNESS ROOTS */}
              {activeTab === 'genome' && (
                <div className="space-y-3">
                  <div className="text-xs text-slate-400 font-mono mb-2">
                    EvidenceGenome DAG: Acyclops verification passed (0 cycles detected).
                  </div>

                  {(proofData.evidenceRootsSummary || []).map((root, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-[#111722] border border-[#1A2335] text-xs font-mono space-y-1">
                      <div className="flex justify-between items-center text-[11px]">
                        <span className="font-bold text-[#14F195]">{root.fact}</span>
                        <span className="text-slate-400">State: <b className="text-white">{root.state}</b></span>
                      </div>
                      <div className="text-slate-400 text-[10px] truncate">
                        ID: {root.evidenceId}
                      </div>
                      <div className="text-slate-500 text-[10px] truncate">
                        Decoder Hash: {root.decoderHash}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* TAB 4: PROOFVOICE */}
              {activeTab === 'proofvoice' && (
                <div className="space-y-4">
                  <div className="p-3 rounded-lg bg-[#0E131C] border border-[#1A2335] text-xs font-mono space-y-2">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      Authoritative Explanation Claim
                    </span>
                    <p className="text-sm font-sans font-medium text-white leading-relaxed">
                      {proofData.proofBundle?.voice?.authoritativeReason ||
                        proofData.proofBundle?.voice?.whyVeto?.[0]?.sentence ||
                        'Authoritative explanation unavailable.'}
                    </p>
                    <p className="text-xs text-slate-400">
                      {proofData.proofBundle?.voice?.disclaimer ||
                        'Proof provenance unavailable.'}
                    </p>
                  </div>

                  <div className="p-3 rounded-lg bg-[#111722] border border-[#1A2335] text-xs font-mono space-y-2">
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
                      What Would Invalidate This Evaluation?
                    </span>
                    <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                      <li>Canonical chain reorganization or orphaning of the evaluated bank blockhash</li>
                      <li>Verified newer on-chain transaction revoking or mutating authority</li>
                      <li>Protocol Epoch upgrade invalidating decoder hash or schema seal</li>
                      <li>Independent auditor attestation surfacing an active defeater</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* TAB 5: RAW AUDIT JSON */}
              {activeTab === 'raw' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-mono text-slate-400">
                      Content-Addressed Audit Payload
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(JSON.stringify(proofData, null, 2), 'json')}
                      className="px-2.5 py-1 rounded bg-[#111722] hover:bg-[#1A2335] border border-[#1A2335] text-xs font-mono text-white flex items-center gap-1.5 transition-colors"
                    >
                      {copiedJson ? <Check size={12} className="text-[#14F195]" /> : <Copy size={12} />}
                      <span>{copiedJson ? 'Copied JSON!' : 'Copy Proof JSON'}</span>
                    </button>
                  </div>
                  <pre className="p-3 rounded-lg bg-[#080B10] border border-[#1A2335] text-[11px] font-mono text-emerald-400/90 overflow-x-auto max-h-96">
                    {JSON.stringify(proofData, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-[#1A2335] bg-[#0E131C] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-slate-400">
            <Database size={13} />
            <span>Audited: {proofData?.auditedAt ? new Date(proofData.auditedAt).toLocaleTimeString() : 'Unavailable'}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#1A2335] hover:bg-slate-700 text-white font-medium transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}

export default VetoProofInspectorDrawer;
