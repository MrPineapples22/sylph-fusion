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
  { id: 'signal', label: 'Signal', icon: Activity, desc: 'Accumulation or breakout trigger' },
  { id: 'snapshot', label: 'Snapshot', icon: Clock, desc: 'Reserve & curve state fetch' },
  { id: 'safety', label: 'Safety', icon: Shield, desc: 'Authorities & dev holdings checked' },
  { id: 'build', label: 'Build', icon: Sliders, desc: 'Instructions & CU optimization' },
  { id: 'simulation', label: 'Simulation', icon: Zap, desc: 'Compute limit & slippage preflight' },
  { id: 'persisted', label: 'Persisted', icon: FileCheck, desc: 'Durable state checkpoint (SQLite)' },
  { id: 'broadcast', label: 'Broadcast', icon: Radio, desc: 'Jito bundle / RPC submission' },
  { id: 'settlement', label: 'Settlement', icon: CheckCircle2, desc: 'Finalized, failed, or expired' },
];

export function OrderLifecycleTimeline({ orders = [], pendingOrder = null, isDisconnected = false }) {
  const [selectedOrderId, setSelectedOrderId] = useState(null);

  if (isDisconnected) {
    return (
      <article className="soak-card lifecycle-card" id="order-lifecycle-panel">
        <header className="soak-card-header">
          <div>
            <span className="eyebrow">DURABILITY & EXECUTION PIPELINE</span>
            <h3>Order Lifecycle Timeline</h3>
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
              Order execution and settlement stream is offline. Progression timelines and duration breakdowns will appear once telemetry resumes.
            </p>
          </div>
        </div>

        <div className="soak-card-footer">
          <small>
            Atomic durability requirement: SQLite state save must succeed before any signed bytes leave the process.
          </small>
        </div>
      </article>
    );
  }

  // Normalize order list combining pending and filled/failed orders
  const allOrders = [
    ...(pendingOrder ? [{
      id: pendingOrder.id || pendingOrder.signature || 'pending-order',
      mint: pendingOrder.mint,
      side: pendingOrder.side || 'buy',
      status: 'pending',
      reason: pendingOrder.reason || 'buyer-accumulation',
      created: pendingOrder.created || Date.now() - 350,
      stage: pendingOrder.stage ?? 0,
      durations: {
        signal: 12,
        snapshot: 18,
        safety: 34,
        build: 22,
        simulation: 45,
        persisted: 16,
        broadcast: 140,
        settlement: 0,
      },
      overhead: {
        slippageBps: 300,
        priorityLamports: '200000',
        tipLamports: '50000',
        rentLamports: '3000000',
        quoteAgeMs: 85,
      },
    }] : []),
    ...orders.map(o => ({
      id: o.id || o.signature || `order-${Math.random().toString(36).slice(2, 8)}`,
      mint: o.mint || o.asset || 'Unknown',
      side: (o.side || 'buy').toLowerCase(),
      status: (o.status || 'filled').toLowerCase(),
      reason: o.reason || 'buyer-accumulation',
      created: o.timestamp || o.at || Date.now(),
      stage: o.stage ?? 0,
      durations: o.durations || {
        signal: 14,
        snapshot: 20,
        safety: 32,
        build: 24,
        simulation: 40,
        persisted: 15,
        broadcast: 180,
        settlement: 35,
      },
      overhead: o.overhead || {
        slippageBps: o.slippageBps ?? 300,
        priorityLamports: o.priorityLamports ?? '200000',
        tipLamports: o.tipLamports ?? '50000',
        rentLamports: o.rentLamports ?? '3000000',
        quoteAgeMs: o.quoteAgeMs ?? 95,
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
            <h3>Order Lifecycle Timeline</h3>
          </div>
        </header>
        <div className="empty-substate" role="status">
          <Clock size={20} />
          <div>
            <b>No fills recorded in this session.</b>
            <p>Orders will display stage-by-stage progression from trigger signal to confirmed ledger settlement.</p>
          </div>
        </div>
      </article>
    );
  }

  const durations = activeOrder.durations || {};
  const totalMs = Object.values(durations).reduce((a, b) => a + (Number(b) || 0), 0);

  const getStageStatus = (stageId) => {
    if (activeOrder.status === 'pending') {
      if (stageId === 'settlement') return 'waiting';
      if (stageId === 'broadcast') return 'in-flight';
      return 'completed';
    }
    if (activeOrder.status === 'failed' || activeOrder.status === 'rejected') {
      if (stageId === 'settlement') return 'failed';
      return 'completed';
    }
    if (activeOrder.status === 'expired') {
      if (stageId === 'settlement') return 'expired';
      return 'completed';
    }
    return 'completed';
  };

  return (
    <article className="soak-card lifecycle-card" id="order-lifecycle-panel">
      <header className="soak-card-header">
        <div>
          <span className="eyebrow">ORDER DURABILITY & LATENCY PROFILER</span>
          <h3>Order Lifecycle Timeline</h3>
        </div>
        <div className="lifecycle-header-right">
          <span className="pill font-mono">
            <Clock size={11} /> Total: {totalMs} ms
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
                <span className={`dot-chip ${o.side === 'buy' ? 'buy' : 'sell'}`} />
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
          <span className={activeOrder.side === 'buy' ? 'positive' : 'negative'}>
            {activeOrder.side.toUpperCase()} (Stage {activeOrder.stage})
          </span>
        </div>
        <div className="summary-field">
          <small>TRIGGER REASON</small>
          <span>{activeOrder.reason}</span>
        </div>
        <div className="summary-field">
          <small>SLIPPAGE CAP</small>
          <span>{activeOrder.overhead?.slippageBps ?? 300} BPS ({(Number(activeOrder.overhead?.slippageBps ?? 300) / 100).toFixed(1)}%)</span>
        </div>
      </div>

      {/* Progressive Stage Stepper */}
      <div className="lifecycle-stepper" role="region" aria-label="Order lifecycle stages">
        {LIFECYCLE_STAGES.map((st, i) => {
          const Icon = st.icon;
          const status = getStageStatus(st.id);
          const dur = durations[st.id] ?? 0;

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
                  {dur > 0 && (
                    <span className="node-duration font-mono">{dur}ms</span>
                  )}
                </div>
                <small className="node-desc">{st.desc}</small>
              </div>
            </div>
          );
        })}
      </div>

      {/* Overhead & Latency Detail Grid */}
      <div className="lifecycle-overhead-grid">
        <div className="overhead-cell">
          <small>QUOTE FRESHNESS</small>
          <b className="font-mono">{activeOrder.overhead?.quoteAgeMs ?? 0} ms</b>
        </div>
        <div className="overhead-cell">
          <small>PRIORITY FEE</small>
          <b className="font-mono">{activeOrder.overhead?.priorityLamports ?? '0'} lamports</b>
        </div>
        <div className="overhead-cell">
          <small>JITO TIP</small>
          <b className="font-mono">{activeOrder.overhead?.tipLamports ?? '0'} lamports</b>
        </div>
        <div className="overhead-cell">
          <small>RENT LAMPORTS</small>
          <b className="font-mono">{activeOrder.overhead?.rentLamports ?? '0'}</b>
        </div>
      </div>

      <div className="soak-card-footer">
        <small>
          Atomic durability requirement: SQLite state save must succeed before any signed bytes leave the process. Broadcast retries reuse identical wire signatures.
        </small>
      </div>
    </article>
  );
}

export default OrderLifecycleTimeline;
