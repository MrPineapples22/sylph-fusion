import React from 'react';
import {
  ShieldAlert,
  AlertTriangle,
  Radio,
  Zap,
  Flame,
  ArrowRight,
  TrendingUp,
  CircleStop
} from 'lucide-react';

export function RiskBanners({
  showSessionGate = true,
  showPaused = true,
  gatePassed = true,
  rpcDropRate = 0,
  rpcDropsCount = 0,
  halted = false,
  haltReason = null,
  operatorPaused = false,
  feedAgeMs = 0,
  feedFresh = true,
  creatorSell = false,
  curveComplete = false,
  onPanicClose = null,
  onResume = null,
}) {
  const isFeedStale = !feedFresh || feedAgeMs > 5000;
  const isRpcThrottled = rpcDropRate >= 5;

  const banners = [];

  // 1. Quality Gate Blocked
  if (showSessionGate && !gatePassed) {
    banners.push({
      id: 'gate-blocked',
      level: 'danger',
      icon: <ShieldAlert size={18} />,
      title: 'QUALITY GATE BLOCKED — 24H SOAK HELD',
      reason: `${rpcDropRate.toFixed(1)}% candidate drop rate caused by RPC rate limits (${rpcDropsCount} drops). The current session measures network throttling rather than strategy expectancy.`,
      action: 'Configure dedicated/private RPC and WSS endpoints in .env, then rerun 5m smoke verification (node scripts/run-soak.mjs --duration=300).',
    });
  }

  // 2. RPC Rate Limiting
  if (showSessionGate && isRpcThrottled && gatePassed) {
    banners.push({
      id: 'rpc-throttling',
      level: 'warn',
      icon: <AlertTriangle size={18} />,
      title: 'CLUSTER RPC RATE LIMITING (HTTP 429)',
      reason: `Snapshot requests are encountering 429 throttling (${rpcDropsCount} drops). Candidates are being discarded before safety evaluation.`,
      action: 'Switch to a private RPC endpoint or increase endpoint redundancy in .env.',
    });
  }

  // 3. Engine Safety Halt
  if (halted) {
    banners.push({
      id: 'engine-halted',
      level: 'danger',
      icon: <CircleStop size={18} />,
      title: 'ENGINE SAFETY HALT ENGAGED',
      reason: haltReason ? `Trigger: ${haltReason}` : 'Safety limit or draw-down ceiling reached. All automated entries suspended.',
      action: 'Safety halt cannot be cleared by resume; engine restart or session reset is required. Allowed action: close positions below.',
      buttons: onPanicClose ? (
        <div className="banner-buttons">
          <button className="banner-btn panic-btn" onClick={onPanicClose}>
            <CircleStop size={13} /> Close All Positions
          </button>
        </div>
      ) : null
    });
  } else if (showPaused && operatorPaused && onResume) {
    // 3B. Operator Paused (Standby) - Resuming ONLY clears operatorPaused, not halted!
    banners.push({
      id: 'operator-paused',
      level: 'warn',
      icon: <AlertTriangle size={18} />,
      title: 'AUTOMATION PAUSED (STANDBY)',
      reason: 'Operator paused automated entry evaluation. Open positions remain monitored for exit conditions.',
      action: 'Resume clears operator pause and reactivates entry screening (does not override safety halts).',
      buttons: (
        <div className="banner-buttons">
          <button className="banner-btn resume-btn" onClick={onResume}>
            <Zap size={13} /> Resume Automation
          </button>
        </div>
      )
    });
  }

  // 4. Creator Sell Detected
  if (creatorSell) {
    banners.push({
      id: 'creator-sell',
      level: 'warn',
      icon: <Flame size={18} />,
      title: 'CREATOR / INSIDER DUMP DETECTED',
      reason: 'Creator wallet or concentrated insider disposed of >5% of supply on active bonding curve.',
      action: 'Automated entries blocked. Position trailing stop active.',
    });
  }

  // 5. Curve Graduation Complete (driven by actual curve.complete state)
  if (curveComplete) {
    banners.push({
      id: 'curve-completed',
      level: 'info',
      icon: <TrendingUp size={18} />,
      title: 'CURVE COMPLETED / GRADUATED (complete: true)',
      reason: 'Bonding curve reports complete: true. AMM bonding curve trading is finalized; liquidity migrated to Raydium.',
      action: 'AMM bonding curve entries blocked. Positions route through Jupiter / Raydium post-migration.',
    });
  }

  // 6. Stale Market Data
  if (isFeedStale) {
    banners.push({
      id: 'feed-stale',
      level: 'warn',
      icon: <Radio size={18} />,
      title: 'STALE MARKET OBSERVATIONS',
      reason: feedAgeMs > 5000
        ? `Market feed has had no ticks for ${(feedAgeMs / 1000).toFixed(1)}s (threshold: 5s). Price marks may be delayed.`
        : `Market feed observations initializing or pending fresh cluster ticks (${(feedAgeMs / 1000).toFixed(1)}s).`,
      action: 'Checking cluster feed connection. Automated orders pause automatically until fresh ticks arrive.',
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="risk-banner-stack" role="region" aria-label="Active risk and safety alerts">
      {banners.map((b) => (
        <article key={b.id} className={`risk-banner-item banner-${b.level}`}>
          <div className="banner-icon-wrap">{b.icon}</div>
          <div className="banner-body">
            <header className="banner-header">
              <h3 className="banner-title">{b.title}</h3>
            </header>
            <p className="banner-reason">
              <b>Reason:</b> {b.reason}
            </p>
            <div className="banner-action-row">
              <span className="banner-action-text">
                <ArrowRight size={13} />
                <b>Allowed Action:</b> {b.action}
              </span>
              {b.buttons}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export default RiskBanners;
