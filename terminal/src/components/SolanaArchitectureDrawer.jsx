import React, { useState, useEffect } from 'react';
import {
  Shield,
  Zap,
  Activity,
  Compass,
  GitBranch,
  Lock,
} from 'lucide-react';

export function SolanaArchitectureDrawer({
  isOpen,
  onClose,
  protocolLeases = [],
  sensorLeaderboard = [],
  transportTelemetry = [],
  arbitrageCycles = [],
  capacityData = null,
  strategyEcology = null,
  marketTwinAnomalies = null,
  executionMode = 'UNKNOWN',
  initialTab = 'leases',
}) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [liveLeases, setLiveLeases] = useState(protocolLeases);
  const [liveSensors, setLiveSensors] = useState(sensorLeaderboard);
  const [liveTelemetry, setLiveTelemetry] = useState(transportTelemetry);
  const [liveArbitrage, setLiveArbitrage] = useState(arbitrageCycles);
  const [liveCapacity, setLiveCapacity] = useState(capacityData);
  const [liveEcology, setLiveEcology] = useState(strategyEcology);
  const [paperMaxRiskData, setPaperMaxRiskData] = useState(null);
  const [v8ReplayData, setV8ReplayData] = useState(null);
  const [monteCarloData, setMonteCarloData] = useState(null);
  const [isTogglingMode, setIsTogglingMode] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    async function loadLiveData() {
      try {
        const [rLeases, rSensors, rTransport, rArb, rCap, rEco, rMaxRisk, rReplay, rMonte] = await Promise.allSettled([
          fetch('/api/solana/protocol-leases').then(r => r.json()),
          fetch('/api/solana/sensor-tournament').then(r => r.json()),
          fetch('/api/solana/transport-tournament').then(r => r.json()),
          fetch('/api/solana/arbitrage-cycles').then(r => r.json()),
          fetch('/api/solana/capacity-curve').then(r => r.json()),
          fetch('/api/solana/strategy-ecology').then(r => r.json()),
          fetch('/api/paper/max-risk').then(r => r.json()),
          fetch('/api/paper/v8-replay').then(r => r.json()),
          fetch('/api/paper/monte-carlo').then(r => r.json()),
        ]);
        if (!active) return;
        if (rLeases.status === 'fulfilled' && rLeases.value?.leases) setLiveLeases(rLeases.value.leases);
        if (rSensors.status === 'fulfilled' && rSensors.value?.leaderboard) setLiveSensors(rSensors.value.leaderboard);
        if (rTransport.status === 'fulfilled' && rTransport.value?.telemetry) setLiveTelemetry(rTransport.value.telemetry);
        if (rArb.status === 'fulfilled' && rArb.value?.cycles) setLiveArbitrage(rArb.value.cycles);
        if (rCap.status === 'fulfilled' && rCap.value?.curve) setLiveCapacity(rCap.value.curve);
        if (rEco.status === 'fulfilled' && rEco.value?.strategies) setLiveEcology(rEco.value);
        if (rMaxRisk.status === 'fulfilled') setPaperMaxRiskData(rMaxRisk.value);
        if (rReplay.status === 'fulfilled') setV8ReplayData(rReplay.value);
        if (rMonte.status === 'fulfilled') setMonteCarloData(rMonte.value);
      } catch {}
    }
    loadLiveData();
    return () => { active = false; };
  }, [isOpen]);

  async function handleToggleMode(newMode) {
    setIsTogglingMode(true);
    try {
      const res = await fetch('/api/paper/max-risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      const data = await res.json();
      if (data.ok) {
        const refresh = await fetch('/api/paper/max-risk').then(r => r.json());
        setPaperMaxRiskData(refresh);
      }
    } catch {}
    setIsTogglingMode(false);
  }

  const effectiveLeases = (liveLeases && liveLeases.length > 0) ? liveLeases : protocolLeases;
  const effectiveSensors = (liveSensors && liveSensors.length > 0) ? liveSensors : sensorLeaderboard;
  const effectiveTelemetry = (liveTelemetry && liveTelemetry.length > 0) ? liveTelemetry : transportTelemetry;
  const effectiveArbitrage = (liveArbitrage && liveArbitrage.length > 0) ? liveArbitrage : arbitrageCycles;
  const effectiveCapacity = liveCapacity || capacityData;
  const effectiveEcology = liveEcology || strategyEcology;

  const hasEvidence = (effectiveLeases && effectiveLeases.length > 0) || (effectiveSensors && effectiveSensors.length > 0) || (effectiveTelemetry && effectiveTelemetry.length > 0);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm transition-opacity" style={{ zIndex: 9999 }}>
      <div className="relative w-full max-w-4xl h-full border-l border-slate-800 shadow-2xl flex flex-col text-slate-100 overflow-hidden font-mono" style={{ background: '#080C14', borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between" style={{ background: '#0D1422' }}>
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  SYLPH FUSION — SOLANA-ONLY ARCHITECTURE
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800">
                  RESEARCH BLUEPRINT
                </span>
                {!hasEvidence && (
                  <span className="text-xs px-2 py-0.5 rounded font-bold bg-amber-950/70 text-amber-400 border border-amber-500/70">
                    FAIL-CLOSED
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Design overview • Runtime evidence is shown only when supplied
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs transition"
          >
            ESC / Close
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-5 gap-2 overflow-x-auto" style={{ background: '#0A101C' }}>
          {[
            { id: 'leases', label: 'Protocol Leases', icon: Lock },
            { id: 'sensors', label: 'Sensor Tournament', icon: Activity },
            { id: 'transport', label: 'Transport Lanes', icon: Zap },
            { id: 'arbitrage', label: 'Arbitrage Graph', icon: GitBranch },
            { id: 'capacity', label: 'Exit Before Entry', icon: Shield },
            { id: 'alpha', label: 'Alpha Factory & Ecology', icon: Compass },
            { id: 'max_risk', label: 'Max Risk & Chaos', icon: Zap },
          ].map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-3 px-3 text-xs font-medium border-b-2 transition whitespace-nowrap ${
                  isActive
                    ? 'border-emerald-500 text-emerald-400 bg-emerald-950/20'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6" style={{ background: '#080C14' }}>
          {/* TAB 1: PROTOCOL COMPATIBILITY LEASES */}
          {activeTab === 'leases' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold text-slate-400">
                    Protocol Lease Observations (Section 34 & 35)
                  </span>
                  <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                    {effectiveLeases.length} reported • certification unverified
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  This panel displays reported lease data only. It does not verify program binaries, layouts, expiry slots, or runtime enforcement.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {effectiveLeases.length === 0 && <div className="text-xs text-slate-500">No protocol lease observations are connected.</div>}
                {effectiveLeases.map((p, idx) => (
                  <div key={idx} className="bg-slate-900/40 border border-slate-800/80 rounded-md p-3 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-200">{p.protocolName}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-950 text-amber-400 border border-amber-800">
                        Reported: {p.verificationStatus || 'UNKNOWN'}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400 truncate">
                      <span className="text-slate-500">Program:</span> {p.programId}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>IDL: {p.idlVersion}</span>
                      <span>Fee: {p.feeModelVersion}</span>
                      <span className="text-amber-400 font-semibold">REPORTED ONLY</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: SENSOR TOURNAMENT */}
          {activeTab === 'sensors' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold text-slate-400">
                    Sensor Tournament (Section 5 & 6)
                  </span>
                  <span className="text-xs text-blue-400 font-semibold">
                    Economic value: UNKNOWN without reconciled outcomes and provider costs
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Sensor metrics are diagnostic until observations share a clock and slot, decode correctness is established, and costs and settled outcomes are reconciled.
                </p>
              </div>

              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-900 text-slate-400 uppercase text-[10px] border-b border-slate-800">
                    <tr>
                      <th className="p-3">Sensor Lane</th>
                      <th className="p-3">Coverage</th>
                      <th className="p-3">Mean Latency</th>
                      <th className="p-3">False Decodes</th>
                      <th className="p-3">Tournament Wins</th>
                      <th className="p-3">Economic State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {effectiveSensors.length === 0 && <tr><td className="p-3 text-slate-500" colSpan="6">No sensor observations are connected.</td></tr>}
                    {effectiveSensors.map((s, idx) => {
                      const hasObs = (s.totalEventsObserved === undefined || s.totalEventsObserved > 0) && (s.coverageRatePct > 0 || s.winsCount > 0 || s.meanLatencyMs > 0);
                      return (
                        <tr key={idx} className="hover:bg-slate-900/50">
                          <td className="p-3 font-semibold text-slate-200">
                            {s.sensorType}
                            {!hasObs && <span className="ml-2 text-[10px] text-slate-500 font-normal">UNCONNECTED</span>}
                          </td>
                          <td className="p-3 text-emerald-400">{hasObs && Number.isFinite(s.coverageRatePct) ? `${s.coverageRatePct.toFixed(1)}%` : '—'}</td>
                          <td className="p-3">{hasObs && Number.isFinite(s.meanLatencyMs) ? `${s.meanLatencyMs.toFixed(1)} ms` : '—'}</td>
                          <td className="p-3 text-amber-400">{hasObs && Number.isFinite(s.falseDecodeRatePct) ? `${s.falseDecodeRatePct.toFixed(1)}%` : '—'}</td>
                          <td className="p-3 font-bold text-white">{hasObs && Number.isFinite(s.winsCount) ? s.winsCount : '—'}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700">
                              {s.economicValueState || 'UNKNOWN'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: TRANSPORT LANES */}
          {activeTab === 'transport' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold text-slate-400">
                    Transport Tournament & Same Economic Generation (Section 25–29)
                  </span>
                  <span className="text-xs text-amber-400 font-semibold">
                    Required invariant: one economic intent per transaction generation
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Landing-Cost Optimizer maximizes realized net edge: P(land | fee, lane, congestion) × edge - fee - tip.
                  Transport racing multiplexes one exact transaction across Jito, direct TPU, and SWQoS without creating duplicate economic intent.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {effectiveTelemetry.length === 0 && <div className="text-xs text-slate-500">No transport observations are connected; landing and economic effects are unknown.</div>}
                {effectiveTelemetry.map((t, idx) => (
                  <div key={idx} className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-200">{t.lane}</span>
                      <span className="text-xs font-semibold text-emerald-400">{Number.isFinite(t.landingRatePct) ? `${t.landingRatePct.toFixed(1)}% reported landing` : 'Landing: UNKNOWN'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 pt-2 border-t border-slate-800/60">
                      <div>Latency: <span className="text-white font-medium">{Number.isFinite(t.meanLatencyMs) ? `${t.meanLatencyMs} ms` : 'UNKNOWN'}</span></div>
                      <div>Economic impact: <span className="text-amber-400">{Number.isFinite(t.netRealizedEdgeBps) ? `${t.netRealizedEdgeBps} bps reported` : 'UNKNOWN'}</span></div>
                      <div>Failures: <span className="text-amber-400">{Number.isFinite(t.instructionFailureRatePct) ? `${t.instructionFailureRatePct}%` : 'UNKNOWN'}</span></div>
                      <div>Mean Tip: <span className="text-slate-300">{t.meanTipLamports ?? 'UNKNOWN'} lamports</span></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: ARBITRAGE GRAPH */}
          {activeTab === 'arbitrage' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold text-slate-400">
                    Solana Arbitrage Graph & Completion Risk (Section 19 & 20)
                  </span>
                  <span className="text-xs text-purple-400 font-semibold">
                    Multi-Leg Cycles • Atomicity Premium
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Design target: compare routes using gross spread after fees, priority tip, impact, slippage, and completion risk. No route telemetry is connected here.
                </p>
              </div>

              {effectiveArbitrage.length > 0 ? (
                <div className="space-y-3">
                  {effectiveArbitrage.map((c, idx) => (
                    <div key={idx} className="bg-slate-900/40 border border-slate-800 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-emerald-400">
                          Cycle {idx + 1}: {c.legs.map(l => l.protocol).join(' → ')}
                        </span>
                        <span className="text-xs font-bold text-white bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                          {Number.isFinite(c.profitBps) ? `${c.profitBps} bps reported` : 'Spread: UNKNOWN'}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-400 grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 border-t border-slate-800/60">
                        <div>Input: {c.inputToken}</div>
                        <div>Output: {c.outputToken}</div>
                        <div>Atomicity: {c.isSingleAtomicTransaction ? 'ATOMIC (PREMIUM)' : 'SPLIT'}</div>
                        <div>Legs: {c.legs.length} hops</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-slate-900/20 border border-slate-800/60 rounded-lg p-6 text-center text-xs text-slate-400">
                  <GitBranch className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  No arbitrage cycle observations are connected. No profitability or execution-readiness conclusion is available.
                </div>
              )}
            </div>
          )}

          {/* TAB 5: CAPACITY & EXIT BEFORE ENTRY */}
          {activeTab === 'capacity' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold text-slate-400">
                    Exit Before Entry & Capacity Curves (Section 16–18)
                  </span>
                  <span className="text-xs text-rose-400 font-semibold">
                    Mandatory Liquidation Stress Test
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  The blueprint requires selling 25%, 50%, 75%, and 100% under stressed liquidity before entry. This drawer does not prove that the check runs or blocks an entry.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 space-y-3">
                  <span className="text-xs font-bold text-slate-300">Tranche Evacuation Feasibility</span>
                  <div className="space-y-2">
                    {(effectiveCapacity?.tranches || []).length === 0 && <div className="text-xs text-slate-500">No tranche simulation evidence is connected.</div>}
                    {(effectiveCapacity?.tranches || []).map((t, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs p-2 bg-slate-900/60 rounded border border-slate-800/40">
                        <span className="text-slate-300">{t.tranche}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400">Worst reported: {t.maxSlippage ?? 'UNKNOWN'}</span>
                          <span className="text-amber-400 font-bold">Reported: {t.status ?? 'UNKNOWN'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-900/40 border border-slate-800 rounded-lg p-4 space-y-3">
                  <span className="text-xs font-bold text-slate-300">Capacity Tiers & Slippage</span>
                  <div className="space-y-2 text-xs">
                    {(effectiveCapacity?.tiers || []).length === 0 && <div className="text-slate-500">No capacity simulations are connected.</div>}
                    {(effectiveCapacity?.tiers || []).map((tier, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-slate-900/60 rounded border border-slate-800/40">
                        <span className="text-slate-300">{tier.size}</span>
                        <span className="text-slate-400">Impact reported: {tier.impact ?? 'UNKNOWN'}</span>
                        <span className="text-amber-400 font-semibold">Remaining reported: {tier.remaining ?? 'UNKNOWN'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: ALPHA FACTORY & ECOLOGY */}
          {activeTab === 'alpha' && (
            <div className="space-y-4">
              <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase font-bold text-slate-400">
                    Solana Alpha Factory & Anti-Portfolio (Section 11–15 & 45)
                  </span>
                  <span className="text-xs text-emerald-400 font-semibold">
                    {effectiveEcology?.speciesCount ?? 'UNKNOWN'} Alpha species observed
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Research question: which opportunity has the strongest independently verified return after risk, capital, time, liquidity, and execution capacity? This view does not establish that result or runtime authority.
                </p>
              </div>

              <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">Anti-Portfolio Filter Shapley Attribution</span>
                  <span className="text-[11px] text-slate-400">Research attribution only; requires settled counterfactuals</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  {(effectiveEcology?.antiPortfolio || []).length === 0 && <div className="text-xs text-slate-500">No settled anti-portfolio outcomes are connected.</div>}
                  {(effectiveEcology?.antiPortfolio || []).map((f, idx) => (
                    <div key={idx} className="p-3 bg-slate-900/80 rounded border border-slate-800 text-xs">
                      <div className="font-semibold text-slate-200 truncate">{f.filter}</div>
                      <div className="mt-2 text-amber-400 font-bold">Net reported: {f.net ?? 'UNKNOWN'}</div>
                      <div className="text-[10px] text-slate-400 mt-1">Avoided reported: {f.avoided ?? 'UNKNOWN'} | Missed reported: {f.missed ?? 'UNKNOWN'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: PAPER MAX RISK & CHAOS COUNTERFACTUAL RUNTIME */}
          {activeTab === 'max_risk' && (
            <div className="space-y-5">
              {/* Header Box */}
              <div className="bg-slate-900/60 rounded-lg p-5 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold text-slate-300">
                      SYLPH FUSION — PAPER_MAX_RISK & CHAOS RUNTIME
                    </span>
                    <span className={`text-xs px-2.5 py-0.5 rounded font-bold border ${
                      paperMaxRiskData?.isMaxRisk
                        ? 'bg-rose-950/80 text-rose-300 border-rose-600 animate-pulse'
                        : 'bg-emerald-950/80 text-emerald-400 border-emerald-700'
                    }`}>
                      {paperMaxRiskData?.mode || 'PAPER_STANDARD'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={isTogglingMode}
                      onClick={() => handleToggleMode(paperMaxRiskData?.isMaxRisk ? 'PAPER_STANDARD' : 'PAPER_MAX_RISK')}
                      className={`px-3 py-1.5 rounded text-xs font-bold transition flex items-center gap-1.5 ${
                        paperMaxRiskData?.isMaxRisk
                          ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                          : 'bg-rose-900 hover:bg-rose-800 text-rose-100 border border-rose-700'
                      }`}
                    >
                      {paperMaxRiskData?.isMaxRisk ? 'Switch to Standard Safety' : 'Engage Max Risk (Chaos)'}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Operating Principle: <strong>Risk may be bypassed in PAPER_MAX_RISK. Reality may not.</strong> 100% bankroll allocation, holding through 90%+ drawdowns, and simulated ruin are permitted. Production capital remains permanently air-gapped; AMM reserves, liquidity ceilings, and double-entry conservation are strictly enforced.
                </p>
              </div>

              {/* 15 Invariant Proof Cards Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-slate-900/40 p-3 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Drawdown & Loss Halts</div>
                  <div className={`mt-1 font-bold text-sm ${paperMaxRiskData?.isMaxRisk ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {paperMaxRiskData?.isMaxRisk ? 'BYPASS / SHADOW' : 'ACTIVE (500 bps)'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Invariant 1–2</div>
                </div>
                <div className="bg-slate-900/40 p-3 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Bankroll Allocation</div>
                  <div className={`mt-1 font-bold text-sm ${paperMaxRiskData?.isMaxRisk ? 'text-rose-400' : 'text-slate-300'}`}>
                    {paperMaxRiskData?.isMaxRisk ? '100% SIZING ALLOWED' : '5% POSITION CAP'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Invariant 3–5</div>
                </div>
                <div className="bg-slate-900/40 p-3 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Exit Stops & Drawdown</div>
                  <div className={`mt-1 font-bold text-sm ${paperMaxRiskData?.isMaxRisk ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {paperMaxRiskData?.isMaxRisk ? 'DISABLED / 90%+ HOLD' : 'NORMAL STOPS'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Invariant 6–7</div>
                </div>
                <div className="bg-slate-900/40 p-3 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Simulated Ruin</div>
                  <div className={`mt-1 font-bold text-sm ${paperMaxRiskData?.hasBankrupted ? 'text-rose-500' : 'text-emerald-400'}`}>
                    {paperMaxRiskData?.hasBankrupted ? 'TERMINAL BANKRUPT' : 'SOLVENT'}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">Invariant 8 (Never Reset)</div>
                </div>
              </div>

              {/* Physical Reality Invariants */}
              <div className="bg-slate-900/40 p-4 rounded-lg border border-slate-800 space-y-2">
                <div className="text-xs uppercase font-bold text-slate-300 flex items-center justify-between">
                  <span>Physical Microstructure & Security Seals</span>
                  <span className="text-emerald-400 font-semibold text-[11px]">ALL HARD SEALS ENGAGED</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/80">
                    <span className="text-slate-400">Double-Entry Accounting:</span>
                    <strong className="block text-emerald-400 mt-0.5">STRICTLY CONSERVED</strong>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/80">
                    <span className="text-slate-400">Constant Product AMM:</span>
                    <strong className="block text-emerald-400 mt-0.5">RESERVES RESPECTED</strong>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900/90 border border-slate-800/80">
                    <span className="text-slate-400">Production Capital & Signer:</span>
                    <strong className="block text-rose-400 mt-0.5">AIR-GAPPED / BLOCKED</strong>
                  </div>
                </div>
              </div>

              {/* Counterfactual Risk Ledger & Moonshot Tax */}
              <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200">
                    Counterfactual Risk Gate Ledger ({paperMaxRiskData?.totalBypasses || 0} bypass events)
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    FilterNetValue = AvoidedLoss - MissedExecutableEV
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Total Filter Net Value</div>
                    <div className="text-base font-bold text-emerald-400 mt-1">
                      {paperMaxRiskData?.counterfactualLedger?.filterNetValueSol ?? '+0.00 SOL'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Capital saved by safety filters</div>
                  </div>
                  <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Moonshot Tax MT(F)</div>
                    <div className="text-base font-bold text-amber-400 mt-1">
                      {paperMaxRiskData?.counterfactualLedger?.overallMoonshotTax ?? '0.00x'}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">Extreme upside forgone per $1 loss saved</div>
                  </div>
                  <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                    <div className="text-[10px] text-slate-400 uppercase font-semibold">Extreme Moonshots Blocked</div>
                    <div className="text-base font-bold text-rose-400 mt-1">
                      {paperMaxRiskData?.counterfactualLedger?.moonshotsBlockedCount ?? 0} (&gt;= 10x)
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">50x+: {paperMaxRiskData?.counterfactualLedger?.extremeWinnersBlockedCount ?? 0}</div>
                  </div>
                </div>
              </div>

              {/* Monte Carlo Bankroll Ruin & Moonshot Probabilities */}
              {monteCarloData?.comparison && (
                <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">
                      Monte Carlo Bankroll Simulation ({monteCarloData.numPaths} paths, {monteCarloData.tradesPerPath} trades)
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      $250 Starting Bankroll • Section X & CV
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                      <div className="font-semibold text-emerald-400 mb-1">PAPER_STANDARD (5% Sizing)</div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] mt-2">
                        <div>P(Bankrupt): <strong>{(monteCarloData.comparison.PAPER_STANDARD.bankruptcyProbability * 100).toFixed(1)}%</strong></div>
                        <div>P(2x): <strong>{(monteCarloData.comparison.PAPER_STANDARD.p2xProbability * 100).toFixed(1)}%</strong></div>
                        <div>P(10x): <strong>{(monteCarloData.comparison.PAPER_STANDARD.p10xProbability * 100).toFixed(1)}%</strong></div>
                        <div>Median Wealth: <strong>${monteCarloData.comparison.PAPER_STANDARD.medianTerminalEquityUsd}</strong></div>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-900/80 rounded border border-slate-800">
                      <div className="font-semibold text-rose-400 mb-1">PAPER_MAX_RISK (100% Sizing)</div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] mt-2">
                        <div>P(Bankrupt): <strong className="text-rose-400">{(monteCarloData.comparison.PAPER_MAX_RISK.bankruptcyProbability * 100).toFixed(1)}%</strong></div>
                        <div>P(2x): <strong className="text-emerald-400">{(monteCarloData.comparison.PAPER_MAX_RISK.p2xProbability * 100).toFixed(1)}%</strong></div>
                        <div>P(10x): <strong className="text-emerald-400">{(monteCarloData.comparison.PAPER_MAX_RISK.p10xProbability * 100).toFixed(1)}%</strong></div>
                        <div>Median Wealth: <strong>${monteCarloData.comparison.PAPER_MAX_RISK.medianTerminalEquityUsd}</strong></div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* V8 Replay Findings */}
              {v8ReplayData?.report && (
                <div className="border border-slate-800 rounded-lg p-4 bg-slate-900/40 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-200">V8 Historical Causal Replay (Uncensored Population)</span>
                    <span className="text-emerald-400 font-semibold">
                      +{v8ReplayData.delta?.winnersDelta ?? 0} Runners Caught in Max Risk
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Evaluated identically matched candidates without survivorship bias. Standard safety avoided rugs but missed extreme asymmetric 10x–100x trajectories by halting on normal pre-runner drawdowns. Max Risk captured the runners while sustaining simulated ruin on non-viable tokens.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 text-xs flex items-center justify-between text-slate-400" style={{ background: '#0D1422' }}>
          <div className="flex items-center gap-4">
            <span>Market Twin Anomalies: <strong className="text-amber-400">{Number.isFinite(marketTwinAnomalies) ? marketTwinAnomalies : 'UNKNOWN'}</strong></span>
            <span>Execution Mode: <strong className="text-amber-400">{executionMode}</strong></span>
          </div>
          <span className="text-[11px] text-slate-500">UNKNOWN ≠ SAFE • PROFIT PREDICTED ≠ PROFIT REALIZED</span>
        </div>
      </div>
    </div>
  );
}
