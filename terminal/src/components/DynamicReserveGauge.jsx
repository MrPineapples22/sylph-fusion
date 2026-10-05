import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Wallet,
  AlertTriangle,
  RefreshCw,
  Zap,
  Info
} from 'lucide-react';
import { formatMoney, formatNumber } from '../design-system/format.js';

export function DynamicReserveGauge({ capital = null, solPriceUsd = 150, initialData = null }) {
  const [reserveData, setReserveData] = useState(initialData);
  const [stressCongestion, setStressCongestion] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchReserveData = async () => {
    if (typeof fetch === 'undefined') return;
    setLoading(true);
    try {
      const res = await fetch(`/api/capital/reserve?stressed=${stressCongestion ? 'true' : 'false'}`);
      if (res.ok) {
        const json = await res.json();
        setReserveData(json);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReserveData();
    const interval = setInterval(fetchReserveData, 4000);
    return () => clearInterval(interval);
  }, [stressCongestion]);

  // Derived capital balances
  // The endpoint is a separate in-memory paper policy model, not wallet or portfolio authority.
  const totalCashUsd = Number.isFinite(reserveData?.paperCashUsd) ? reserveData.paperCashUsd : null;
  const reservedUsd = Number.isFinite(reserveData?.reservedCashUsd) ? reserveData.reservedCashUsd : null;
  const emergencyReserveUsd = Number.isFinite(reserveData?.emergencyReserveUsd) ? reserveData.emergencyReserveUsd : null;
  const freeDeployableCashUsd = Number.isFinite(reserveData?.availableCashUsd) ? reserveData.availableCashUsd : null;
  const hasModelData = [totalCashUsd, reservedUsd, emergencyReserveUsd, freeDeployableCashUsd].every(Number.isFinite);

  // Percentages for stacked bar
  const total = Math.max(totalCashUsd ?? 0, 1);
  const freePct = hasModelData ? (freeDeployableCashUsd / total) * 100 : 0;
  const reservedPct = hasModelData ? (reservedUsd / total) * 100 : 0;
  const reservePct = hasModelData ? (emergencyReserveUsd / total) * 100 : 0;

  const isWarning = hasModelData && freeDeployableCashUsd > 0;
  const isFloorLatched = hasModelData && freeDeployableCashUsd <= 0;

  return (
    <article className="sb-glass-card" style={{ padding: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <div>
          <span className="font-mono text-xs text-muted" style={{ color: '#14F195', fontWeight: 600 }}>
            PAPER POLICY SCENARIO · ASSUMED SOL/USD CONVERSION
          </span>
          <h3 style={{ margin: '2px 0', fontSize: '1.15rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Wallet size={18} style={{ color: '#14F195' }} />
            Capital Preservation &amp; Exitability Shield
          </h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#98aabd' }}>
            Displays the isolated paper reserve calculation. It does not prove wallet balances, executable liquidity, or guaranteed exit capacity.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            className="op-button"
            style={{
              fontSize: '11px',
              padding: '3px 8px',
              background: stressCongestion ? 'rgba(255, 59, 105, 0.15)' : 'rgba(255, 255, 255, 0.05)',
              borderColor: stressCongestion ? '#FF3B69' : 'rgba(255, 255, 255, 0.15)',
              color: stressCongestion ? '#FF3B69' : '#becad6',
            }}
            onClick={() => setStressCongestion(v => !v)}
            title="Toggle stressed network gas conditions"
          >
            <Zap size={12} /> {stressCongestion ? 'Gas Stressed (0.05 SOL)' : 'Normal Gas (0.025 SOL)'}
          </button>

          <span
            className="font-mono text-xs"
            style={{
              padding: '4px 8px',
              borderRadius: '4px',
              fontWeight: 700,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              background: !hasModelData ? 'rgba(255,255,255,0.08)' : isFloorLatched ? 'rgba(255, 59, 105, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: !hasModelData ? '#becad6' : isFloorLatched ? '#FF3B69' : '#F59E0B',
              border: '1px solid currentColor',
            }}
          >
            {!hasModelData ? <Info size={12} /> : isFloorLatched ? <Lock size={12} /> : isWarning ? <AlertTriangle size={12} /> : <Lock size={12} />}
            {!hasModelData ? 'MODEL DATA UNKNOWN' : isFloorLatched ? 'PAPER MODEL: NO HEADROOM' : isWarning ? 'PAPER MODEL: HEADROOM' : 'PAPER MODEL: NO HEADROOM'}
          </span>
        </div>
      </header>

      {/* Stacked Balance Bar */}
      <div className="sb-reserve-gauge">
        <div className="sb-reserve-stacked-bar">
          <div
            className="sb-reserve-segment"
            style={{ width: `${freePct}%`, background: '#14F195' }}
            title={`Free Deployable: ${formatMoney(freeDeployableCashUsd)}`}
          />
          <div
            className="sb-reserve-segment"
            style={{ width: `${reservedPct}%`, background: '#9bcbff' }}
            title={`Active Orders Hold: ${formatMoney(reservedUsd)}`}
          />
          <div
            className="sb-reserve-segment"
            style={{ width: `${reservePct}%`, background: '#F59E0B' }}
            title={`Emergency Exit Reserve: ${formatMoney(emergencyReserveUsd)}`}
          />
        </div>

        {/* Legend / Metrics Grid */}
        <div className="sb-reserve-legend">
          <div className="sb-reserve-legend-item">
            <span className="sb-legend-dot" style={{ background: '#14F195' }} />
            <div>
              <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem' }}>Free Deployable</span>
              <b className="font-mono" style={{ color: '#14F195' }}>{formatMoney(freeDeployableCashUsd)}</b>
            </div>
          </div>

          <div className="sb-reserve-legend-item">
            <span className="sb-legend-dot" style={{ background: '#9bcbff' }} />
            <div>
              <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem' }}>Orders Hold</span>
              <b className="font-mono">{formatMoney(reservedUsd)}</b>
            </div>
          </div>

          <div className="sb-reserve-legend-item">
            <span className="sb-legend-dot" style={{ background: '#F59E0B' }} />
            <div>
              <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem' }}>Emergency Reserve</span>
              <b className="font-mono" style={{ color: '#F59E0B' }}>{formatMoney(emergencyReserveUsd)}</b>
            </div>
          </div>

          <div className="sb-reserve-legend-item">
            <span className="sb-legend-dot" style={{ background: 'rgba(255,255,255,0.2)' }} />
            <div>
              <span className="text-muted" style={{ display: 'block', fontSize: '0.7rem' }}>Paper Model Cash</span>
              <b className="font-mono">{formatMoney(totalCashUsd)}</b>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export default DynamicReserveGauge;
