import React from 'react';
import {X, BookOpen} from 'lucide-react';

export function CounterfactualMethodologyDrawer({isOpen, onClose, config=null}) {
  if (!isOpen) return null;
  const value = (key, suffix='') => config?.[key] == null ? 'Unavailable' : String(config[key]) + suffix;
  return (
    <div className="drawer-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="counterfactual-drawer-title">
      <aside className="provenance-drawer-panel counterfactual-drawer" onClick={e=>e.stopPropagation()}>
        <header className="drawer-header">
          <div><span className="eyebrow"><BookOpen size={14}/> Comparison methodology</span>
            <h2 id="counterfactual-drawer-title">Policy source &amp; evidence</h2></div>
          <button autoFocus className="icon-button" onClick={onClose} aria-label="Close methodology drawer"><X size={18}/></button>
        </header>
        <div className="drawer-body quiet-empty">
          <h3>Recorded baseline required</h3>
          <p>The comparison panel needs independently recorded baseline outcomes from the same candidate universe, sizing policy and execution-cost model. Missing baseline data and counterfactual returns are displayed as unavailable.</p>
          <h3>Configuration reference</h3>
          <p>{config?.sourceDetail || 'Backend configuration unavailable'}. Some fields may use disk settings or defaults. This reference does not establish the policy used by a historical session or by the separate browser simulator.</p>
          <table><tbody>
            <tr><th>Target size</th><td>{value('BUY_LAMPORTS',' lamports')}</td></tr>
            <tr><th>Stop threshold</th><td>{value('STOP_BPS',' bps')}</td></tr>
            <tr><th>Slippage cap</th><td>{value('SLIPPAGE_BPS',' bps')}</td></tr>
            <tr><th>Position cap</th><td>{value('MAX_POSITIONS')}</td></tr>
            <tr><th>Priority fee ceiling</th><td>{value('MAX_PRIORITY_LAMPORTS',' lamports')}</td></tr>
            <tr><th>Tip floor</th><td>{value('MIN_TIP_LAMPORTS',' lamports')}</td></tr>
          </tbody></table>
          <h3>Outcome handling</h3>
          <p>Censored outcomes are counted separately and excluded from resolved return and win/loss totals. Fees already included in settlement proceeds must not be deducted a second time. Paper fills remain simulations.</p>
          <h3>Replay requirements</h3>
          <p>Store the actual observation horizon, exit policy, candidate IDs, cost assumptions and policy version with each replay. Curve completion requires an explicit migration or censoring policy. A fixed horizon alone does not eliminate selection bias.</p>
          <p>Losses avoided, missed upside and filter alpha cannot be inferred from buyer counts or reserve drift. The panel withholds these metrics until a matching counterfactual record is available.</p>
        </div>
      </aside>
    </div>
  );
}
