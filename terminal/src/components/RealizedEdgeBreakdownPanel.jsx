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

export function RealizedEdgeBreakdownPanel({ data = null, solPriceUsd = null, solPriceObservedAt = null }) {
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

  // Unknown input stays unknown; do not turn omitted factors into zero costs.
  const toLamports = (value) => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'string' && /^(?:0|-?[1-9][0-9]*)$/.test(value)) {
      try { return BigInt(value); } catch { return null; }
    }
    if (Number.isSafeInteger(value)) return BigInt(value);
    return null;
  };
  const observedPriceAgeMs = Number.isFinite(solPriceObservedAt) ? Date.now() - solPriceObservedAt : null;
  const currentSolPriceUsd = Number.isFinite(solPriceUsd) && solPriceUsd > 0 &&
    observedPriceAgeMs !== null && observedPriceAgeMs >= 0 && observedPriceAgeMs <= 30_000
    ? solPriceUsd : null;
  const negateMeasuredCost = (value) => {
    const measured = toLamports(value);
    return measured !== null && measured >= 0n ? -measured : null;
  };
  const toSol = (value) => {
    const lamports = toLamports(value);
    if (lamports === null) return null;
    const converted = Number(lamports) / 1e9;
    return Number.isFinite(converted) ? converted : null;
  };
  const toUsd = (value) => {
    const sol = toSol(value);
    return sol !== null && currentSolPriceUsd !== null ? sol * currentSolPriceUsd : null;
  };

  const factors = [
    { label: 'Gross Signal Alpha', val: toLamports(b.signalEdgeLamports), type: 'positive', icon: TrendingUp, desc: 'Theoretical model edge at discovery' },
    { label: 'Temporal Decay Loss', val: negateMeasuredCost(b.temporalDecayLamports), type: 'negative', icon: Clock, desc: 'Alpha decay while assembling order' },
    { label: 'Decision Latency Loss', val: negateMeasuredCost(b.decisionLatencyLossLamports), type: 'negative', icon: Clock, desc: 'Pipeline latency (sub-10ms target)' },
    { label: 'Build Latency Loss', val: negateMeasuredCost(b.buildLatencyLossLamports), type: 'negative', icon: Zap, desc: 'Tx instruction assembly time' },
    { label: 'Routing / AMM Edge', val: toLamports(b.routingEdgeLamports), type: 'positive', icon: Activity, desc: 'Smart pathing over naive swap' },
    { label: 'Leader Timing Edge', val: toLamports(b.leaderEdgeLamports), type: 'positive', icon: Zap, desc: 'Schedule-aware leader target' },
    { label: 'Liquidity Edge', val: b.liquidityEdgeLamports != null ? toLamports(b.liquidityEdgeLamports) : negateMeasuredCost(b.liquidityChangeLamports), type: (toLamports(b.liquidityEdgeLamports) ?? 0n) > 0n ? 'positive' : 'negative', icon: Scale, desc: 'Observed submission-to-landing liquidity edge' },
    { label: 'Network Base Fee', val: negateMeasuredCost(b.baseFeeLamports), type: 'friction', icon: AlertCircle, desc: 'Solana signature cost' },
    { label: 'Priority Fee', val: negateMeasuredCost(b.priorityFeeLamports), type: 'friction', icon: AlertCircle, desc: 'CU scheduling fee' },
    { label: 'Jito Tip Drag', val: negateMeasuredCost(b.jitoTipLamports ?? b.tipLamports), type: 'friction', icon: AlertCircle, desc: 'Recorded bundle tip' },
    { label: 'Market Impact', val: negateMeasuredCost(b.marketImpactLamports ?? b.priceImpactLamports), type: 'negative', icon: AlertCircle, desc: 'Recorded market impact' },
    { label: 'Slippage Loss', val: negateMeasuredCost(b.slippageLossLamports ?? b.slippageLamports), type: 'negative', icon: AlertCircle, desc: 'Recorded slippage loss' },
    { label: 'Adverse Selection', val: negateMeasuredCost(b.adverseSelectionLamports ?? b.failureCostLamports), type: 'negative', icon: AlertCircle, desc: 'Adverse fill / queue selection' },
    { label: 'Capital Lock Cost', val: negateMeasuredCost(b.capitalLockCostLamports), type: 'negative', icon: Clock, desc: 'Recorded capital-time cost' },
    { label: 'UNEXPLAINED Residual', val: toLamports(b.unexplainedResidualLamports ?? b.unexplainedLamports), type: 'unexplained', icon: HelpCircle, desc: 'Causal attribution residual — never blamed on model alpha' },
  ];

  const measuredFactorCount = factors.filter(f => f.val !== null).length;
  const maxVal = Math.max(...factors.map(f => Math.abs(toSol(f.val) ?? 0)), 0.001);
  const netRealizedSol = toSol(b.netRealizedEdgeLamports);

  return (
    <article className="sb-glass-card" style={{ padding: '1.25rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
        <div>
          <span className="font-mono text-xs text-muted" style={{ color: '#14F195', fontWeight: 600 }}>
            15-FACTOR CAUSAL ATTRIBUTION &amp; RECORDED FRICTION · {measuredFactorCount}/15 FACTORS
          </span>
          <h3 style={{ margin: '2px 0', fontSize: '1.15rem', color: '#f0f4f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Scale size={18} style={{ color: '#14F195' }} />
            Realized Edge &amp; Leakage Decomposition
          </h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: '#98aabd' }}>
            Answers: <em>&ldquo;Where did expected alpha disappear?&rdquo;</em> Separates model edge from latency, transport, and liquidity friction.
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '0.68rem', color: '#98aabd' }}>
            USD conversion: {currentSolPriceUsd === null ? 'Unknown · no fresh SOL/USD observation' : `SOL/USD observation ${Math.floor(observedPriceAgeMs / 1000)}s old`}. Missing factor rows are unknown, not zero.
          </p>
        </div>

        <div style={{ textAlign: 'right' }}>
          <span className="font-mono text-xs text-muted">Net Realized Edge</span>
          <div className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: netRealizedSol === null ? '#becad6' : netRealizedSol >= 0 ? '#14F195' : '#FF3B69' }}>
            {netRealizedSol === null ? 'Unknown' : `${netRealizedSol >= 0 ? '+' : ''}${netRealizedSol.toFixed(4)} SOL`}
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
          Only supplied components are measured here; omitted factors remain unknown. USD conversion appears only with a current observed SOL price. Attribution quality depends on the source record and does not establish expected future edge.
        </span>
      </div>

      {/* Waterfall Breakdown Rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {factors.map(f => {
          const solVal = toSol(f.val);
          const usdVal = toUsd(f.val);
          const absPct = solVal === null ? 0 : Math.min(100, Math.max(2, (Math.abs(solVal) / maxVal) * 100));
          const color = solVal === null ? '#94A3B8' : f.type === 'positive' ? '#14F195'
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
                {solVal === null ? 'Unknown' : `${solVal >= 0 ? '+' : ''}${solVal.toFixed(4)} SOL`}
              </span>

              <span className="font-mono text-xs text-muted" style={{ textAlign: 'right' }}>
                {usdVal === null ? 'Unknown' : `${usdVal >= 0 ? '+' : ''}${formatMoney(usdVal)}`}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export default RealizedEdgeBreakdownPanel;
