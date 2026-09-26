import React, {useEffect, useRef} from 'react';
import {Check, CircleHelp, Clock3, TriangleAlert, CircleX, Search} from 'lucide-react';
const good = new Set(['READY','CURRENT','OPERATIONAL','COMPLETED','RECONCILED','CHECKS_PASSED','SAFE']);
const danger = new Set(['BLOCKED','HALTED','VETOED','ERROR','CRITICAL']);
// Quarantine is an observation-level restriction, not a safety veto and never
// a positive state. Give it an explicit caution treatment instead of letting
// it disappear into a neutral/unknown badge.
const warning = new Set(['DEGRADED','STALE','WARNING','QUARANTINED']);
const pending = new Set(['PENDING','CONNECTING','REVALIDATING']);
export function Status({value, label}) {
  const state = value || 'UNKNOWN';
  const tone = good.has(state)?'success':danger.has(state)?'danger':warning.has(state)?'warning':pending.has(state)?'pending':'unknown';
  const Icon = tone==='success'?Check:tone==='danger'?CircleX:tone==='warning'?TriangleAlert:tone==='pending'?Clock3:CircleHelp;
  return <span className={`op-status op-status-${tone}`}><Icon size={14} strokeWidth={1.75} aria-hidden="true"/>{label || state.replaceAll('_',' ').toLowerCase()}</span>;
}
export function EmptyState({title, children, action}) {
  return <section className="op-empty"><Search size={24} strokeWidth={1.75} aria-hidden="true"/><h2>{title}</h2><div>{children}</div>{action && <div className="op-empty-action">{action}</div>}</section>;
}

/** One native modal contract for keyboard, focus containment and return focus. */
export function Dialog({open, onDismiss, labelledBy, className = 'op-dialog', id, children}) {
  const ref = useRef(null);
  const origin = useRef(null);
  useEffect(() => {
    const node = ref.current;
    if (open && !node.open) {
      origin.current = document.activeElement;
      node.showModal();
    } else if (!open && node.open) {
      node.close();
      // Navigation may already have put focus on the destination heading.
      if (document.activeElement === document.body && origin.current?.isConnected) origin.current.focus();
    }
  }, [open]);
  return <dialog ref={ref} id={id} className={className} aria-labelledby={labelledBy}
    onCancel={onDismiss} onClose={onDismiss}>{children}</dialog>;
}

export function MetricCard({label, value, detail, emphasis = false}) {
  return <div className={`op-metric-card${emphasis ? ' op-metric-card-primary' : ''}`}>
    <span className="op-metric-label">{label}</span>
    <strong className={emphasis ? 'op-metric-value' : 'op-metric-secondary'}>{value}</strong>
    {detail && <span className="op-muted">{detail}</span>}
  </div>;
}

export function Badge({children, tone = 'neutral', size = 'default', className = ''}) {
  return <span className={`sylph-badge sylph-badge-${tone} sylph-badge-${size} ${className}`}>{children}</span>;
}

export function StatusPill({value, label, pulse = false, className = ''}) {
  const state = value || 'UNKNOWN';
  const tone = good.has(state) ? 'success' : danger.has(state) ? 'danger' : warning.has(state) ? 'warning' : pending.has(state) ? 'pending' : 'unknown';
  const Icon = tone === 'success' ? Check : tone === 'danger' ? CircleX : tone === 'warning' ? TriangleAlert : tone === 'pending' ? Clock3 : CircleHelp;
  return <span className={`sylph-status-pill sylph-status-${tone}${pulse ? ' sylph-pulse' : ''} ${className}`} role="status">
    <Icon size={12} strokeWidth={1.75} aria-hidden="true"/>
    <span>{label || state.replaceAll('_', ' ').toLowerCase()}</span>
  </span>;
}

export function Chip({label, count, active = false, disabled = false, onClick, onRemove, icon: Icon}) {
  const content = <><span className="sylph-chip-label">{Icon && <Icon size={13} strokeWidth={1.75} aria-hidden="true"/>}<span>{label}</span></span>{Number.isFinite(count) && <span className="sylph-chip-count">{count}</span>}</>;
  // A button inside a button is invalid HTML and leaves the remove affordance
  // unreachable from the keyboard. Keep the two actions as sibling controls.
  return <span className={`sylph-chip-wrap${disabled ? ' sylph-chip-wrap-disabled' : ''}`}>
    <button type="button" role="checkbox" aria-checked={active} disabled={disabled} onClick={onClick}
      className={`sylph-chip${active ? ' sylph-chip-active' : ''}${disabled ? ' sylph-chip-disabled' : ''}`}>{content}</button>
    {onRemove && <button type="button" disabled={disabled} aria-label={`Remove ${label}`} onClick={onRemove} className="sylph-chip-remove">×</button>}
  </span>;
}

