import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Clock,
  Zap,
  Activity,
  AlertCircle,
  HelpCircle,
  Scale,
  RefreshCw
} from 'lucide-react';
import { formatMoney, formatNumber } from '../design-system/format.js';

export function RealizedEdgeBreakdownPanel({ data = null, solPriceUsd = 150 }) {
  const [breakdown, setBreakdown] = useState(data);
  const [loading, setLoading] = useState(false);

  const fetchBreakdown = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/edge/breakdown');
      if (res.ok) {
        const json = await res.json();
        setBreakdown(json.breakdown ?? null);
      }
    } catch {
      // Non-blocking fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!data) {
      fetchBreakdown();
      const interval = setInterval(fetchBreakdown, 5000);
      return () => clearInterval(interval);
    } else {
      setBreakdown(data);
    }
  }, [data]);

  const b = breakdown;

  if (!b) {
    return (
      <article className="sb-glass-card" style={{ padding: '1.25rem' }}>
        <h3>Realized Edge &amp; Leakage Decomposition</h3>
        <p className="op-muted">No settled execution-edge record is available. Model or placeholder values are not shown as realized attribution.</p>
      </article>
    );
  }

  // Helper to convert lamport string/bigint to SOL and USD
  const toSol = (val) => Number(BigInt(val ?? 0)) / 1e9;
  const toUsd = (val) => toSol(val) * solPriceUsd;

  const factors = [
    { label: 'Gross Signal Alpha', val: b.signalEdgeLamports, type: 'positive', icon: TrendingUp, desc: 'Theoretical model edge at discovery' },
    { label: 'Temporal Decay Loss', val: -BigInt(b.temporalDecayLamports ?? 0), type: 'negative', icon: Clock, desc: 'Alpha decay while assembling order' },
    { label: 'Decision Latency Loss', val: -BigInt(b.decisionLatencyLossLamports ?? 0), type: 'negative', icon: Clock, desc: 'Pipeline latency (sub-10ms target)' },
    { label: 'Build Latency Loss', val: -BigInt(b.buildLatencyLossLamports ?? 0), type: 'negative', icon: Zap, desc: 'Tx instruction assembly time' },
    { label: 'Routing / AMM Edge', val: b.routingEdgeLamports, type: 'positive', icon: Activity, desc: 'Smart pathing over naive swap' },
    { label: 'Leader Timing Edge', val: b.leaderEdgeLamports, type: 'positive', icon: Zap, desc: 'Schedule-aware leader target' },
    { label: 'Liquidity Edge', val: b.liquidityEdgeLamports ?? -BigInt(b.liquidityChangeLamports ?? 0), type: (b.liquidityEdgeLamports ? 'positive' : 'negative'), icon: Scale, desc: 'Observed submission-to-landing liquidity edge' },
    { label: 'Network Base Fee', val: -BigInt(b.baseFeeLamports ?? 0), type: 'friction', icon: AlertCircle, desc: 'Solana signature cost' },
    { label: 'Priority Fee', val: -BigInt(b.priorityFeeLamports ?? 0), type: 'friction', icon: AlertCircle, desc: 'CU scheduling fee' },
    { label: 'Jito Tip Drag', val: -BigInt(b.jitoTipLamports ?? b.tipLamports ?? 0), type: 'friction', icon: AlertCircle, desc: 'Recorded bundle tip' },
    { label: 'Market Impact', val: -BigInt(b.marketImpactLamports ?? b.priceImpactLamports ?? 0), type: 'negative', icon: AlertCircle, desc: 'Recorded market impact' },
    { label: 'Slippage Loss', val: -BigInt(b.slippageLossLamports ?? b.slippageLamports ?? 0), type: 'negative', icon: AlertCircle, desc: 'Recorded slippage loss' },
    { label: 'Adverse Selection', val: -BigInt(b.adverseSelectionLamports ?? b.failureCostLamports ?? 0), type: 'negative', icon: AlertCircle, desc: 'Adverse fill / queue selection' },
    { label: 'Capital Lock Cost', val: -BigInt(b.capitalLockCostLamports ?? 0), type: 'negative', icon: Clock, desc: 'Recorded capital-time cost' },
    { label: 'UNEXPLAINED Residual', val: BigInt(b.unexplainedResidualLamports ?? b.unexplainedLamports ?? 0), type: 'unexplained', icon: HelpCircle, desc: 'Causal attribution residual — never blamed on model alpha' },
  ];

  const maxVal = Math.max(...factors.map(f => Math.abs(toUsd(f.val))), 0.001);

  return (
    <article className="sb-glass-card" style={{ padding: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <div>
          <span className="font-mono text-xs text-muted" style={{ color: '#14F195', fontWeight: 600 }}>
            15-FACTOR CAUSAL ATTRIBUTION &amp; FRICTION BREAKDOWN
          </span>
          <h3 style={{ margin: '2px 0', fontSize: '1.15rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Scale size={18} style={{ color: '#14F195' }} />
            Realized Edge &amp; Leakage Decomposition
          </h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#98aabd' }}>
            Answers: <em>&ldquo;Where did expected alpha disappear?&rdquo;</em> Separates model edge from latency, transport, and liquidity friction.
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span className="font-mono text-xs text-muted">Net Realized Edge</span>
          <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: toSol(b.netRealizedEdgeLamports) >= 0 ? '#14F195' : '#FF3B69' }}>
            {toSol(b.netRealizedEdgeLamports) >= 0 ? '+' : ''}{toSol(b.netRealizedEdgeLamports).toFixed(4)} SOL
            <small style={{ fontSize: '0.75rem', marginLeft: '6px', color: '#becad6' }}>
              ({formatMoney(toUsd(b.netRealizedEdgeLamports))})
            </small>
          </div>
        </div>
      </header>

      {/* Epistemic Doctrine Alert */}
      <div style={{ padding: '8px 12px', background: 'rgba(155,203,255,0.06)', borderLeft: '3px solid #9bcbff', borderRadius: '4px', marginBottom: '16px' }}>
        <b style={{ fontSize: '0.75rem', color: '#9bcbff' }}>Attribution Rule:</b>
        <span style={{ fontSize: '0.75rem', color: '#becad6', marginLeft: '6px' }}>
          Remainder is designated strictly as <strong>UNEXPLAINED</strong>. Never adjust model weights when loss was caused by transport or priority fee starvation.
        </span>
      </div>

      {/* Waterfall Breakdown Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {factors.map(f => {
          const solVal = toSol(f.val);
          const usdVal = toUsd(f.val);
          const absPct = Math.min(100, Math.max(2, (Math.abs(usdVal) / maxVal) * 100));
          const color = f.type === 'positive' ? '#14F195'
            : f.type === 'unexplained' ? '#9945FF'
            : f.type === 'friction' ? '#F59E0B'
            : '#FF3B69';

          return (
            <div key={f.label} className="sb-waterfall-row">
              <span className="sb-waterfall-label" title={f.desc}>
                <f.icon size={13} style={{ color }} />
                <span>{f.label}</span>
              </span>

              <div className="sb-waterfall-bar-track">
                <div
                  className="sb-waterfall-bar-fill"
                  style={{
                    width: `${absPct}%`,
                    background: color,
                    marginLeft: f.type === 'positive' ? '0' : 'auto',
                  }}
                />
              </div>

              <span className="sb-waterfall-val" style={{ color }}>
                {solVal >= 0 ? '+' : ''}{solVal.toFixed(4)} SOL
              </span>

              <span className="font-mono text-xs text-muted" style={{ textAlign: 'right' }}>
                {usdVal >= 0 ? '+' : ''}{formatMoney(usdVal)}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default RealizedEdgeBreakdownPanel;
