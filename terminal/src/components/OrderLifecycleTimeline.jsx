import React, { useState } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Zap,
  Activity,
  Layers,
  Shield,
  FileCheck,
  Radio,
  Sliders,
  ChevronRight
} from 'lucide-react';

const LIFECYCLE_STAGES = [
  { id: 'signal', label: 'Signal', icon: Activity, desc: 'Candidate or trigger observation' },
  { id: 'snapshot', label: 'Snapshot', icon: Clock, desc: 'Market-state observation' },
  { id: 'safety', label: 'Safety', icon: Shield, desc: 'Safety-check result' },
  { id: 'build', label: 'Build', icon: Sliders, desc: 'Instruction-build result' },
  { id: 'simulation', label: 'Simulation', icon: Zap, desc: 'Simulation result' },
  { id: 'persisted', label: 'Persisted', icon: FileCheck, desc: 'Persistence result' },
  { id: 'broadcast', label: 'Broadcast', icon: Radio, desc: 'Submission observation' },
  { id: 'settlement', label: 'Settlement', icon: CheckCircle2, desc: 'Reported terminal outcome' },
];

export function OrderLifecycleTimeline({ orders = [], pendingOrder = null, isDisconnected = false }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  if (isDisconnected) {
    return (
      <article className="soak-card lifecycle-card" id="order-lifecycle-panel">
        <header className="soak-card-header">
          <div>
            <span className="eyebrow">DURABILITY & EXECUTION PIPELINE</span>
            <h3>Reported order milestones</h3>
          </div>
          <div className="lifecycle-header-right">
            <span className="pill pill-danger font-mono" role="status">
              <AlertTriangle size={11} /> TELEMETRY UNAVAILABLE
            </span>
          </div>
        </header>

        <div className="empty-substate" role="status">
          <Clock size={20} className="text-warn" />
          <div>
            <b>Telemetry unavailable — Order source disconnected</b>
            <p>
              The order source is offline. Reported stage results and timings will appear after it reconnects if the source provides them.
            </p>
          </div>
        </div>

        <div className="soak-card-footer">
          <small>
            No stage completion or timing can be inferred while the order source is disconnected.
          </small>
        </div>
      </article>
    );
  }

  // Keep the source payload intact; missing measurements must remain unknown.
  const allOrders = [
    ...(pendingOrder ? [{
      ...pendingOrder,
      id: pendingOrder.id || pendingOrder.signature || 'pending-order',
      mint: pendingOrder.mint,
      side: pendingOrder.side || 'unknown',
      status: 'pending',
    }] : []),
    ...orders.map((o, index) => ({
      ...o,
      id: o.id || o.signature || `${o.mint || o.asset || 'order'}-${o.side || 'unknown'}-${o.timestamp || o.at || index}`,
      mint: o.mint || o.asset || 'Unknown',
      side: (o.side || 'unknown').toLowerCase(),
      status: (o.status || 'filled').toLowerCase(),
      reason: o.reason || 'Unknown',
      created: o.timestamp || o.at || null,
      durations: o.durations && typeof o.durations === 'object' ? o.durations : {},
      overhead: {
        ...(o.overhead && typeof o.overhead === 'object' ? o.overhead : {}),
        slippageBps: o.overhead?.slippageBps ?? o.slippageBps,
        priorityLamports: o.overhead?.priorityLamports ?? o.priorityLamports ?? o.priorityFeeLamports,
        tipLamports: o.overhead?.tipLamports ?? o.tipLamports ?? o.jitoTipLamports,
        rentLamports: o.overhead?.rentLamports ?? o.rentLamports,
        quoteAgeMs: o.overhead?.quoteAgeMs ?? o.quoteAgeMs,
      },
    })),
  ];

  const activeOrder = allOrders.find(o => o.id === selectedOrderId) || allOrders[0] || null;

  if (!activeOrder) {
    return (
      <article className="soak-card lifecycle-card" id="order-lifecycle-panel">
        <header className="soak-card-header">
          <div>
            <span className="eyebrow">DURABILITY & EXECUTION PIPELINE</span>
            <h3>Reported order milestones</h3>
          </div>
        </header>
        <div className="empty-substate" role="status">
          <Clock size={20} />
          <div>
            <b>No fills recorded in this session.</b>
              <p>Stage results and timings appear when the order source reports them. Missing milestones remain unknown.</p>
          </div>
        </div>
      </article>
    );
  }

  const durations = activeOrder.durations || {};
  const knownDurations = LIFECYCLE_STAGES.map((stage) => durations[stage.id])
    .filter((value) => Number.isFinite(value) && value >= 0);
  const totalMs = knownDurations.length === LIFECYCLE_STAGES.length
    ? knownDurations.reduce((sum, value) => sum + value, 0)
    : null;

  const getStageStatus = (stageId) => {
    const reported = activeOrder.stageStatus?.[stageId] ?? activeOrder.stages?.[stageId]?.status;
    if (['completed', 'in-flight', 'failed', 'expired', 'waiting'].includes(reported)) return reported;
    if (stageId === 'settlement' && activeOrder.status === 'pending') return 'waiting';
    if (stageId === 'settlement' && ['filled', 'settled'].includes(activeOrder.status)) return 'completed';
    if (stageId === 'settlement' && ['failed', 'rejected'].includes(activeOrder.status)) return 'failed';
    if (stageId === 'settlement' && activeOrder.status === 'expired') return 'expired';
    return 'unknown';
  };
  const displayValue = (value, suffix = '') => value == null || value === '' || !Number.isFinite(Number(value))
    ? 'Unknown'
    : `${value}${suffix}`;

  return (
    <article className="soak-card lifecycle-card" id="order-lifecycle-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">ORDER STATUS & REPORTED TIMING</span>
          <h3>Reported order milestones</h3>
        </div>
        <div className="lifecycle-header-right">
          <span className="pill font-mono">
            <Clock size={11} /> {totalMs == null ? `Timing · ${knownDurations.length}/${LIFECYCLE_STAGES.length} stages` : `Total observed: ${totalMs} ms`}
          </span>
          <span className={`pill ${activeOrder.status === 'filled' ? 'pill-active' : activeOrder.status === 'pending' ? 'badge-pending' : 'tag-warn'} font-mono`}>
            {activeOrder.status.toUpperCase()}
          </span>
        </div>
      </header>

      {/* Order Selector Toolbar if multiple orders */}
      {allOrders.length > 1 && (
        <div className="lifecycle-selector-row">
          <span className="label-sm">SELECT ORDER:</span>
          <div className="order-chips-list">
            {allOrders.slice(0, 8).map(o => (
              <button
                key={o.id}
                className={`order-chip font-mono ${o.id === activeOrder.id ? 'active' : ''}`}
                onClick={() => setSelectedOrderId(o.id)}
              >
                <span className={`dot-chip ${o.side === 'buy' ? 'buy' : o.side === 'sell' ? 'sell' : 'unknown'}`} />
                {o.side.toUpperCase()} {o.mint.slice(0, 4)}…{o.mint.slice(-4)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Order Overview */}
      <div className="order-summary-strip font-mono">
        <div className="summary-field">
          <small>TARGET MINT</small>
          <b>{activeOrder.mint}</b>
        </div>
        <div className="summary-field">
          <small>SIDE & STAGE</small>
          <span className={activeOrder.side === 'buy' ? 'positive' : activeOrder.side === 'sell' ? 'negative' : ''}>
            {activeOrder.side.toUpperCase()}{activeOrder.stage != null ? ` (Stage ${activeOrder.stage})` : ''}
          </span>
        </div>
        <div className="summary-field">
          <small>TRIGGER REASON</small>
          <span>{activeOrder.reason}</span>
        </div>
        <div className="summary-field">
          <small>SLIPPAGE CAP</small>
          <span>{activeOrder.overhead?.slippageBps == null ? 'Unknown' : `${activeOrder.overhead.slippageBps} BPS (${(Number(activeOrder.overhead.slippageBps) / 100).toFixed(1)}%)`}</span>
        </div>
      </div>

      {/* Progressive Stage Stepper */}
      <div className="lifecycle-stepper" role="region" aria-label="Reported order lifecycle evidence">
        {LIFECYCLE_STAGES.map((st, i) => {
          const Icon = st.icon;
          const status = getStageStatus(st.id);
          const dur = durations[st.id];

          return (
            <div key={st.id} className={`lifecycle-node node-${status}`}>
              <div className="node-indicator">
                <div className="node-icon-wrap">
                  {status === 'completed' ? (
                    <CheckCircle2 size={15} className="text-good" />
                  ) : status === 'in-flight' ? (
                    <Radio size={15} className="text-pending animate-pulse" />
                  ) : status === 'failed' ? (
                    <XCircle size={15} className="text-danger" />
                  ) : status === 'expired' ? (
                    <AlertTriangle size={15} className="text-warn" />
                  ) : status === 'unknown' ? (
                    <Icon size={15} className="text-muted" />
                  ) : (
                    <Icon size={15} />
                  )}
                </div>
                {i < LIFECYCLE_STAGES.length - 1 && (
                  <div className={`node-connector connector-${status}`} />
                )}
              </div>

              <div className="node-details">
                <div className="node-title-row">
                  <b>{st.label}</b>
                  <span className="node-duration font-mono">{Number.isFinite(dur) && dur >= 0 ? `${dur}ms` : 'Unknown'}</span>
                </div>
                <small className="node-desc">{status === 'unknown' ? 'Status not reported' : st.desc}</small>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overhead & Latency Detail Grid */}
      <div className="lifecycle-overhead-grid">
        <div className="overhead-cell">
          <small>QUOTE FRESHNESS</small>
          <b className="font-mono">{displayValue(activeOrder.overhead?.quoteAgeMs, ' ms')}</b>
        </div>
        <div className="overhead-cell">
          <small>PRIORITY FEE</small>
          <b className="font-mono">{displayValue(activeOrder.overhead?.priorityLamports ?? activeOrder.overhead?.priorityFeeLamports, ' lamports')}</b>
        </div>
        <div className="overhead-cell">
          <small>JITO TIP</small>
          <b className="font-mono">{displayValue(activeOrder.overhead?.tipLamports ?? activeOrder.overhead?.jitoTipLamports, ' lamports')}</b>
        </div>
        <div className="overhead-cell">
          <small>RENT LAMPORTS</small>
          <b className="font-mono">{displayValue(activeOrder.overhead?.rentLamports, ' lamports')}</b>
        </div>
      </div>

      <div className="soak-card-footer">
        <small>
          Only source-reported milestones and measurements are shown. Missing stage data stays unknown; order status alone does not establish earlier steps or live settlement details.
        </small>
      </div>
    </article>
  );
}

export default OrderLifecycleTimeline;