export function Button({children, variant = 'secondary', size = 'default', icon: Icon, disabled = false, loading = false, onClick, type = 'button', className = '', ...props}) {
  return <button type={type} disabled={disabled || loading} aria-busy={loading} onClick={onClick}
    className={`sylph-button sylph-button-${variant} sylph-button-${size} ${className}`} {...props}>
    {loading ? <Clock3 size={14} className="sylph-spinner" aria-hidden="true"/> : Icon ? <Icon size={14} strokeWidth={1.75} aria-hidden="true"/> : null}
    <span>{children}</span>
  </button>;
}

export function IconButton({icon: Icon, label, variant = 'ghost', size = 'default', disabled = false, onClick, className = '', ...props}) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className={`sylph-icon-button sylph-icon-button-${variant} sylph-icon-button-${size} ${className}`} {...props}>
    <Icon size={16} strokeWidth={1.75} aria-hidden="true"/>
  </button>;
}

export function Card({title, eyebrow, badge, action, children, variant = 'default', className = '', ...props}) {
  return <section className={`sylph-card sylph-card-${variant} ${className}`} {...props}>
    {(title || eyebrow || badge || action) && <header className="sylph-card-header">
      <div>
        {eyebrow && <span className="sylph-eyebrow">{eyebrow}</span>}
        {title && <h3 className="sylph-card-title">{title}</h3>}
      </div>
      <div className="sylph-card-header-actions">
        {badge}
        {action}
      </div>
    </header>}
    <div className="sylph-card-body">{children}</div>
  </section>;
}

export function DataCard({label, value, detail, trend, emphasis = false, className = ''}) {
  return <div className={`sylph-data-card${emphasis ? ' sylph-data-card-primary' : ''} ${className}`}>
    <span className="sylph-data-label">{label}</span>
    <strong className={`sylph-data-value numeric${trend ? ` sylph-trend-${trend}` : ''}`}>{value}</strong>
    {detail && <span className="sylph-data-detail">{detail}</span>}
  </div>;
}

export function SegmentedControl({options = [], value, onChange, label, name}) {
  return <div className="sylph-segmented-control" role="radiogroup" aria-label={label}>
    {options.map(opt => {
      const optVal = typeof opt === 'string' ? opt : opt.value;
      const optLabel = typeof opt === 'string' ? opt : opt.label;
      const isSelected = value === optVal;
      return <button key={optVal} type="button" role="radio" aria-checked={isSelected}
        onClick={() => onChange?.(optVal)}
        className={`sylph-segment${isSelected ? ' sylph-segment-selected' : ''}`}>
        {optLabel}
      </button>;
    })}
  </div>;
}

export function Skeleton({width, height, radius = 'sm', className = ''}) {
  return <div className={`sylph-skeleton sylph-radius-${radius} ${className}`}
    style={{width: width ?? '100%', height: height ?? '1rem'}} aria-hidden="true"/>;
}

export function ProgressIndicator({value = 0, max = 100, label, tone = 'accent', showValue = true}) {
  const percent = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  return <div className="sylph-progress-container" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
    {(label || showValue) && <div className="sylph-progress-header">
      {label && <span className="sylph-progress-label">{label}</span>}
      {showValue && <b className="sylph-progress-value numeric">{percent}%</b>}
    </div>}
    <div className="sylph-progress-track">
      <div className={`sylph-progress-bar sylph-progress-${tone}`} style={{width: `${percent}%`}}/>
    </div>
  </div>;
}

export function SectionHeader({title, eyebrow, action, badge, children}) {
  return <header className="sylph-section-header">
    <div>
      {eyebrow && <span className="sylph-eyebrow">{eyebrow}</span>}
      <h2 className="sylph-section-title">{title}</h2>
      {children}
    </div>
    <div className="sylph-section-actions">
      {badge}
      {action}
    </div>
  </header>;
}

export function PageHeader({title, eyebrow, subtitle, status, actions}) {
  return <header className="sylph-page-header">
    <div>
      {eyebrow && <span className="sylph-eyebrow">{eyebrow}</span>}
      <h1 className="sylph-page-title">{title}</h1>
      {subtitle && <p className="sylph-page-subtitle">{subtitle}</p>}
    </div>
    <div className="sylph-page-meta">
      {status}
      {actions}
    </div>
  </header>;
}
