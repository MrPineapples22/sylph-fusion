import { readJson } from './read-json.js';
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Activity, ArrowUpRight } from 'lucide-react';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 5,
});

const format = (n) => (n == null ? 'Unknown' : money.format(n));

export default React.memo(function Astra() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let stopped = false;
    let timer;
    const controller = new AbortController();

    async function poll() {
      try {
        const d = await readJson('/astra/basket', controller.signal);
        if (!stopped) {
          setData(d);
          setError('');
        }
      } catch (e) {
        if (!stopped) setError(e.message);
      } finally {
        if (!stopped) timer = setTimeout(poll, 2000);
      }
    }

    poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  const links = [
    ['TypeSafe hosted Jev', 'https://typesafe.ai/blog/introducing-system-one-models-and-jev'],
    ['Laya AI Playground', 'https://laya-ai.com/playground'],
    ['Solsniffer', 'https://solsniffer.com/'],
    ['Rugcheck', 'https://rugcheck.xyz/'],
    ['DEX Screener', 'https://dexscreener.com/solana'],
    ['Birdeye', 'https://birdeye.so/'],
    ['GeckoTerminal', 'https://www.geckoterminal.com/solana/pools'],
    ['GMGN', 'https://gmgn.ai/'],
    ['Jupiter', 'https://jup.ag/'],
    ['Meteora', 'https://www.meteora.ag/'],
    ['Lifinity', 'https://lifinity.io/dashboard'],
  ];

  return (
    <section className="astra-panel" aria-label="Astra risk and volume basket">
      <div className="panel-heading">
        <h2>
          <ShieldCheck size={17} />
          ASTRA · PAPER ONLY
        </h2>
        <span className="pill">AUTO-SIMULATE OFF · GATED</span>
      </div>

      <div className="astra-rules">
        1 SOL virtual starting capital · 2% maximum modeled risk · 7% trailing stop · TP +15% / +35% / +75%
      </div>

      <p className="live-note">
        Top 10 observed pools by trailing 1h volume — global ranking unverified. Raydium / Meteora / Orca / Pump.fun / PumpSwap. Basket recalculated every 2 seconds.
      </p>

      <div className="astra-carousel" role="region" aria-label="Astra Volume Basket Pairs">
        {data?.pairs?.map((p) => {
          const isPositive = p.change5m != null && p.change5m >= 0;
          return (
            <article key={p.pair}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <small className="font-mono">#{p.rank} · {p.dex}</small>
                <span className="font-mono text-[9px]" style={{ background: 'rgba(153,69,255,0.15)', color: '#D6B8FF', padding: '1px 5px', borderRadius: '3px' }}>
                  OBSERVED
                </span>
              </div>
              <h3>{p.symbol}</h3>
              <b className="font-mono">{format(p.price)}</b>
              <p className="font-mono">
                1h {format(p.volume1h)} · 5m{' '}
                <span className={p.change5m == null ? '' : isPositive ? 'positive' : 'negative'}>
                  {p.change5m == null ? 'Unknown' : `${isPositive ? '+' : ''}${p.change5m.toFixed(2)}%`}
                </span>
              </p>
              <small className="font-mono text-muted">
                5m vol / LP: {p.volumeLiquidity == null ? 'Unknown' : p.volumeLiquidity.toFixed(3)} · Count imbalance: {p.countImbalance == null ? 'Unknown' : p.countImbalance.toFixed(2)}
              </small>
              <ul>
                <li>
                  <b>Trigger:</b> Watch only; entry blocked.
                </li>
                <li>
                  <b>Risk:</b> Unscored / 10 {p.liquidity == null || p.liquidity < 20000 ? '· ⚠ Low or unknown LP depth' : ''}
                </li>
                <li>
                  <b>Invalidation:</b> {format(p.price * 0.93)} (7% reference, no recommendation)
                </li>
              </ul>
            </article>
          );
        })}
      </div>

      <div className="astra-research">
        <div className="eyebrow">LIVE TOKEN RESEARCH &amp; FORENSICS</div>
        <div>
          {links.map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noopener noreferrer">
              <span>{label}</span>
              <ArrowUpRight size={12} />
            </a>
          ))}
        </div>
      </div>

      <div className="astra-block font-mono" role="status">
        <Activity size={14} />
        <span>{error || data?.reason || 'Loading volume basket. Orders remain blocked.'}</span>
      </div>

      <p className="live-note">
        True volume OFI, token tax changes, LP lock status, mint/freeze authorities, X/Telegram calls, and wallet conviction are unknown. Missing signals are not fabricated.
      </p>
    </section>
  );
});
