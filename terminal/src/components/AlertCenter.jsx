import React, { useState } from 'react';
import {
  Bell,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Info,
  X,
  Clock,
  CheckCheck,
  Filter,
  Flame,
  Radio,
  Layers
} from 'lucide-react';
import { ALERT_SEVERITIES } from '../alert-manager.js';

export function AlertCenter({
  isOpen = false,
  onClose = () => {},
  alerts = [],
  onAcknowledge = () => {},
  onAcknowledgeAll = () => {},
}) {
  const [filter, setFilter] = useState('active'); // 'active' | 'all' | 'critical'

  if (!isOpen) return null;

  const unacknowledgedCount = alerts.filter(a => !a.acknowledged).length;

  const filteredAlerts = alerts.filter(a => {
    if (filter === 'active') return !a.acknowledged;
    if (filter === 'critical') return a.severity === ALERT_SEVERITIES.CRITICAL && !a.acknowledged;
    return true; // 'all'
  });

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case ALERT_SEVERITIES.CRITICAL:
        return (
          <span className="severity-badge sev-critical font-mono">
            <ShieldAlert size={11} className="animate-pulse" /> CRITICAL
          </span>
        );
      case ALERT_SEVERITIES.WARNING:
        return (
          <span className="severity-badge sev-warning font-mono">
            <AlertTriangle size={11} /> WARNING
          </span>
        );
      default:
        return (
          <span className="severity-badge sev-info font-mono">
            <Info size={11} /> INFO
          </span>
        );
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Incident & Alert Center"
        className="alert-center-modal"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <header className="alert-center-header">
          <div className="alert-header-title">
            <div className="alert-icon-circle">
              <Bell size={18} />
            </div>
            <div>
              <div className="eyebrow">SYSTEM INCIDENT LOG</div>
              <h2>Alert Center</h2>
            </div>
          </div>

          <div className="alert-header-actions">
            {unacknowledgedCount > 0 && (
              <button
                type="button"
                className="btn-ack-all font-mono"
                onClick={onAcknowledgeAll}
                title="Mark all active incidents as reviewed"
              >
                <CheckCheck size={13} /> Acknowledge All ({unacknowledgedCount})
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Close Alert Center"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Filter Toolbar */}
        <div className="alert-filter-bar">
          <div className="alert-filter-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'active'}
              className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
              onClick={() => setFilter('active')}
            >
              Active ({unacknowledgedCount})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'critical'}
              className={`filter-tab ${filter === 'critical' ? 'active' : ''}`}
              onClick={() => setFilter('critical')}
            >
              Critical Only
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={filter === 'all'}
              className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All History ({alerts.length})
            </button>
          </div>
        </div>

        {/* Alert List */}
        <div className="alert-cards-scroll">
          {filteredAlerts.length === 0 ? (
            <div className="alert-empty-state">
              <CheckCircle2 size={32} className="text-good" />
              <b>Zero active incidents</b>
              <p>All system components operating within nominal limits. Repeated RPC throttles, feed stalls, and risk halts will be grouped here.</p>
            </div>
          ) : (
            <div className="alert-cards-list">
              {filteredAlerts.map((a) => {
                const isAck = a.acknowledged;
                const repeatCount = a.count > 1 ? a.count : null;
                const timeAgo = Math.round((Date.now() - a.lastSeen) / 1000);

                return (
                  <article
                    key={a.id}
                    className={`alert-incident-card ${a.severity} ${isAck ? 'card-acknowledged' : ''}`}
                  >
                    <div className="incident-card-top">
                      <div className="incident-badges">
                        {getSeverityBadge(a.severity)}
                        {repeatCount && (
                          <span className="incident-repeat-badge font-mono">
                            ×{repeatCount} occurrences
                          </span>
                        )}
                        {isAck && (
                          <span className="incident-ack-badge font-mono">
                            <CheckCircle2 size={10} /> Acknowledged
                          </span>
                        )}
                      </div>

                      <div className="incident-time font-mono">
                        <Clock size={11} />
                        <span>{timeAgo < 60 ? `${timeAgo}s ago` : `${Math.floor(timeAgo / 60)}m ago`}</span>
                      </div>
                    </div>

                    <h4 className="incident-title">{a.title}</h4>
                    <p className="incident-msg">{a.message}</p>

                    {a.action && (
                      <div className="incident-action-box">
                        <small>ACTION REQUIRED</small>
                        <p>{a.action}</p>
                      </div>
                    )}

                    {!isAck && (
                      <div className="incident-footer">
                        <button
                          type="button"
                          className="btn-ack-single font-mono"
                          onClick={() => onAcknowledge(a.id)}
                        >
                          <CheckCircle2 size={12} /> Acknowledge Incident
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <footer className="alert-center-footer">
          <small>
            Alerts are automatically deduplicated by incident type. Acknowledged incidents remain in history for post-mortem audits.
          </small>
        </footer>
      </section>
    </div>
  );
}

export default AlertCenter;
