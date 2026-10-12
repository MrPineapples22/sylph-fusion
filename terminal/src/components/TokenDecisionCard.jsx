import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Activity,
  Zap,
  TrendingUp,
  Clock,
  Coins,
  Users,
  Percent,
  Sliders,
  Fingerprint,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Database,
  Lock,
  Unlock,
  Radio,
  Globe,
  Search,
  Copy,
  Check,
} from 'lucide-react';

import { evaluateTokenDecision, calculateRunnerHazardState, MAX_PRICE_DRIFT_BPS, MAX_LIQUIDITY_DROP_BPS } from '../token-decision-eval.js';
import { VetoProofInspectorDrawer } from './VetoProofInspectorDrawer.jsx';

export function TokenDecisionCard({
  asset,
  candidate = null,
  driftTelemetry = null,
  solPriceUsd = null,
  rejectionReason = null,
  isEligible = false,
  eligibilityNotes = '',
  onInspectProvenance = null,
}) {
  const [showWhyPanel, setShowWhyPanel] = useState(false);
  const [showProofInspector, setShowProofInspector] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyMint = (e) => {
    e.stopPropagation();
    const mintToCopy = asset?.id || candidate?.mint || '';
    if (mintToCopy && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(mintToCopy).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }).catch(() => {});
    }
  };

  if (!asset || asset.id === 'loading') {
    return (
      <article className="token-decision-card empty-card" aria-label="Token decision card">
        <Activity size={20} className="animate-spin text-muted" />
        <p>Awaiting token selection or incoming candidate stream…</p>
      </article>
    );
  }

  const {
    realSolReserve,
    realReserveSource,
    virtualTokenReserve,
    isCurveKnown,
    isCurveComplete,
    driftPct,
    driftBps,
    driftSource,
    isDriftSafe,
    isExcessivePriceDrift,
    isExcessiveLiquidityDrop,
    actualBuyers,
    isDevSold,
    ageSeconds,
    ageDisplay,
    isMintRevoked,
    isFreezeRevoked,
    isReserveSufficient,
    isCurveActive,
    blocked,
    isTelemetryPending,
    decisionBadge,
    decisionTone,
    blockedExplanation,
    migrationState,
    executionRoute,
    isRaydiumActive,
    isSniperCooldown,
    isMigrationPending,
    medianObsGapSec,
    isHighVelocity,
    empiricalExitPolicy,
  } = evaluateTokenDecision({
    asset,
    candidate,
    driftTelemetry,
    solPriceUsd,
    rejectionReason,
    isEligible,
    eligibilityNotes,
  });

  const hazardInputs = {
    elapsedSeconds: typeof ageSeconds === 'number' ? ageSeconds : null,
    currentMultiple: candidate?.currentMultiple ?? asset?.currentMultiple ?? null,
    walletEntropy: candidate?.walletEntropy ?? asset?.walletEntropy ?? null,
    independentCapitalAcceleration: candidate?.independentCapitalAcceleration ?? asset?.independentCapitalAcceleration ?? null,
    realSolReserve,
    currentSellPressureRatio: candidate?.sellPressureRatio ?? asset?.sellPressureRatio ?? null,
    recentPriceVelocityBps: candidate?.recentPriceVelocityBps ?? asset?.recentPriceVelocityBps ?? null,
  };
  const hasRunnerHazardInputs = Object.values(hazardInputs).every(value => Number.isFinite(value));
  const runnerHazard = hasRunnerHazardInputs ? calculateRunnerHazardState(hazardInputs) : null;

  const reportedCrossValidationStatus = asset.crossValidationStatus || candidate?.crossValidationStatus;
  const rawStatus = typeof reportedCrossValidationStatus === 'string' ? reportedCrossValidationStatus.toUpperCase() : 'UNKNOWN';

  const crossValLookup = {
    VERIFIED: {
      label: 'CROSS-VALIDATED (MULTI-SOURCE)',
      shortLabel: 'VERIFIED',
      tone: 'crossval-verified',
      color: '#14F195',
      desc: 'The source reports a verified cross-validation state. Provider identity and comparison details are not included here.',
    },
    PARTIALLY_VERIFIED: {
      label: 'PARTIAL CROSS-CHECK',
      shortLabel: 'PARTIAL',
      tone: 'crossval-partial',
      color: '#38bdf8',
      desc: 'The source reports partial cross-validation. Provider identity and comparison details are not included here.',
    },
    SINGLE_SOURCE: {
      label: 'SINGLE SOURCE',
      shortLabel: 'SINGLE',
      tone: 'crossval-single',
      color: '#eab308',
      desc: 'The source reports one provider observation.',
    },
    STALE: {
      label: 'STALE TELEMETRY',
      shortLabel: 'STALE',
      tone: 'crossval-stale',
      color: '#f97316',
      desc: 'The source reports stale telemetry. The originating freshness threshold is unavailable here.',
    },
    CONFLICTING: {
      label: 'SOURCE CONFLICT',
      shortLabel: 'CONFLICT',
      tone: 'crossval-conflict',
      color: '#ef4444',
      desc: 'The source reports a conflict. Underlying provider observations are not included here.',
    },
    UNKNOWN: {
      label: 'AWAITING FEEDS',
      shortLabel: 'UNKNOWN',
      tone: 'crossval-unknown',
      color: '#94a3b8',
      desc: 'No cross-validation status was supplied.',
    },
  };
  const crossVal = crossValLookup[rawStatus] || crossValLookup.UNKNOWN;

  const canonicalMint = asset.id || candidate?.mint || '';
  const hasCanonicalMint = typeof canonicalMint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(canonicalMint);
  const suppliedDigest = asset.provenanceDigest || candidate?.provenanceDigest || null;
  const provenanceDigest = typeof suppliedDigest === 'string' && /^[a-f0-9]{64}$/i.test(suppliedDigest) ? suppliedDigest : null;

  const quality = asset.quality || candidate?.quality || 'UNKNOWN';
  const opportunity = asset.opportunity || candidate?.opportunity || 'UNKNOWN';
  const execution = asset.execution || candidate?.execution || 'UNKNOWN';
  const qualityVetoes = asset.qualityVetoes || candidate?.qualityVetoes || (blocked && !isTelemetryPending ? [blockedExplanation] : []);

  const suppliedTraceSteps = asset.decisionTrace || asset.decision?.trace || candidate?.decisionTrace;
  const traceSteps = Array.isArray(suppliedTraceSteps) ? suppliedTraceSteps : [];
  const devDisposition = typeof candidate?.devSold === 'boolean' ? candidate.devSold : typeof asset.devSold === 'boolean' ? asset.devSold : null;

  const safeExternalLinks = hasCanonicalMint ? [
    {
      name: 'DexScreener',
      url: `https://dexscreener.com/solana/${canonicalMint}`,
      category: 'Market & Liquidity',
      tag: 'Market lookup',
    },
    {
      name: 'RugCheck',
      url: `https://rugcheck.xyz/tokens/${canonicalMint}`,
      category: 'Security & Contracts',
      tag: 'Risk lookup',
    },
    {
      name: 'Jupiter Swap',
      url: `https://jup.ag/swap/SOL-${canonicalMint}`,
      category: 'Execution Routing',
      tag: 'Quotes',
    },
    {
      name: 'Solscan',
      url: `https://solscan.io/token/${canonicalMint}`,
      category: 'On-Chain Explorer',
      tag: 'Solana RPC',
    },
    {
      name: 'Pump.fun',
      url: `https://pump.fun/${canonicalMint}`,
      category: 'Launch Platform',
      tag: 'Bonding Curve',
    },
  ] : [];

  return (
    <article className="token-decision-card" aria-label={`Candidate forensics for ${asset.symbol}`}>
      {/* Header */}
      <header className="decision-header">
        <div className="decision-token-info">
          <span className="token-icon" style={{ '--token-color': asset.color || '#9945FF' }}>
            {asset.symbol?.[0] || '?'}
          </span>
          <div>
            <h3>
              {asset.symbol} <small>/ USDC</small>
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="token-address font-mono" title={asset.id}>
                {asset.id?.slice(0, 8)}…{asset.id?.slice(-6)}
              </span>
              <button
                type="button"
                className="btn-copy-mint p-0.5 rounded text-muted hover:text-white transition-colors"
                onClick={handleCopyMint}
                title={copied ? 'Copied mint address' : 'Copy canonical mint address'}
                aria-label="Copy mint address"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: '1px 3px' }}
              >
                {copied ? <Check size={11} className="text-[#14F195]" /> : <Copy size={11} />}
              </button>
            </div>
          </div>
        </div>

        {/* Verdict Pill, Route Badge, Cross-Val Pill & Provenance Action */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Multi-Source Cross-Validation Badge (Section 13) */}
          <span
            className={`crossval-badge font-mono ${crossVal.tone}`}
            title={`Source-reported cross-validation: ${crossVal.desc}`}
          >
            {rawStatus === 'VERIFIED' || rawStatus === 'PARTIALLY_VERIFIED' ? <ShieldCheck size={12} /> : rawStatus === 'CONFLICTING' ? <ShieldAlert size={12} /> : <HelpCircle size={12} />}
            <span>{crossVal.shortLabel}</span>
          </span>

          <span
            className={`route-badge font-mono ${executionRoute?.includes('JITO') ? 'route-jito' : ''}`}
            title={`SOLARIS execution route: ${executionRoute}`}
          >
            {executionRoute || 'UNKNOWN'}
          </span>
          {onInspectProvenance && hasCanonicalMint && (
            <button
              type="button"
              className="btn-provenance-trigger font-mono text-xs flex items-center gap-1"
              onClick={() => onInspectProvenance({ asset, candidate, rejectionReason })}
              title="Inspect point-in-time decision provenance, gate sequence, and cryptographic seal"
              aria-label="Inspect Decision Provenance"
            >
              <Fingerprint size={13} className="text-accent" />
              <span>Audit Provenance</span>
            </button>
          )}
          <div className={`decision-verdict ${decisionTone}`}>
            {blocked ? <XCircle size={15} /> : isTelemetryPending ? <Clock size={15} /> : <CheckCircle2 size={15} />}
            <b>{decisionBadge}</b>
          </div>
        </div>
      </header>

      {/* ── Tri-State Decision Triad Classification Bar ── */}
      <div className="decision-triad-bar font-mono" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        background: '#080C14',
        border: '1px solid #1E293B',
        borderRadius: '8px',
        padding: '8px 10px',
        margin: '2px 0 6px',
        textAlign: 'center',
      }}>
        <div style={{
          background: quality === 'PASS' ? 'rgba(20,241,149,0.06)' : quality === 'FAIL' ? 'rgba(255,59,105,0.06)' : 'rgba(245,158,11,0.06)',
          border: `1px solid ${quality === 'PASS' ? 'rgba(20,241,149,0.25)' : quality === 'FAIL' ? 'rgba(255,59,105,0.25)' : 'rgba(245,158,11,0.25)'}`,
          padding: '6px 4px',
          borderRadius: '6px',
          transition: 'all 0.2s ease',
        }}>
          <small style={{ display: 'block', fontSize: '9px', color: '#94A3B8', letterSpacing: '0.5px' }}>TOKEN QUALITY</small>
          <b style={{
            fontSize: '12px',
            color: quality === 'PASS' ? '#14F195' : quality === 'FAIL' ? '#FF3B69' : '#F59E0B',
          }}>
            {quality}
          </b>
          <span style={{ display: 'block', fontSize: '9px', color: '#64748B', marginTop: '2px' }}>
          {quality === 'PASS' ? 'Source reports pass' : quality === 'FAIL' ? (qualityVetoes[0] || 'Source reports fail') : 'Quality evidence unknown'}
          </span>
        </div>
        <div style={{
          background: opportunity === 'ELIGIBLE' ? 'rgba(20,241,149,0.06)' : opportunity === 'INELIGIBLE' ? 'rgba(255,59,105,0.06)' : 'rgba(245,158,11,0.06)',
          border: `1px solid ${opportunity === 'ELIGIBLE' ? 'rgba(20,241,149,0.25)' : opportunity === 'INELIGIBLE' ? 'rgba(255,59,105,0.25)' : 'rgba(245,158,11,0.25)'}`,
          padding: '6px 4px',
          borderRadius: '6px',
          transition: 'all 0.2s ease',
        }}>
          <small style={{ display: 'block', fontSize: '9px', color: '#94A3B8', letterSpacing: '0.5px' }}>ENTRY ELIGIBILITY</small>
          <b style={{
            fontSize: '12px',
            color: opportunity === 'ELIGIBLE' ? '#14F195' : opportunity === 'INELIGIBLE' ? '#FF3B69' : '#F59E0B',
          }}>
            {opportunity}
          </b>
          <span style={{ display: 'block', fontSize: '9px', color: '#64748B', marginTop: '2px' }}>
            {opportunity === 'ELIGIBLE' ? 'Source reports eligible' : opportunity === 'PENDING' ? (isMigrationPending ? 'DEX transition' : 'Awaiting data') : opportunity === 'INELIGIBLE' || opportunity === 'BLOCKED' ? 'Source reports blocked' : 'Eligibility unknown'}
          </span>
        </div>
        <div style={{
          background: execution === 'AVAILABLE' ? 'rgba(20,241,149,0.06)' : 'rgba(245,158,11,0.06)',
          border: `1px solid ${execution === 'AVAILABLE' ? 'rgba(20,241,149,0.25)' : 'rgba(245,158,11,0.25)'}`,
          padding: '6px 4px',
          borderRadius: '6px',
          transition: 'all 0.2s ease',
        }}>
          <small style={{ display: 'block', fontSize: '9px', color: '#94A3B8', letterSpacing: '0.5px' }}>EXECUTION AUTHORITY</small>
          <b style={{
            fontSize: '12px',
            color: execution === 'AVAILABLE' ? '#14F195' : '#F59E0B',
          }}>
            {execution}
          </b>
          <span style={{ display: 'block', fontSize: '9px', color: '#64748B', marginTop: '2px' }}>
            {execution === 'AVAILABLE' ? 'Source reports available' : execution === 'BLOCKED' ? 'Source reports blocked' : 'Authority unknown'}
          </span>
        </div>
      </div>

      {/* Decision Summary Reason Banner */}
      <div className={`decision-reason-banner ${blocked ? 'reason-blocked' : isTelemetryPending ? 'reason-pending' : 'reason-eligible'}`}>
        {blocked ? <AlertTriangle size={15} /> : isTelemetryPending ? <Clock size={15} /> : <ShieldCheck size={15} />}
        <div>
          <b>{quality === 'FAIL' ? 'Source-reported quality failure' : blocked ? 'Local token check blocked' : isTelemetryPending ? 'Candidate telemetry pending' : 'Configured local checks passed'}</b>
          <p>{blockedExplanation}</p>
        </div>
      </div>

      {/* SPIE Profit Intelligence Strip */}
      <div className="spie-profit-strip font-mono flex items-center justify-between p-2 my-2 rounded border border-[#233142] bg-[#0d131a] text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-muted">
            <Zap size={13} />
            <span className="text-muted text-[10px]">NET EV:</span>
            <b>{asset.spieNetEv ?? asset.netEdge ?? 'UNKNOWN'}</b>
          </div>
          <div className="flex items-center gap-1 text-[#38bdf8]">
            <Activity size={13} />
            <span className="text-muted text-[10px]">FRICTION:</span>
            <b>{Number.isFinite(asset.frictionRatio) ? `${(asset.frictionRatio * 100).toFixed(1)}%` : 'UNKNOWN'}</b>
          </div>
          <div className="flex items-center gap-1 text-[#f59e0b]">
            <TrendingUp size={13} />
            <span className="text-muted text-[10px]">STAGE:</span>
            <b>{asset.opportunityStage || 'UNKNOWN'}</b>
          </div>
        </div>
        <div className="flex items-center gap-2 text-muted text-[11px]">
          <span className="text-accent">Dominant:</span>
          <span>{asset.dominantFactor ? asset.dominantFactor.toUpperCase() : 'UNKNOWN'}</span>
        </div>
      </div>

      {/* Forensics Grid */}
      <div className="decision-metric-grid">
        {/* Real & Virtual Reserves & Curve State */}
        <div className="forensic-card">
          <div className="forensic-label">
            <Coins size={13} />
            <span>Reserves &amp; Curve State</span>
          </div>
          <div className="forensic-value font-mono">
            {realSolReserve != null ? (
              <>
                <b>{realSolReserve.toFixed(2)} SOL</b>
                <small>{realReserveSource}</small>
              </>
            ) : (
              <>
                <b className="text-muted">Awaiting snapshot</b>
                <small>telemetry pending</small>
              </>
            )}
          </div>
          <span className={`curve-status-tag font-mono ${isRaydiumActive ? 'status-active' : isSniperCooldown ? 'status-pending' : isCurveComplete ? 'status-migrated' : isCurveKnown ? 'status-active' : 'status-pending'}`}>
            {isRaydiumActive ? `${String(candidate?.dex || asset.dex || 'AMM').toUpperCase()} POOL OBSERVED` : isSniperCooldown ? 'AMM SNIPER COOLDOWN (30s)' : isCurveComplete ? 'CURVE COMPLETED / MIGRATED' : isCurveKnown ? 'ACTIVE BONDING CURVE' : 'AWAITING CURVE TELEMETRY'}
          </span>
          <span className="forensic-subtext font-mono">
            {virtualTokenReserve != null
              ? `Virtual tokens: ${virtualTokenReserve.toLocaleString()}`
              : isRaydiumActive
              ? 'AMM pool reported; route quote unavailable'
              : isCurveComplete
              ? 'Virtual tokens: Migrated to AMM'
              : 'Virtual tokens: Awaiting snapshot'}
          </span>
        </div>

        {/* Dual-Metric Reserve Drift */}
        <div className="forensic-card">
          <div className="forensic-label">
            <Sliders size={13} />
            <span>Dual-Metric Reserve Drift</span>
          </div>
          <div className="forensic-value font-mono">
            {driftPct != null ? (
              <>
                <b className={isDriftSafe ? 'positive' : 'negative'}>
                  {driftPct >= 0 ? '+' : ''}{driftPct.toFixed(2)}% ({driftBps >= 0 ? '+' : ''}{driftBps} BPS)
                </b>
                <small>{driftSource}</small>
              </>
            ) : (
              <>
                <b className="text-muted">Awaiting 2nd snapshot</b>
                <small>telemetry pending</small>
              </>
            )}
          </div>
          <span className="forensic-subtext font-mono">
            {driftPct != null
              ? (isDriftSafe
                  ? 'Passed dual bounds (≤ +200 BPS / ≥ -200 BPS)'
                  : isExcessivePriceDrift
                  ? 'EXCESSIVE_PRICE_DRIFT (> +200 BPS)'
                  : 'EXCESSIVE_LIQUIDITY_DROP (< -200 BPS)')
              : 'Threshold: ≤ +200 BPS price / ≥ -200 BPS drop (pending)'}
          </span>
        </div>

        {/* Buyer Forensics & Dev Sell */}
        <div className="forensic-card">
          <div className="forensic-label">
            <Users size={13} />
            <span>Buyer Forensics</span>
          </div>
          <div className="forensic-value font-mono">
            {actualBuyers != null ? (
              <>
                <b>{actualBuyers}</b>
                <small>unique buyers</small>
              </>
            ) : (
              <>
                <b className="text-muted">Unindexed</b>
                <small>awaiting stream</small>
              </>
            )}
          </div>
          <span className="forensic-subtext font-mono">
            {isDevSold ? (
              <span className="negative font-mono">DEV DUMP DETECTED</span>
            ) : asset.velocity != null ? (
              `Velocity: ${asset.velocity > 0 ? '+' : ''}${asset.velocity.toFixed(2)}% / s`
            ) : (
              devDisposition === false ? 'Source reports no creator sale' : 'Creator disposition unknown'
            )}
          </span>
        </div>

        {/* Token Age */}
        <div className="forensic-card">
          <div className="forensic-label">
            <Clock size={13} />
            <span>Token Age</span>
          </div>
          <div className="forensic-value font-mono">
            <b>{ageDisplay}</b>
            <small>observed duration</small>
          </div>
          <span className="forensic-subtext font-mono">
            {candidate ? 'Live engine candidate' : 'Observed market token'}
          </span>
        </div>
      </div>

      {/* Safety Checklist Row */}
      <div className="safety-checklist" aria-label="Pre-trade security verification">
        <span className="eyebrow">PRE-TRADE SAFETY VERIFICATION</span>
        <div className="checklist-items">
          <span className={`check-chip ${isRaydiumActive ? 'chip-pass' : isCurveActive ? 'chip-pass' : isCurveActive === false ? 'chip-fail' : 'chip-pending'}`}>
            {isRaydiumActive ? <CheckCircle2 size={12} /> : isCurveActive ? <CheckCircle2 size={12} /> : isCurveActive === false ? <XCircle size={12} /> : <Clock size={12} />}
            {isRaydiumActive ? 'Reported AMM pool active' : isCurveActive ? 'Curve Active' : isCurveActive === false ? (isSniperCooldown ? 'Sniper Cooldown (30s)' : 'Curve Complete; venue pending') : 'Curve Telemetry Pending'}
          </span>
          <span className={`check-chip ${isMintRevoked === null ? 'chip-pending' : isMintRevoked ? 'chip-pass' : 'chip-fail'}`}>
            {isMintRevoked === null ? <Clock size={12} /> : isMintRevoked ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {isMintRevoked === null ? 'Mint Auth UNKNOWN' : isMintRevoked ? 'Mint Auth Revoked' : 'Mint Auth Active'}
          </span>
          <span className={`check-chip ${isFreezeRevoked === null ? 'chip-pending' : isFreezeRevoked ? 'chip-pass' : 'chip-fail'}`}>
            {isFreezeRevoked === null ? <Clock size={12} /> : isFreezeRevoked ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {isFreezeRevoked === null ? 'Freeze Auth UNKNOWN' : isFreezeRevoked ? 'Freeze Auth Revoked' : 'Freeze Auth Active'}
          </span>
          <span className={`check-chip ${isReserveSufficient ? 'chip-pass' : isReserveSufficient === false ? 'chip-fail' : 'chip-pending'}`}>
            {isReserveSufficient ? <CheckCircle2 size={12} /> : isReserveSufficient === false ? <XCircle size={12} /> : <Clock size={12} />}
            {isReserveSufficient ? '≥ 1.0 SOL Real Reserve' : isReserveSufficient === false ? '< 1.0 SOL Floor' : 'Reserve Snapshot Pending'}
          </span>
          <span className={`check-chip ${driftPct != null ? (isDriftSafe ? 'chip-pass' : 'chip-fail') : 'chip-pending'}`}>
            {driftPct != null ? (isDriftSafe ? <CheckCircle2 size={12} /> : <XCircle size={12} />) : <Clock size={12} />}
            {driftPct != null ? (isDriftSafe ? 'Drift ≤ 200 BPS (±2.0%)' : 'Drift Breached') : 'Drift Pending (dual snapshot required)'}
          </span>
          <span className={`check-chip ${medianObsGapSec != null ? (isHighVelocity ? 'chip-pass' : 'chip-fail') : 'chip-pending'}`}>
            {medianObsGapSec != null ? (isHighVelocity ? <CheckCircle2 size={12} /> : <XCircle size={12} />) : <Clock size={12} />}
            {medianObsGapSec != null ? (isHighVelocity ? `Flow Gap ≤ 1.0s (${medianObsGapSec.toFixed(2)}s)` : `Low Velocity (${medianObsGapSec.toFixed(2)}s > 1.0s)`) : 'Flow Gap Pending (≤1.0s)'}
          </span>
        </div>
        {/* Source-supplied exit policy and fully-inputted research hazard estimate */}
        <div className="empirical-exit-contract font-mono text-[10px] text-muted flex items-center justify-between mt-2 pt-2 border-t border-[#1e293b] flex-wrap gap-2">
          <span className="text-[#38bdf8] flex items-center gap-1 font-semibold">
            <Zap size={11} /> EXIT POLICY: {empiricalExitPolicy?.id || 'UNKNOWN'}
          </span>
          <span className="text-[#94a3b8] flex items-center gap-2">
            <span>Break-even: {Number.isFinite(empiricalExitPolicy?.breakevenGainThresholdPct) ? `${empiricalExitPolicy.breakevenGainThresholdPct}%` : 'Unknown'} · Trail: {Number.isFinite(empiricalExitPolicy?.trailStopBps) ? `${(empiricalExitPolicy.trailStopBps / 100).toFixed(1)}%` : 'Unknown'}</span>
            {runnerHazard ? <span style={{ color: runnerHazard.netConvexHazardRatio >= 1.5 ? '#14F195' : runnerHazard.netConvexHazardRatio >= 0.5 ? '#38BDF8' : '#FF3B69', fontWeight: 600 }}>
              Research hazard ratio: {runnerHazard.netConvexHazardRatio.toFixed(2)}x ({runnerHazard.recommendedAction})
            </span> : <span>Research hazard: Unknown · required inputs unavailable</span>}
          </span>
        </div>
      </div>

      {/* WHY? Deep Investigation & Source Intelligence Drawer (Sections 26, 27, 35) */}
      <div className="why-investigation-wrapper">
        <button
          type="button"
          className="why-drawer-toggle font-mono flex items-center justify-between w-full"
          onClick={() => setShowWhyPanel(prev => !prev)}
          aria-expanded={showWhyPanel}
        >
          <div className="flex items-center gap-2">
            <HelpCircle size={14} className="text-[#38bdf8]" />
            <b className="text-[#F3F4F6] text-xs tracking-wider">WHY? DECISION FORENSICS &amp; SOURCE INTELLIGENCE</b>
            <span className="why-badge font-mono">SECTIONS 26 &amp; 35</span>
          </div>
          <div className="flex items-center gap-1 text-muted text-xs">
            <span>{showWhyPanel ? 'Hide Deep Forensics' : 'Inspect Lifecycle, Cross-Validation & External Evidence'}</span>
            {showWhyPanel ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </div>
        </button>

        {showWhyPanel && (
          <div className="why-investigation-panel">
            {/* Section 0: Source-reported decision trace */}
            <div className="why-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <span className="why-section-title">
                  <Sliders size={13} className="text-[#14F195]" />
                    <span>SOURCE-REPORTED DECISION TRACE</span>
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="font-mono text-[10px]" style={{ color: '#64748B' }}>
                    VETO !== UNKNOWN · VETO !== PENDING · VETO !== BLOCKED
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowProofInspector(true)}
                    disabled={!hasCanonicalMint}
                    style={{
                      background: 'rgba(20, 241, 149, 0.1)',
                      border: '1px solid rgba(20, 241, 149, 0.3)',
                      color: '#14F195',
                      fontSize: '10px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    🔬 Inspect Proof
                  </button>
                </div>
              </div>
              <div className="why-trace-table-wrap">
                <table className="why-trace-table">
                  <thead>
                    <tr>
                      <th>Stage</th>
                      <th>Status</th>
                      <th>Observed</th>
                      <th>Meaning</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traceSteps.length === 0 && <tr><td colSpan={4} style={{padding:'10px 8px', color:'#94A3B8'}}>No decision trace was supplied for this observation.</td></tr>}
                    {traceSteps.map((step, idx) => {
                      const isPass = step.status === 'PASS';
                      const isFail = step.status === 'FAIL';
                      const isBlock = step.status === 'BLOCKED';
                      const color = isPass ? '#14F195' : isFail ? '#FF3B69' : isBlock ? '#FF7595' : '#F59E0B';
                      const bg = isPass ? 'rgba(20,241,149,0.12)' : isFail ? 'rgba(255,59,105,0.12)' : isBlock ? 'rgba(255,59,105,0.1)' : 'rgba(245,158,11,0.12)';
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '5px 8px', fontWeight: 600, color: '#F1F5F9', whiteSpace: 'nowrap' }}>{step.label || step.stage}</td>
                          <td style={{ padding: '5px 8px' }}>
                            <span style={{ fontSize: '9px', fontWeight: 700, padding: '2px 5px', borderRadius: '3px', background: bg, color }}>
                              {step.status}
                            </span>
                          </td>
                          <td style={{ padding: '5px 8px', fontFamily: 'monospace', color: '#CBD5E1', fontSize: '10px' }}>{step.observed ?? '—'}</td>
                          <td style={{ padding: '5px 8px', color: '#94A3B8', fontSize: '10px' }}>{step.meaning}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Section 1: Decision Explanations (Section 35) */}
            <div className="why-section">
              <span className="why-section-title">
                <ShieldAlert size={13} className="text-accent" />
                <span>DECISION LIFECYCLE &amp; REASONING (SECTION 35)</span>
              </span>
              <div className="why-reasons-grid font-mono">
                <div className="why-reason-item">
                  <span className="reason-tag tag-discovered">WHY DISCOVERED</span>
                  <p>
                    {asset.source || candidate?.sourceObservation?.provider || candidate?.source || 'Discovery source was not supplied with this record.'}
                  </p>
                </div>
                <div className="why-reason-item">
                  <span className={`reason-tag ${blocked ? 'tag-blocked' : 'tag-qualified'}`}>
                    {blocked ? 'WHY BLOCKED' : isTelemetryPending ? 'EVIDENCE PENDING' : 'SOURCE EXPLANATION'}
                  </span>
                  <p>
                    {blocked
                      ? `BLOCKED: ${blockedExplanation}`
                      : isTelemetryPending
                        ? `PENDING: ${blockedExplanation}`
                        : eligibilityNotes || 'No source-provided qualification explanation is available.'}
                  </p>
                </div>
                <div className="why-reason-item">
                  <span className={`reason-tag ${blocked ? 'tag-denied' : 'tag-allowed'}`}>
                    {blocked ? 'WHY TRADE DENIED' : 'SIMULATION ELIGIBILITY'}
                  </span>
                  <p>
                    {blocked
                      ? 'TRADE DENIED: Safety gates intercepted candidate before execution authorization.'
                      : `SIMULATION ONLY: Reported net EV (${asset.spieNetEv ?? 'UNKNOWN'}), friction ratio ${Number.isFinite(asset.frictionRatio) ? (asset.frictionRatio * 100).toFixed(1) + '%' : 'UNKNOWN'} ; live execution authorization unavailable.`}
                  </p>
                </div>
                <div className="why-reason-item">
                  <span className="reason-tag tag-protected">WHY PROTECTED</span>
                  <p>
                    Protection status requires an active position and verified exit-controller evidence. No live protection is established by this candidate view.
                  </p>
                </div>
              </div>
            </div>

            {/* Section 2: Multi-Source Cross-Validation Matrix (Sections 12 & 13) */}
            <div className="why-section">
                  <span className="why-section-title">
                <Database size={13} className="text-[#14F195]" />
                <span>AVAILABLE SOURCE DETAILS</span>
              </span>
              <div className="crossval-matrix font-mono">
                <div className="matrix-row header">
                  <span>FIELD</span>
                  <span>REPORTED VALUE</span>
                  <span>FIELD</span>
                  <span>REPORTED VALUE</span>
                </div>
                <div className="matrix-row">
                  <span className="provider-name">Input source</span>
                  <span>{asset.source || asset.provider || candidate?.sourceObservation?.provider || candidate?.source || 'Unknown'}</span>
                  <span className="provider-name">Cross-validation</span>
                  <span>{reportedCrossValidationStatus || 'Unknown'}</span>
                </div>
                <div className="matrix-row">
                  <span className="provider-name">Market price</span>
                  <span>{Number.isFinite(asset.price) ? `$${asset.price}` : 'Unknown'}</span>
                  <span className="provider-name">Candidate slot</span>
                  <span>{Number.isSafeInteger(candidate?.slot) ? candidate.slot : 'Unknown'}</span>
                </div>
                <div className="matrix-row">
                  <span className="provider-name">Transaction identity</span>
                  <span>{candidate?.eventSignature || candidate?.signature || 'Unknown'}</span>
                  <span className="provider-name">Recorded route</span>
                  <span>{executionRoute || 'Unknown'}</span>
                </div>
              </div>
              <p className="text-muted text-[10px] mt-2">Provider health, comparison latency, contract-scan results, and route quotes are not attached to this token record unless shown above.</p>
              <div className="provenance-digest-row font-mono text-[11px] text-muted flex items-center justify-between mt-2 pt-2 border-t border-[#1f2937]">
                <span>Supplied provenance digest: <code className="text-[#38bdf8]">{provenanceDigest || 'Unknown'}</code></span>
                <span>Status: {crossVal.label}</span>
              </div>
            </div>

            {/* Section 3: Threat & Manipulation Forensics (Sections 6 & 8) */}
            <div className="why-section">
              <span className="why-section-title">
                <Lock size={13} className="text-[#f59e0b]" />
                <span>THREAT &amp; MANIPULATION FORENSICS (SECTIONS 6 &amp; 8)</span>
              </span>
              <div className="threat-grid font-mono">
                <div className="threat-item">
                  <span className="threat-label">Bundler evidence:</span>
                  <span className="threat-val">{asset.bundlerStatus || candidate?.bundlerStatus || 'Unknown'}</span>
                </div>
                <div className="threat-item">
                  <span className="threat-label">Wash-Trading / Velocity:</span>
                  <span className="threat-val text-[#38bdf8]">
                    {Number.isFinite(asset.velocity) ? `${asset.velocity.toFixed(2)}% / s` : 'Velocity unknown'} · {actualBuyers ?? 'Unknown'} reported buyers
                  </span>
                </div>
                <div className="threat-item">
                  <span className="threat-label">Dev Concentration:</span>
                  <span className={`threat-val ${isDevSold ? 'text-[#FF3B69]' : 'text-[#14F195]'}`}>
                    {devDisposition === true ? 'Creator sale reported' : devDisposition === false ? 'Source reports no creator sale' : 'Creator disposition unknown'} · holder concentration {typeof (candidate?.holderConcentrationSuspect ?? asset?.holderConcentrationSuspect) === 'boolean' ? (candidate?.holderConcentrationSuspect ?? asset?.holderConcentrationSuspect) ? 'flagged' : 'not flagged by source' : 'unknown'}
                  </span>
                </div>
                <div className="threat-item">
                  <span className="threat-label">Authority Revocation:</span>
                  <span className="threat-val text-[#14F195]">
                    Mint Revoked: {isMintRevoked === null ? 'UNKNOWN' : isMintRevoked ? 'YES' : 'NO'} · Freeze Revoked: {isFreezeRevoked === null ? 'UNKNOWN' : isFreezeRevoked ? 'YES' : 'NO'}
                  </span>
                </div>
              </div>
            </div>

            {/* Section 4: Safe External Intelligence Links (Section 27) */}
            <div className="why-section">
                <span className="why-section-title">
                <Globe size={13} className="text-[#38bdf8]" />
                <span>EXTERNAL TOKEN RESEARCH LINKS</span>
              </span>
              <p className="text-muted text-[11px] mb-2">
                {safeExternalLinks.length ? <>Open these services for mint <code>{canonicalMint}</code>; their contents are external and are not verified by this panel.</> : 'A valid mint address is required before external lookup links can be shown.'}
              </p>
              <div className="safe-links-grid font-mono">
                {safeExternalLinks.map(link => (
                  <a
                    key={link.name}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="safe-link-chip"
                    title={`Open ${link.name} for ${asset.symbol} in new tab`}
                  >
                    <div className="flex items-center gap-1.5">
                      <ExternalLink size={12} className="text-[#38bdf8]" />
                      <b>{link.name}</b>
                    </div>
                    <span className="link-tag">{link.tag}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <VetoProofInspectorDrawer
        isOpen={showProofInspector}
        onClose={() => setShowProofInspector(false)}
        token={{ mint: canonicalMint, symbol: asset.symbol || candidate?.symbol }}
      />
    </article>
  );
}

export default TokenDecisionCard;
