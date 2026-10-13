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
  const [quoteByMint, setQuoteByMint] = useState({});
  const [quotingMint, setQuotingMint] = useState('');
  const [mayanQuote, setMayanQuote] = useState(null);
  const [isQuotingMayan, setIsQuotingMayan] = useState(false);

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

  const requestRoundTripQuote = async (mint) => {
    if (!mint || quotingMint) return;
    setQuotingMint(mint);
    setQuoteByMint(current => ({ ...current, [mint]: null }));
    try {
      const response = await fetch(`/api/research/jupiter-roundtrip?mint=${encodeURIComponent(mint)}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      const result = await response.json();
      setQuoteByMint(current => ({ ...current, [mint]: result }));
    } catch (e) {
      setQuoteByMint(current => ({ ...current, [mint]: { status: 'UNAVAILABLE', errorCode: e?.name === 'TimeoutError' ? 'JUPITER_UI_TIMEOUT' : 'JUPITER_UI_REQUEST_FAILED' } }));
    } finally {
      setQuotingMint('');
    }
  };

  const requestMayanBridgeQuote = async () => {
    if (isQuotingMayan) return;
    setIsQuotingMayan(true);
    setMayanQuote(null);
    try {
      const response = await fetch('/api/research/mayan-bridge-quote', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      const result = await response.json();
      setMayanQuote(result);
    } catch (e) {
      setMayanQuote({ status: 'UNAVAILABLE', errorCode: e?.name === 'TimeoutError' ? 'MAYAN_UI_TIMEOUT' : 'MAYAN_UI_REQUEST_FAILED' });
    } finally {
      setIsQuotingMayan(false);
    }
  };

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
    ['Mayan', 'https://mayan.finance/'],
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
        1 SOL virtual starting capital · 2% max modeled risk · Breakeven lock at +8% · Moonshot ratchets 2x/5x/10x/20x/50x/100x (+10,000% PnL)
      </div>

      <div className="astra-block" style={{ marginTop: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }} aria-label="Mayan cross-chain quote research">
        <div style={{ flex: '1 1 260px' }}>
          <b>MAYAN · SOLANA → BASE</b>
          <small style={{ display: 'block', marginTop: '4px' }}>Quote the configured paper size from WSOL to Base USDC. Routes are ordered by expected output; compare minimum output and ETA. Indicative bridge research only.</small>
          {mayanQuote?.status === 'QUOTED' && <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '9px' }}>
            {mayanQuote.routes.map((route) => <span key={route.type} className="pill" title={`${route.slippageBps} bps quoted slippage`}>
              {route.type} · {format(Number(route.expectedAmountOut))} expected · {format(Number(route.minimumAmountOut))} minimum · {route.etaSeconds}s
            </span>)}
          </div>}
          {mayanQuote?.status === 'UNAVAILABLE' && <small role="status" style={{ display: 'block', color: '#F59E0B', marginTop: '7px' }}>
            Mayan quote unavailable · {mayanQuote.errorCode || 'UNKNOWN'}
          </small>}
          {mayanQuote?.status === 'QUOTED' && <small style={{ display: 'block', marginTop: '6px' }}>{mayanQuote.note}</small>}
        </div>
        <button type="button" className="op-button" disabled={isQuotingMayan} onClick={requestMayanBridgeQuote}>
          {isQuotingMayan ? 'Requesting Mayan routes…' : 'Quote Mayan bridge routes'}
        </button>
      </div>

      <p className="live-note">
        Top 10 observed pools by trailing 1h volume — global ranking unverified. Discrete Convex Kelly sizing with 45% SPIE friction ceiling. Raydium / Meteora / Orca / Pump.fun / PumpSwap. Basket recalculated every 2 seconds.
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
              <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                <button type="button" className="op-button" disabled={!p.mint || Boolean(quotingMint)} onClick={() => requestRoundTripQuote(p.mint)}>
                  {quotingMint === p.mint ? 'Requesting quote…' : 'Check Jupiter round trip'}
                </button>
                <small className="font-mono text-muted" style={{ display: 'block', marginTop: '5px' }}>Quote only · no wallet, transaction, or order submission</small>
                {quoteByMint[p.mint] && <div role="status" aria-live="polite" style={{ marginTop: '7px', fontSize: '11px' }}>
                  {quoteByMint[p.mint].status === 'QUOTED' ? <>
                    <b style={{ color: quoteByMint[p.mint].roundTripDeltaBps >= 0 ? '#F59E0B' : '#FF3B69' }}>
                      Quote-implied round-trip Δ {quoteByMint[p.mint].roundTripDeltaBps >= 0 ? '+' : ''}{quoteByMint[p.mint].roundTripDeltaBps.toFixed(1)} bps
                    </b>
                    <small className="font-mono text-muted" style={{ display: 'block', marginTop: '3px' }}>
                      Buy {quoteByMint[p.mint].buyOutputRaw} raw units · sell {quoteByMint[p.mint].sellOutputLamports} lamports · {quoteByMint[p.mint].buyRouter}/{quoteByMint[p.mint].sellRouter}
                    </small>
                    <small className="font-mono text-muted" style={{ display: 'block', marginTop: '2px' }}>
                      Quotes {((quoteByMint[p.mint].roundTripWindowMs || 0) / 1000).toFixed(1)}s apart · sell quote age {Math.max(0, Date.now() - quoteByMint[p.mint].sellQuotedAt) < 1000 ? 'under 1s' : `${Math.floor((Date.now() - quoteByMint[p.mint].sellQuotedAt) / 1000)}s`}
                    </small>
                  </> : <b style={{ color: '#F59E0B' }}>{quoteByMint[p.mint].status}: {quoteByMint[p.mint].errorCode || 'SELL_QUOTE_UNAVAILABLE'}</b>}
                  <small className="font-mono text-muted" style={{ display: 'block', marginTop: '3px' }}>Sequential indicative quotes; not a fill or profit forecast.</small>
                </div>}
              </div>
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
