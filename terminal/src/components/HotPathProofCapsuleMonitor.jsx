import React, { useState, useEffect } from 'react';
import {
  X,
  Zap,
  ShieldAlert,
  ShieldCheck,
  Clock,
  Database,
  RefreshCw,
  Lock,
  Layers,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { formatNumber } from '../design-system/format.js';

export const FEATURE_LEASE_DEFINITIONS = [
  { id: 'QUICK_QUOTE', label: 'Quick Quote', defaultTtlMs: 1200, icon: Zap, desc: 'Executable pool quote' },
  { id: 'PRIORITY_FEE', label: 'Priority Fee', defaultTtlMs: 2000, icon: Clock, desc: 'CU percentile estimate' },
  { id: 'BLOCKHASH', label: 'Recent Blockhash', defaultTtlMs: 20000, icon: Clock, desc: 'Validator block commit' },
  { id: 'POOL_RESERVES', label: 'Pool Reserves', defaultTtlMs: 5000, icon: Database, desc: 'Virtual/real quote reserves' },
  { id: 'RISK_CERTIFICATE', label: 'Risk Certificate', defaultTtlMs: 30000, icon: ShieldCheck, desc: 'Anti-sniper & asymmetry gate' },
  { id: 'PROVIDER_HEALTH', label: 'Provider Health', defaultTtlMs: 10000, icon: Layers, desc: 'RPC circuit & latency health' },
  { id: 'HOLDER_CONCENTRATION', label: 'Holder State', defaultTtlMs: 300000, icon: Database, desc: 'Top-10 holder & Sybil graph' },
  { id: 'MINT_AUTHORITY', label: 'Token Semantics', defaultTtlMs: 3600000, icon: Lock, desc: 'Mint/freeze authority revoked' },
];

export function HotPathProofCapsuleMonitor({ isOpen, onClose, selectedMint = null, initialData = null }) {
  const [capsuleData, setCapsuleData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const fetchCapsuleStatus = async () => {
    if (typeof fetch === 'undefined') return;
    setLoading(true);
    try {
      const url = selectedMint ? `/api/capsule/status?mint=${encodeURIComponent(selectedMint)}` : '/api/capsule/status';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setCapsuleData(data);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCapsuleStatus();
      const fetchInterval = setInterval(fetchCapsuleStatus, 3000);
      const clockInterval = setInterval(() => setNowMs(Date.now()), 200);
      return () => {
        clearInterval(fetchInterval);
        clearInterval(clockInterval);
      };
    }
  }, [isOpen, selectedMint]);

  if (!isOpen) return null;

  const leases = capsuleData?.leases || [];
  const isReady = capsuleData?.isReady === true;
  const expiredCount = Number.isSafeInteger(capsuleData?.expiredCount) ? capsuleData.expiredCount : null;
  const hasCapsule = Boolean(capsuleData?.capsuleHash);

  return (
    <div className="sb-drawer-overlay" onClick={onClose}>
      <aside
        className="sb-drawer-content"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sb-capsule-title"
      >
        <header className="sb-drawer-header">
          <div className="sb-drawer-header-title">
            <span className="font-mono text-xs text-muted" style={{ color: '#14F195', fontWeight: 600 }}>
              FEATURE-SPECIFIC EVIDENCE LEASES (HOT-PATH PROOF CAPSULE)
            </span>
            <h2 id="sb-capsule-title">
              <Zap size={20} style={{ color: '#14F195' }} />
              Proof Capsule Lease Monitor
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              className="op-button"
              onClick={fetchCapsuleStatus}
              disabled={loading}
              title="Refresh capsule leases"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              className="op-button"
              onClick={onClose}
              aria-label="Close Proof Capsule Monitor"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="sb-drawer-body">
          {/* Readiness Status Header */}
          <div
            className="sb-glass-card"
            style={{
                  borderLeft: `4px solid ${isReady ? '#14F195' : '#F59E0B'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
            }}
          >
            <div>
              <span className="font-mono text-xs text-muted" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                HOT-PATH PREFLIGHT READINESS
              </span>
              <h3 style={{ margin: '2px 0', fontSize: '1.2rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isReady ? (
                  <span style={{ color: '#14F195', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle2 size={18} /> CAPSULE LEASES CURRENT
                  </span>
                ) : !hasCapsule ? (
                  <span style={{ color: '#F59E0B', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={18} /> CAPSULE EVIDENCE UNAVAILABLE
                  </span>
                ) : (
                  <span style={{ color: '#FF3B69', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <AlertTriangle size={18} /> STALE OR MISSING EVIDENCE LEASES
                  </span>
                )}
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#98aabd' }}>
                Capsule Mint: {capsuleData?.mint || selectedMint || 'Unknown'} · Assembled at: {capsuleData?.assembledAt ? new Date(capsuleData.assembledAt).toLocaleTimeString() : 'Unknown'}
              </p>
            </div>

            <div style={{ textAlign: 'right' }}>
              <span
                className="font-mono text-xs"
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontWeight: 700,
                  background: isReady ? 'rgba(20, 241, 149, 0.15)' : !hasCapsule ? 'rgba(245, 158, 11, 0.15)' : 'rgba(255, 59, 105, 0.15)',
                  color: isReady ? '#14F195' : !hasCapsule ? '#F59E0B' : '#FF3B69',
                  border: '1px solid currentColor',
                }}
              >
                {isReady ? `${leases.length} LEASES CURRENT` : !hasCapsule ? 'UNKNOWN' : expiredCount === null ? 'LEASE STATE UNKNOWN' : `${expiredCount} LEASES STALE`}
              </span>
              <div style={{ marginTop: '4px', fontSize: '0.75rem', color: '#98aabd', fontFamily: 'var(--font-mono, monospace)' }}>
                Capsule Hash: {capsuleData?.capsuleHash ? `${capsuleData.capsuleHash.slice(0, 16)}…` : 'Unavailable'}
              </div>
            </div>
          </div>

          {/* Epistemic Invariants Callout */}
          <div className="sb-glass-card" style={{ padding: '0.85rem 1rem', borderLeft: '3px solid #F59E0B' }}>
            <b style={{ fontSize: '0.8rem', color: '#F59E0B' }}>Blueprint Section 11 &amp; 12 Invariants:</b>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.75rem', color: '#becad6', lineHeight: 1.5 }}>
              The configured design uses feature-specific leases and treats expired evidence as <code>UNKNOWN</code>. This monitor does not establish that the live candidate path consumes those leases or avoids network lookups.
            </p>
          </div>

          {/* Feature Leases Matrix */}
          <div>
            <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Clock size={15} color="#9bcbff" />
              Active Feature-Specific Evidence Leases (TTLs)
            </h4>

            <div className="sb-lease-grid">
              {leases.length > 0 ? leases.map(lease => {
                const totalTtl = lease.ttlMs || 1000;
                const remainingMs = Number.isFinite(lease.expiresAtMs) ? Math.max(0, lease.expiresAtMs - nowMs) : 0;
                const pctRemaining = Math.min(100, Math.max(0, (remainingMs / totalTtl) * 100));
                const isExpired = remainingMs <= 0 || !lease.isAvailable;
                const isExpiring = !isExpired && pctRemaining < 25;
                const statusClass = isExpired ? 'expired' : isExpiring ? 'expiring' : 'valid';

                return (
                  <div key={lease.featureClass} className={`sb-lease-card ${statusClass}`}>
                    <div className="sb-lease-header">
                      <span className="sb-lease-title">{lease.label || lease.featureClass}</span>
                      <span
                        className="font-mono text-xs"
                        style={{
                          fontWeight: 700,
                          color: isExpired ? '#FF3B69' : isExpiring ? '#F59E0B' : '#14F195',
                        }}
                      >
                        {isExpired ? 'EXPIRED' : `${(remainingMs / 1000).toFixed(1)}s`}
                      </span>
                    </div>

                    <div className="sb-lease-progress">
                      <div
                        className="sb-lease-bar"
                        style={{
                          width: `${pctRemaining}%`,
                          background: isExpired ? '#FF3B69' : isExpiring ? '#F59E0B' : '#14F195',
                        }}
                      />
                    </div>

                    <div style={{ fontSize: '0.7rem', color: '#becad6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {lease.value ? (typeof lease.value === 'object' ? JSON.stringify(lease.value) : String(lease.value)) : 'UNKNOWN'}
                    </div>

                    <div className="sb-lease-footer">
                      <span>TTL: {totalTtl >= 1000 ? `${totalTtl / 1000}s` : `${totalTtl}ms`}</span>
                      <span>{lease.source || 'cache'}</span>
                    </div>
                  </div>
                );
              }) : <div className="op-empty">No source-bound capsule leases are available for this candidate.</div>}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default HotPathProofCapsuleMonitor;
