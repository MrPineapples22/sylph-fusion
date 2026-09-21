import { readJson } from './read-json.js';
import RiskDetails from './RiskDetails.jsx';
import TokenIntelligenceInspector from './components/TokenIntelligenceInspector.jsx';
import SystemIntelligenceDrawer from './components/SystemIntelligenceDrawer.jsx';
import React, { useState, useEffect, useRef } from 'react';
import { Radar, ShieldCheck, ArrowUpRight, Search, Activity, AlertTriangle, RefreshCw, ShieldAlert, Layers } from 'lucide-react';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: 6 });
const usd = (n) => (n == null ? '—' : money.format(n));
const short = (s) => (s ? `${s.slice(0, 5)}…${s.slice(-5)}` : '—');
const read = (path, signal) => readJson('/live/api/' + path, signal);

export default React.memo(function LiveDashboard() {
  const [market, setMarket] = useState(null);
  const [error, setError] = useState('');
  const [feedError, setFeedError] = useState('');
  const [tab, setTab] = useState('markets');
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [risk, setRisk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState([]);
  const [showCapAssurance, setShowCapAssurance] = useState(false);
  const [showSysIntel, setShowSysIntel] = useState(false);
  const [saved, setSaved] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem('sylph-live-watchlist') || '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });

  const scan = useRef(null);
  const search = useRef(null);
  const [scanRevision, setScanRevision] = useState(0);

  useEffect(() => {
    let closed = false;
    let timer;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const data = await read('market', controller.signal);
        if (!closed) {
          setMarket(data);
          setFeedError('');
        }
      } catch (e) {
        if (!closed) setFeedError(e.message);
      } finally {
        if (!closed) timer = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      closed = true;
      controller.abort();
      clearTimeout(timer);
      scan.current?.abort();
      search.current?.abort();
    };
  }, []);

  // Refresh only the selected token; cleanup aborts stale requests on token switch.
  useEffect(() => {
    if (!selected?.mint) return;
    let stopped = false;
    let timer;
    const controller = new AbortController();
    scan.current = controller;
    async function refresh() {
      setBusy(true);
      try {
        const report = await read('risk?mint=' + encodeURIComponent(selected.mint), controller.signal);
        if (!stopped) setRisk(report);
      } catch (e) {
        if (!stopped) setRisk({ error: e.message });
      } finally {
        if (!stopped) {
          setBusy(false);
          timer = setTimeout(refresh, 60000);
        }
      }
    }
    refresh();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [selected?.mint, scanRevision]);

  const tokens = market?.tokens || [];
  const byMint = new Map(tokens.map((t) => [t.mint, t]));
  const rows = results ?? (tab === 'launches' ? market?.launches : tab === 'kol' ? market?.kol : tab === 'saved' ? tokens.filter((t) => saved.includes(t.mint)) : tokens) ?? [];
  const chosen = selected ? { ...selected, ...byMint.get(selected.mint) } : null;

  function select(row) {
    if (row.mint === selected?.mint) return;
    scan.current?.abort();
    setBusy(false);
    setSelected(row);
    setRisk(null);
  }

  async function lookup(e) {
    e.preventDefault();
    if (!query.trim()) return;
    search.current?.abort();
    const controller = new AbortController();
    search.current = controller;
    setSearching(true);
    try {
      setResults(await read('search?q=' + encodeURIComponent(query.trim()), controller.signal));
      setError('');
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  function inspect() {
    if (!chosen) return;
    scan.current?.abort();
    setRisk(null);
    setScanRevision((v) => v + 1);
  }

  function save() {
    if (!chosen) return;
    const next = saved.includes(chosen.mint)
      ? saved.filter((m) => m !== chosen.mint)
      : [...saved, chosen.mint];
    setSaved(next);
    try {
      localStorage.setItem('sylph-live-watchlist', JSON.stringify(next));
    } catch {
      setError('Watchlist could not be saved locally.');
    }
  }

  const links = chosen
    ? [
        ['Rugcheck', `https://rugcheck.xyz/tokens/${chosen.mint}`],
        ['Solsniffer', `https://solsniffer.com/scanner/${chosen.mint}`],
        ['Bubblemaps', `https://app.bubblemaps.io/sol/token/${chosen.mint}`],
        ['DEX Screener', `https://dexscreener.com/solana/${chosen.mint}`],
        ['Pump.fun', `https://pump.fun/coin/${chosen.mint}`],
        ['GMGN', `https://gmgn.ai/sol/token/${chosen.mint}`],
        ['Axiom', `https://axiom.trade/t/${chosen.mint}`],
        ['Photon', `https://photon-sol.tinyastro.io/en/lp/${chosen.pair || chosen.mint}`],
        ['BullX', `https://bullx.io/terminal?chainId=1399811149&address=${chosen.mint}`],
        ['Jupiter', `https://jup.ag/swap/SOL-${chosen.mint}`],
        ['Solana FM', 'https://solana.fm/?cluster=mainnet-alpha'],
        ['Orb Markets', 'https://orbmarkets.io/markets'],
        ['Solana Explorer', 'https://explorer.solana.com/'],
        ['Solana Beach', 'https://solanabeach.io/'],
        ['Jito Explorer', 'https://explorer.jito.wtf/'],
        ['Solscan', `https://solscan.io/token/${chosen.mint}`],
      ]
    : [];

  const handleForceRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const data = await read('market');
      setMarket(data);
      setFeedError('');
      setDismissedAlerts([]);
    } catch (e) {
      setFeedError(e.message);
    } finally {
      setRefreshing(false);
    }
  };

  const isFeedStale = Boolean(feedError) ||
    market?.systemOmega?.systemHealth?.marketFeed === 'STALE' ||
    ['solana', 'pump'].some((k) => {
      const s = market?.sources?.[k];
      return s && (s.state === 'stale' || s.state === 'rate_limited' || (s.at && Date.now() - s.at > 10000));
    });

  const rateLimitedSources = Object.entries(market?.sources || {}).filter(([_, s]) => s?.state === 'rate_limited');


  const chosenRisks = chosen ? [
    chosen.bundlerDetected && 'Bundler coordinated wallet ring detected',
    chosen.devDumpingDetected && 'Developer / creator dumping active',
    chosen.excessiveConcentration && 'Excessive insider concentration (>30%)',
    chosen.rug && chosen.rug !== 'CLEAN' && `RugCheck flagged risk: ${chosen.rug}`,
    Number(chosen.hsi) >= 65 && `Severe HSI / Sybil cluster score (${chosen.hsi}/100)`
  ].filter(Boolean) : [];

  return (
    <section id="live-dashboard" className="live-dashboard">
      <div className="panel-heading">
        <h2>
          <Radar size={16} /> Live dashboard <span className="pill">REAL MARKET DATA</span>{' '}
          <button
            type="button"
            className="pill-system-ok pill-system-interactive"
            id="btn-toggle-system-intelligence"
            onClick={() => setShowSysIntel(!showSysIntel)}
            title="Toggle Deep System Intelligence & Architecture Telemetry (Sections 19-28)"
          >
            <span className="system-dot"></span>SYSTEM: {market?.systemStrip?.data || 'UNKNOWN'} · {showSysIntel ? 'HIDE INTEL ▲' : 'SYSTEM INTEL (Ω) ▼'}
          </button>
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="btn-refresh-feed"
            onClick={handleForceRefresh}
            disabled={refreshing}
            title="Poll authoritative market feeds now"
            style={{
              padding: '4px 10px',
              background: 'rgba(0, 194, 255, 0.1)',
              border: '1px solid rgba(0, 194, 255, 0.25)',
              borderRadius: '5px',
              color: '#7adfff',
              fontSize: '11px',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Syncing…' : 'Sync feeds'}
          </button>
          <a href="#workspace">Strategy simulator ↓</a>
        </div>
      </div>

      {/* Tier 1: Urgent Safety Alerts (Level 1) */}
      {(isFeedStale || feedError || rateLimitedSources.length > 0 || chosenRisks.length > 0) && (
        <div className="tier-1-urgent-alerts" role="alert" aria-live="assertive">
          <div className="tier-section-badge tier-badge-l1">
            <ShieldAlert size={10} /> LEVEL 1 · URGENT SAFETY ALERTS
          </div>

          {(isFeedStale || feedError) && !dismissedAlerts.includes('feed-stale') && (
            <div className="urgent-alert-item">
              <div>
                <div className="urgent-alert-title">
                  <AlertTriangle size={14} className="text-danger" />
                  CRITICAL: MARKET FEED STALE / DISCONNECTED
                </div>
                <div className="urgent-alert-desc">
                  {feedError
                    ? `Live market feed error: ${feedError}. Pre-trade risk gate is armed and fail-closed.`
                    : 'Solana network or PumpPortal WS heartbeat lag > 10s. Order submission is locked fail-closed.'}
                </div>
              </div>
              <div className="urgent-alert-actions">
                <button
                  type="button"
                  className="btn-urgent-action"
                  disabled={refreshing}
                  onClick={handleForceRefresh}
                  title="Force reconnect and fetch latest market snapshot"
                >
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Reconnecting…' : 'Reconnect Feeds'}
                </button>
                <button
                  type="button"
                  className="btn-dismiss-alert"
                  onClick={() => setDismissedAlerts((prev) => [...prev, 'feed-stale'])}
                  title="Dismiss alert banner"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {rateLimitedSources.length > 0 && !dismissedAlerts.includes('rate-limit') && (
            <div className="urgent-alert-item">
              <div>
                <div className="urgent-alert-title">
                  <AlertTriangle size={14} className="text-warn" />
                  RATE LIMIT ACTIVE: {rateLimitedSources.map(([k]) => k.toUpperCase()).join(', ')}
                </div>
                <div className="urgent-alert-desc">
                  RPC / API provider returned HTTP 429. Requests are rate limited; feed recovery has not been verified.
                </div>
              </div>
              <div className="urgent-alert-actions">
                <button
                  type="button"
                  className="btn-urgent-action"
                  disabled={refreshing}
                  onClick={handleForceRefresh}
                  title="Retry providers now"
                >
                  <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Checking…' : 'Retry Providers'}
                </button>
              </div>
            </div>
          )}

          {chosen && chosenRisks.length > 0 && (
            <div className="urgent-alert-item">
              <div>
                <div className="urgent-alert-title">
                  <ShieldAlert size={14} className="text-danger" />
                  TOKEN SAFETY ALERT: {chosen.symbol || chosen.name} ({short(chosen.mint)})
                </div>
                <div className="urgent-alert-desc">
                  {chosenRisks.join(' · ')}
                </div>
              </div>
              <div className="urgent-alert-actions">
                <button
                  type="button"
                  className="btn-urgent-action"
                  disabled={busy}
                  onClick={inspect}
                  title="Run fresh deep forensics safety scan"
                >
                  <ShieldCheck size={12} />
                  {busy ? 'Scanning…' : 'Re-scan Safety'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tier 2: Core Operational Metrics (Level 2) */}
      <div className="tier-2-core-metrics">
        <div style={{ padding: '8px 16px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="tier-section-badge tier-badge-l2">
            <Layers size={10} /> LEVEL 2 · CORE OPERATIONAL METRICS
          </span>
        </div>

        <div className="live-source-grid">
          {[
            ['solana', 'Solana network'],
            ['dex', 'DEX Screener'],
            ['pump', 'Pump.fun · PumpPortal'],
            ['kol', 'Kolscan snapshot'],
          ].map(([key, label]) => {
            const source = market?.sources?.[key];
            const isStaleSource = source?.at && Date.now() - source.at > 10000;
            const stateClass = feedError || source?.state === 'stale' || isStaleSource
              ? 'text-warn'
              : source?.state === 'rate_limited'
              ? 'text-danger'
              : source?.state === 'live' || source?.state === 'healthy'
              ? 'positive'
              : source?.state === 'degraded'
              ? 'text-warn'
              : '';

            const displayState = feedError
              ? 'Disconnected'
              : source?.state
              ? source.state.toUpperCase()
              : 'CONNECTING';

            return (
              <div key={key}>
                <small>{label}</small>
                <b className={stateClass}>
                  {displayState}
                </b>
                <small>
                  {source?.at
                    ? `Updated ${Math.max(0, Math.floor((Date.now() - source.at) / 1000))}s ago`
                    : 'Waiting for source'}
                  {key === 'solana' && market?.network?.slot ? ` · Slot ${market.network.slot}` : ''}
                </small>
              </div>
            );
          })}
        </div>

        {/* Part VI - Market Context Strip */}
        <div className="market-context-strip" aria-label="Market Context Strip">
          <div className="market-context-item">
            <small>SOL:</small>
            <b className="active-cyan">{usd(market?.marketContext?.sol_price_usd)}</b>
          </div>
          <div className="market-context-item">
            <small>MEME REGIME:</small>
            <b>{market?.marketContext?.meme_regime ?? 'UNKNOWN'}</b>
          </div>
          <div className="market-context-item">
            <small>OPP DENSITY:</small>
            <b>{market?.marketContext?.opportunity_density ?? '—'}</b>
          </div>
          <div className="market-context-item">
            <small>SYSTEM LOAD:</small>
            <b className="active-good">{market?.marketContext?.system_load ?? 'UNVERIFIED'}</b>
          </div>
          <div className="market-context-item">
            <small>DATA HEALTH:</small>
            <b className={isFeedStale ? 'text-danger' : 'active-good'}>
              {isFeedStale ? 'STALE' : market?.marketContext?.data_health ?? 'UNKNOWN'}
            </b>
          </div>
          <div className="market-context-item">
            <small>EXEC HEALTH:</small>
            <b className={isFeedStale ? 'text-warn' : 'active-good'}>
              {isFeedStale ? 'FAIL_CLOSED' : market?.marketContext?.execution_health ?? 'UNVERIFIED'}
            </b>
          </div>
          <div className="market-context-item">
            <small>GUARDIAN:</small>
            <b className="active-good">{market?.marketContext?.guardian_status ?? 'UNVERIFIED'}</b>
          </div>
          <div className="market-context-item">
            <small>SENTINEL:</small>
            <b className="active-cyan">{market?.marketContext?.sentinel_status ?? 'UNVERIFIED'}</b>
          </div>
        </div>
      </div>

      {/* Blueprint Part LXXVIII — Main UI: Capital Authority Strip & Signing Assurance */}
      {(() => {
        const cap = market?.capitalAuthority || {};

        return (
          <div className="capital-authority-container">
            <div className="capital-authority-strip" aria-label="Capital Authority Strip">
              <div className="capital-strip-badge" title="Part I & LXXI: Institutional Authority Lattice Mode">
                <span className="cap-label">AUTHORITY:</span>
                <span className="cap-val cap-cyan">{cap.authorityMode || 'OBSERVE_ONLY'}</span>
              </div>
              <div className="capital-strip-badge" title="Part II & IV: Authoritative Double-Entry Capital Truth">
                <span className="cap-label">CAPITAL:</span>
                <span className="cap-val cap-warn">{cap.capitalStatus || 'UNVERIFIED'}</span>
              </div>
              <div className="capital-strip-badge" title="Part XXX: Continuous Position Survival & Reduction Capability">
                <span className="cap-label">SURVIVAL:</span>
                <span className="cap-val cap-warn">{cap.survivalHealth || 'UNKNOWN'}</span>
              </div>
              <div className="capital-strip-badge" title="Part XXV & XXXI: Verified Liquidity Exit Coverage">
                <span className="cap-label">EXIT:</span>
                <span className="cap-val cap-warn">{cap.exitCoveragePct ?? '—'}%</span>
              </div>
              <div className="capital-strip-badge" title="Part LII & LIV: Cryptographic Proof Freshness">
                <span className="cap-label">PROOFS:</span>
                <span className="cap-val cap-cyan">{cap.proofsStatus || 'UNVERIFIED'}</span>
              </div>
              <div className="capital-strip-badge" title="Part LVI & LVIII: Monotonic Revocation Priority">
                <span className="cap-label">REVOKE:</span>
                <span className="cap-val cap-cyan">{cap.revocationPriority || 'UNKNOWN'}</span>
              </div>
              <div className="capital-strip-badge" title="Part XVIII & XIX: Zone 0 Hardware Custody Vault">
                <span className="cap-label">VAULT:</span>
                <span className={`cap-val ${cap.vaultArmed ? 'cap-good' : 'cap-warn'}`}>{cap.vaultArmed ? 'ARMED' : 'LOCKED'}</span>
              </div>
              <div className="capital-strip-badge" title="Part LXVIII: Blockchain Consensus Mirror">
                <span className="cap-label">CHAIN:</span>
                <span className="cap-val cap-warn">{cap.chainCoherence || 'UNKNOWN'}</span>
              </div>
              <button
                type="button"
                className="capital-assurance-toggle"
                onClick={() => setShowCapAssurance(!showCapAssurance)}
                title="Toggle Deep Capital Assurance and Signing Gate"
              >
                {showCapAssurance ? 'Hide Assurance ▲' : 'Assurance Detail ▼'}
              </button>
              <button
                type="button"
                className="capital-assurance-toggle"
                id="btn-intel-toggle-strip"
                onClick={() => setShowSysIntel(!showSysIntel)}
                title="Toggle Deep System Intelligence (Omega Control & Epistemic)"
              >
                {showSysIntel ? 'Hide Intel ▲' : 'System Intel (Ω) ▼'}
              </button>
            </div>

            {/* Expandable Signing Assurance Strip & Deep Capital Assurance (Part LXXIX & LXXXI) */}
            {showCapAssurance && (
              <div className="capital-deep-panel" aria-label="Capital Assurance Deep Details">
                <div className="signing-assurance-strip" aria-label="Signing Assurance Strip">
                  <span className="sign-assurance-title">SIGNING GATE:</span>
                  <span className="sign-gate-item">GATE <b>{cap.signingGate?.gateReady ? 'READY' : 'WAIT'}</b></span>
                  <span className="sign-gate-item">RESERVE <b>{cap.signingGate?.reservationPass ? 'PASS' : 'FAIL'}</b></span>
                  <span className="sign-gate-item">STATE <b>{cap.signingGate?.stateCurrent ? 'CURRENT' : 'STALE'}</b></span>
                  <span className="sign-gate-item">PROOF <b>{cap.signingGate?.proofCurrent ? 'CURRENT' : 'EXPIRED'}</b></span>
                  <span className="sign-gate-item">EPOCH <b>{cap.signingGate?.controlEpoch ?? '—'}</b></span>
                  <span className="sign-gate-item">REVOKE <b>{cap.signingGate?.revocationEpoch ?? '—'}</b></span>
                  <span className="sign-gate-item">VAULT <b className="cap-good">{cap.signingGate?.vaultStatus || 'LOCKED'}</b></span>
                </div>

                <div className="capital-assurance-grid">
                  <div className="cap-metric-card">
                    <small>Capital State Root</small>
                    <code>{cap.assuranceDeep?.capitalStateRoot || '—'}</code>
                  </div>
                  <div className="cap-metric-card">
                    <small>Confirmed Cash / Reserved</small>
                    <b>{cap.assuranceDeep?.confirmedCapitalSol ?? '—'} SOL / {cap.assuranceDeep?.reservedCapitalSol ?? '—'} SOL</b>
                  </div>
                  <div className="cap-metric-card">
                    <small>Emergency Reserve (Zone 0)</small>
                    <b className="cap-good">{cap.assuranceDeep?.emergencyReserveSol ?? '—'} SOL (unverified)</b>
                  </div>
                  <div className="cap-metric-card">
                    <small>Max Blast Radius / Max Compromise</small>
                    <b>{cap.assuranceDeep?.maxBlastRadiusSol ?? '—'} SOL / {cap.assuranceDeep?.maxCompromiseLossSol ?? '—'} SOL</b>
                  </div>
                  <div className="cap-metric-card">
                    <small>Stressed Exit Coverage</small>
                    <b className="cap-cyan">{cap.stressedCoveragePct ?? '—'}% (Evac Time: {cap.positionSurvival?.timeToEvacuateSec ?? '—'}s)</b>
                  </div>
                  <div className="cap-metric-card">
                    <small>Exit Proof Ladder / Proof Debt</small>
                    <b>{cap.positionSurvival?.exitProofLevel?.slice(0, 2) || 'UNKNOWN'} / Debt: {cap.assuranceDeep?.proofDebtScore ?? '—'}</b>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {showSysIntel && (
        <SystemIntelligenceDrawer
          data={market?.systemOmega}
          onClose={() => setShowSysIntel(false)}
        />
      )}

      {(feedError || error) && (
        <p role="status" className="live-error">
          {feedError || error} {market ? 'Last successful snapshot retained.' : ''}
        </p>
      )}

      <div className="live-grid">
        <section className="panel" aria-label="Level 2: Market Discovery and Intelligence">
          <div style={{ padding: '12px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="tier-section-badge tier-badge-l2">
              <Layers size={10} /> LEVEL 2 · MARKET DISCOVERY
            </span>
            <small className="text-muted">{rows.length} tokens indexed</small>
          </div>
          <div className="execution-tabs">
            {[
              ['markets', 'Markets'],
              ['launches', 'New launches'],
              ['kol', 'KOL flow'],
              ['saved', 'Saved'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={tab === key ? 'active' : ''}
                aria-pressed={tab === key}
                onClick={() => {
                  setTab(key);
                  setResults(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <form className="live-search" onSubmit={lookup}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search token or contract address"
              aria-label="Search live tokens"
            />
            <button disabled={searching}>
              <Search size={14} />
              {searching ? 'Searching…' : 'Search'}
            </button>
            {results && (
              <button type="button" onClick={() => setResults(null)}>
                Clear
              </button>
            )}
          </form>

          <p className="live-note">
            {results
              ? 'Search results'
              : tab === 'kol'
              ? 'Public Kolscan snapshot · signals are not profitability claims'
              : tab === 'launches'
              ? 'PumpPortal token creation stream · some launches have no indexed quote'
              : 'Unified Intelligence Table · TIME · SYMBOL · TX · MCAP · LIQ · RUG · HSI · PUMP · PoD · CONF · EDGE · STATUS'}
          </p>

          <div className="live-table table-scroll">
            <table>
              <thead>
                <tr>
                  {tab === 'kol' && !results ? (
                    <>
                      <th>TOKEN</th>
                      <th>WALLET / SIDE</th>
                      <th>SOL</th>
                    </>
                  ) : (
                    <>
                      <th>TIME</th>
                      <th>SYMBOL</th>
                      <th>TX</th>
                      <th>MCAP</th>
                      <th>LIQ</th>
                      <th>RUG</th>
                      <th>HSI</th>
                      <th>PUMP</th>
                      <th>PoD</th>
                      <th>CONF</th>
                      <th>EDGE</th>
                      <th>STATUS</th>
                      <th>LINKS</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((row, i) => {
                  const token = { ...row, ...byMint.get(row.mint) };
                  const timeStr =
                    token.time ||
                    (token.at ? new Date(token.at).toISOString().substring(11, 19) : '—');
                  const symbolStr = token.symbol || token.name || short(row.mint);
                  const txCount = token.txs ?? token.txCount ?? '—';
                  const mcapStr = token.mcap ? usd(token.mcap) : usd(token.cap);
                  const liqStr = usd(token.liquidity);
                  const rugStr = token.rug || 'UNKNOWN';
                  const hsiVal = token.hsi ?? '—';
                  const pumpVal = token.pump ?? token.pumpScore ?? '—';
                  const podState = token.pod ?? 'UNKNOWN';
                  const confLevel = token.conf ?? 'LOW';
                  const edgeVal = token.edge ?? '—';
                  const statusVal = token.status ?? 'OBSERVE';
                  const phaseVal = token.phase || 'UNKNOWN';
                  const flowVal = token.flow || 'UNKNOWN';
                  const thesisVal = token.thesis || 'UNVERIFIED';
                  const proofVal = token.proof || 'UNVERIFIED';

                  return (
                    <tr
                      key={`${row.mint}-${row.signature || i}`}
                      className={chosen?.mint === row.mint ? 'live-selected' : ''}
                    >
                      {tab === 'kol' && !results ? (
                        <>
                          <td>
                            <button onClick={() => select(token)}>
                              {symbolStr}
                              <ArrowUpRight size={12} />
                            </button>
                            <small>{short(row.mint)}</small>
                          </td>
                          <td>
                            {short(row.wallet)}
                            <small>{row.side?.toUpperCase()}</small>
                          </td>
                          <td>{row.sol?.toFixed(4)}</td>
                        </>
                      ) : (
                        <>
                          <td>
                            <small>{timeStr}</small>
                          </td>
                          <td>
                            <button onClick={() => select(token)} className="token-symbol-btn">
                              <b>{symbolStr}</b>
                              <ArrowUpRight size={11} />
                            </button>
                          </td>
                          <td>
                            <small>{txCount}</small>
                          </td>
                          <td>
                            <small>{mcapStr}</small>
                          </td>
                          <td>
                            <small>{liqStr}</small>
                          </td>
                          <td>
                            <span className={rugStr === 'CLEAN' ? 'text-good' : 'text-danger'}>
                              {rugStr}
                            </span>
                          </td>
                          <td>
                            <span className={Number(hsiVal) >= 50 ? 'text-warn' : 'text-good'}>
                              {hsiVal}
                            </span>
                          </td>
                          <td>
                            <span className="text-accent">{pumpVal}</span>
                          </td>
                          <td>
                            <span className={`pod-badge pod-${podState}`}>{podState}</span>
                          </td>
                          <td>
                            <span className={`conf-badge conf-${confLevel}`}>{confLevel}</span>
                          </td>
                          <td>
                            <b className={String(edgeVal).startsWith('+') ? 'text-good' : 'text-warn'}>
                              {edgeVal}
                            </b>
                          </td>
                          <td>
                            <div className="status-cell-wrap">
                              <span className={`status-pill status-${String(statusVal).toLowerCase()}`}>
                                {statusVal}
                              </span>
                              <div className="blueprint-telemetry-micro">
                                <span className="micro-tag tag-attn" title={`Bohr Attention Tier: ${token.attn || 'A0'}`}>
                                  {token.attn || 'A0'}
                                </span>
                                <span className="micro-tag tag-path" title={`Kepler Trajectory: ${token.path || 'ACCUM'}`}>
                                  {token.path || 'ACCUM'}
                                </span>
                                <span
                                  className={`micro-tag tag-stab ${(token.stab || 'STABLE').toLowerCase().includes('frag') || (token.stab || 'STABLE').toLowerCase().includes('casc') ? 'stab-fragile' : ''}`}
                                  title={`Chandrasekhar Stability: ${token.stab || 'STABLE'}`}
                                >
                                  {token.stab || 'STABLE'}
                                </span>
                                <span className="micro-tag tag-belief" title={`Laplace Dominant Belief: ${token.belief || 'ORGANIC'}`}>
                                  {token.belief || 'ORGANIC'}
                                </span>
                                <span
                                  className={`micro-tag tag-unc ${(token.unc || 'MED') === 'HIGH' ? 'unc-high' : ''}`}
                                  title={`Curie Uncertainty: ${token.unc || 'MED'}`}
                                >
                                  {token.unc || 'MED'}
                                </span>
                                <span className="micro-tag tag-edge-state" title={`Shannon Information State: ${token.edgeState || 'EARLY'}`}>
                                  {token.edgeState || 'EARLY'}
                                </span>
                                <span className="micro-tag tag-intel" title={`Intel Indicator: ${token.intel || 'STRONG'}`}>
                                  {token.intel === 'STRONG' ? 'INTEL ↑' : token.intel === 'CONFLICT' ? 'INTEL !' : `INTEL ${token.intel || '✓'}`}
                                </span>
                                <span
                                  className={`micro-tag tag-risk risk-${String(token.risk || 'UNKNOWN').toLowerCase()}`}
                                  title={`Unified Risk: ${token.risk || 'UNKNOWN'}`}
                                >
                                  {token.risk || 'UNKNOWN'}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="table-links">
                              <a
                                href={`https://solscan.io/token/${row.mint}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Solscan"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ArrowUpRight size={11} />
                              </a>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && (
              <div className="empty-state">
                {market ? 'No rows available for this view.' : 'Connecting to live discovery…'}
              </div>
            )}
          </div>
        </section>

        <section className="panel live-analysis" aria-label="Level 3: Deep Diagnostics and Forensics">
          <div className="panel-heading">
            <h2>
              <ShieldCheck size={15} />
              LIQUIDITY & FORENSICS
            </h2>
            <span className="tier-section-badge tier-badge-l3">
              <Activity size={10} /> LEVEL 3 · FORENSICS
            </span>
          </div>

          {chosen ? (
            <div className="live-analysis-body">
              <h2>{chosen.symbol || chosen.name || 'Token'}</h2>
              <p>{chosen.name}</p>
              <code>{chosen.mint}</code>
              <div className="signal-grid">
                {[
                  ['Price', usd(chosen.price)],
                  ['Liquidity', usd(chosen.liquidity)],
                  ['24h volume', usd(chosen.volume)],
                ].map(([label, value]) => (
                  <div key={label}>
                    <small>{label}</small>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
              <div className="live-actions">
                <button
                  type="button"
                  onClick={inspect}
                  disabled={busy || !chosen}
                  title="Run deep safety forensics scan on token"
                >
                  <ShieldCheck size={14} />
                  {busy ? 'Scanning…' : 'Run safety scan'}
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={!chosen}
                  title={saved.includes(chosen.mint) ? 'Remove token from watchlist' : 'Add token to watchlist'}
                >
                  {saved.includes(chosen.mint) ? '★ Saved' : '☆ Save token'}
                </button>
              </div>
              <RiskDetails risk={risk} busy={busy} />
              <TokenIntelligenceInspector mint={chosen.mint} initialData={chosen} />
              <div className="research-dock">
                <div className="eyebrow">TOKEN RESEARCH</div>
                <div>
                  {links.map(([label, url]) => (
                    <a key={label} href={url} target="_blank" rel="noopener noreferrer">
                      {label}
                      <ArrowUpRight size={12} />
                    </a>
                  ))}
                </div>
              </div>
              <p className="live-note">
                Live token research above. The strategy engine below uses synthetic prices and a separate virtual portfolio.
              </p>
            </div>
          ) : (
            <div className="empty-state">
              <Activity size={24} />
              <strong>Select a live token</strong>
              <p>Inspect liquidity, price, provider safety checks, and wallet research.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
});
