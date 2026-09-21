import React, { useId } from 'react';
import { Layers, Zap } from 'lucide-react';

export function OverlayDepthGauge({ asset, engine, solPriceUsd }) {
  const gradient = useId();
  if (!asset || !engine?.getOverlay) return null;
  const overlay = engine.getOverlay(asset.id);
  const sol = Number(solPriceUsd), liquidity = Number(asset.liquidity), mark = Number(asset.price);
  const valid = [sol, liquidity, mark].every(v => Number.isFinite(v) && v > 0);
  if (!overlay || !valid) return <section className="depth-gauge"><header><Layers size={13}/>LOCAL POOL DEPTH</header><p>{!valid ? 'Reserve estimate unavailable' : 'No active local overlay'}</p><small>Paper reserve model · observed liquidity estimate</small></section>;
  const decimals = asset.decimals ?? 9;
  const baselineSol = liquidity / 2 / sol;
  const baselineToken = liquidity / 2 / mark;
  const localSol = Number(overlay.reserves.sol) / 1e9;
  const localToken = Number(overlay.reserves.token) / 10 ** decimals;
  if (![localSol, localToken].every(v => Number.isFinite(v) && v > 0)) return null;
  const depletion = Math.max(0, (1-localSol/baselineSol)*100, (1-localToken/baselineToken)*100);
  const impact = (localSol/localToken*sol/mark-1)*100;
  const level = depletion > 10 ? 'danger' : depletion > 5 ? 'warning' : 'normal';
  return <section className="depth-gauge" data-level={level} aria-label="Optimistic pool depth">
    <header><Zap size={13}/>LOCAL OVERLAY ACTIVE</header>
    <svg className="depth-curve" viewBox="0 0 240 56" role="img" aria-label="Illustrative constant-product curve"><defs><linearGradient id={gradient}><stop stopColor="#8b5cf6"/><stop offset="1" stopColor="#10b981"/></linearGradient></defs><path d="M4 4 C24 42 65 48 236 52" fill="none" stroke={`url(#${gradient})`} strokeWidth="2"/></svg>
    <dl><dt>Local price divergence</dt><dd>{impact>=0?'+':''}{impact.toFixed(2)}%</dd><dt>Largest reserve depletion</dt><dd>{depletion.toFixed(2)}%</dd><dt>SOL reserve change</dt><dd>{localSol-baselineSol>=0?'+':''}{(localSol-baselineSol).toFixed(3)} SOL</dd></dl>
    <progress value={Math.min(100,depletion)} max="100" aria-label="Reserve depletion percentage"/>
    <small>Reconcile at modeled slot ~{overlay.appliedAtSlot}</small>
    <small>Estimated baseline · curve illustration · paper only</small>
  </section>;
}
