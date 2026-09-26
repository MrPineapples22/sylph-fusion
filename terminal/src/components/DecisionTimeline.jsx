import React from 'react';
import { Clock, ShieldCheck, ShieldAlert, AlertTriangle, ArrowRight } from 'lucide-react';

export function DecisionTimeline({ events = [], currentStage = 'OBSERVED', evaluatedAt = Date.now() }) {
  const stages = [
    { id: 'OBSERVED', label: 'Observed', desc: 'Market discovery & ingestion' },
    { id: 'SCREENED', label: 'Screened', desc: 'Pre-trade safety & filters' },
    { id: 'EVALUATED', label: 'Evaluated', desc: 'Model inference & edge score' },
    { id: 'GATED', label: 'Gated', desc: 'Risk & authority verification' },
    { id: 'SETTLED', label: 'Settled', desc: 'Reconciled execution on ledger' },
  ];

  const currentIdx = stages.findIndex(s => s.id === currentStage);

  return (
    <div className="decision-timeline-component" role="region" aria-label="Decision Timeline">
      <div className="timeline-stages flex items-center justify-between mb-4">
        {stages.map((stage, idx) => {
          const isPassed = currentIdx > idx;
          const isCurrent = currentIdx === idx;
          return (
            <div key={stage.id} className={`timeline-stage-node flex-1 text-center ${isPassed ? 'stage-passed' : isCurrent ? 'stage-current' : 'stage-pending'}`}>
              <div className="stage-pill font-mono text-xs px-2 py-1 rounded inline-block mb-1">
                {stage.label}
              </div>
              <p className="text-[10px] text-muted">{stage.desc}</p>
            </div>
          );
        })}
      </div>

      {events.length > 0 && (
        <div className="timeline-event-list font-mono text-xs border-t border-[#1f2937] pt-3">
          <span className="eyebrow text-muted block mb-2">TRANSITION LOG</span>
          {events.map((evt, i) => (
            <div key={evt.id || i} className="timeline-event-row flex items-center justify-between py-1">
              <span className="text-[#38bdf8]">{new Date(evt.timestamp || evaluatedAt).toLocaleTimeString()}</span>
              <span className="text-foreground">{evt.message || evt.text}</span>
              <span className={`status-badge text-[10px] ${evt.status === 'ERROR' ? 'text-danger' : 'text-good'}`}>{evt.status || 'OK'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DecisionTimeline;
