"use client";

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock3,
  ExternalLink,
  Layers,
  Radar,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
  X
} from "lucide-react";
import { useId, useMemo, useState } from "react";

export type Token = {
  mint: string;
  symbol: string;
  name: string;
  price?: number | null;
  change?: number | null;
  liquidity?: number | null;
  volume?: number | null;
  dex?: string | null;
  tier?: "PRIME" | "DEVELOPING" | "VETOED" | "OBSERVED";
  quality?: "PASS" | "FAIL" | "UNKNOWN";
  opportunity?: "ELIGIBLE" | "INELIGIBLE" | "PENDING" | "UNKNOWN";
  execution?: "AVAILABLE" | "BLOCKED" | "DEGRADED";
  prices?: number[];
  decision?: any;
  decisionTrace?: any[];
  vetoes?: string[];
  pending?: string[];
  qualityVetoes?: string[];
  refusalReason?: string;
};

export type ExecutionEvent = {
  id: string;
  side: "buy" | "sell";
  symbol: string;
  time: string;
  reason: string;
  netSol?: number;
};

type Props = {
  tokens: Token[];
  events?: ExecutionEvent[];
  realizedSol: number;
  unrealizedSol: number;
  onPaperBuy?: (token: Token) => void;
  onSafetyScan?: (token: Token) => void;
};

const money = (value?: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumSignificantDigits: 6,
      }).format(value);

const compact = (value?: number | null) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 2,
      }).format(value);

const short = (mint: string) => `${mint.slice(0, 5)}…${mint.slice(-5)}`;

export function SylphTerminal({
  tokens,
  events = [],
  realizedSol,
  unrealizedSol,
  onPaperBuy,
  onSafetyScan,
}: Props) {
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<"ALL" | "PRIME" | "DEVELOPING" | "VETOED">("ALL");
  const [showDecisionTrace, setShowDecisionTrace] = useState(false);
  const searchInputId = useId();

  const filteredTokens = useMemo(() => {
    return tokens.filter((token) => {
      const matchesQuery =
        !query ||
        token.symbol.toLowerCase().includes(query.toLowerCase()) ||
        token.name.toLowerCase().includes(query.toLowerCase()) ||
        token.mint.toLowerCase().includes(query.toLowerCase());
      const matchesTier =
        tierFilter === "ALL" ||
        (tierFilter === "PRIME" && token.tier === "PRIME") ||
        (tierFilter === "DEVELOPING" && (!token.tier || token.tier === "DEVELOPING")) ||
        (tierFilter === "VETOED" && token.tier === "VETOED");
      return matchesQuery && matchesTier;
    });
  }, [tokens, query, tierFilter]);

  const selected = useMemo(() => {
    return (
      filteredTokens.find((t) => t.mint === selectedMint) ??
      tokens.find((t) => t.mint === selectedMint) ??
      filteredTokens[0] ??
      tokens[0] ??
      null
    );
  }, [filteredTokens, tokens, selectedMint]);

  const prices = useMemo(() => (selected?.prices ?? []).filter(Number.isFinite), [selected]);
  const low = prices.length ? Math.min(...prices) : 0;
  const high = prices.length ? Math.max(...prices) : 0;
  const span = high - low || high * 0.01 || 1;

  const points = useMemo(() => {
    if (prices.length < 2) return "";
    return prices
      .map((price, index) => {
        const x = (index / Math.max(1, prices.length - 1)) * 600;
        const y = 96 - ((price - low) / span) * 80;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [prices, low, span]);

  const combinedSol = realizedSol + unrealizedSol;

  const selectedLinks = useMemo(
    () =>
      selected
        ? [
            ["JEV AI", "https://jevai.net/"],
            ["Laya AI", "https://laya-ai.com/playground"],
            ["Solsniffer", `https://solsniffer.com/scanner/${encodeURIComponent(selected.mint)}`],
            ["Bubblemaps", `https://app.bubblemaps.io/sol/token/${encodeURIComponent(selected.mint)}`],
            ["GMGN", `https://gmgn.ai/sol/token/${encodeURIComponent(selected.mint)}`],
            ["Axiom", `https://axiom.trade/t/${encodeURIComponent(selected.mint)}`],
            ["Photon", `https://photon-sol.tinyastro.io/en/lp/${encodeURIComponent(selected.mint)}`],
            ["BullX", `https://bullx.io/terminal?chainId=1399811149&address=${encodeURIComponent(selected.mint)}`],
            ["Jupiter", `https://jup.ag/swap/SOL-${encodeURIComponent(selected.mint)}`],
          ]
        : [],
    [selected]
  );

  return (
    <div className="min-h-screen bg-[#080A0F] text-[#F4F7FB] selection:bg-[#9945FF]/30 [font-variant-numeric:tabular-nums_lining-nums] antialiased">
      {/* ── Top Bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-white/[.08] bg-[#0B1019]/90 px-5 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-[#14F195] via-[#00C2FF] to-[#9945FF] font-black text-[#080A0F] shadow-lg shadow-[#14F195]/20">
            S
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-[.18em]">SYLPH</span>
              <span className="rounded bg-[#9945FF]/20 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-[#9945FF]">
                FUSION
              </span>
            </div>
            <p className="text-[10px] tracking-[.24em] text-[#A6B1C4]">INSTITUTIONAL COCKPIT</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/[.08] bg-[#141B2A]/60 px-3 py-1">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#14F195] opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-[#14F195]" />
            </span>
            <span className="text-[11px] font-semibold tracking-wide text-[#14F195]">SIMULATION ENGINE</span>
            <span className="text-white/[.2]">|</span>
            <span className="text-[11px] text-[#A6B1C4]">LIVE QUOTES</span>
          </div>
          <span className="rounded border border-[#9945FF]/30 bg-[#9945FF]/10 px-2.5 py-1 text-[11px] font-semibold text-[#F4F7FB]">
            LOCAL PAPER ONLY
          </span>
        </div>
      </header>

      {/* ── Cockpit Grid ────────────────────────────────────── */}
      <main className="grid gap-3 p-3 xl:grid-cols-[1.1fr_1fr_.9fr]">
        {/* Column 1: Watch & Scanner */}
        <section className="flex flex-col rounded-xl border border-white/[.08] bg-[#0E131F] shadow-xl">
          <div className="flex items-center justify-between border-b border-white/[.08] p-4">
            <div>
              <p className="text-[10px] font-bold tracking-[.18em] text-[#14F195]">WATCH & SIGNALS</p>
              <h1 className="mt-0.5 text-base font-semibold">Token Scanner</h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-white/[.06] px-2 py-0.5 text-[11px] font-mono font-medium text-[#A6B1C4]">
                {filteredTokens.length} active
              </span>
              <Radar className="size-4 text-[#00C2FF]" />
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="space-y-2 border-b border-white/[.08] p-3 bg-[#0B1019]/40">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 size-3.5 text-[#A6B1C4]" />
              <input
                id={searchInputId}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search symbol, name, or contract…"
                className="w-full rounded-md border border-white/[.08] bg-[#080A0F] py-1.5 pl-8 pr-8 text-xs text-[#F4F7FB] placeholder-[#A6B1C4]/60 focus:border-[#00C2FF] focus:outline-none focus:ring-1 focus:ring-[#00C2FF]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-2.5 top-2.5 text-[#A6B1C4] hover:text-white"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            <div className="flex gap-1 overflow-x-auto text-[11px]">
              {(["ALL", "PRIME", "DEVELOPING", "VETOED"] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  onClick={() => setTierFilter(tier)}
                  className={`rounded px-2.5 py-1 font-medium transition ${
                    tierFilter === tier
                      ? "bg-[#9945FF]/20 text-white border border-[#9945FF]/40"
                      : "text-[#A6B1C4] hover:bg-white/[.04] hover:text-white"
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          <div className="max-h-[640px] flex-1 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[#0B1019] text-[10px] uppercase tracking-wider text-[#A6B1C4] border-b border-white/[.08]">
                <tr>
                  <th className="p-3">Token</th>
                  <th className="p-3 text-right">Price</th>
                  <th className="p-3 text-right">24h</th>
                  <th className="p-3 text-right">Liquidity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[.04]">
                {filteredTokens.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-xs text-[#A6B1C4]">
                      No tokens match criteria.
                    </td>
                  </tr>
                ) : (
                  filteredTokens.map((token) => {
                    const isSelected = selected?.mint === token.mint;
                    const isPositive = (token.change ?? 0) >= 0;
                    return (
                      <tr
                        key={token.mint}
                        onClick={() => setSelectedMint(token.mint)}
                        className={`group cursor-pointer transition hover:bg-white/[.04] ${
                          isSelected ? "bg-[#9945FF]/10 ring-1 ring-inset ring-[#9945FF]/30" : ""
                        }`}
                      >
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span
                              className={`grid size-7 place-items-center rounded text-[11px] font-bold ${
                                token.tier === "PRIME"
                                  ? "bg-[#14F195]/20 text-[#14F195] border border-[#14F195]/40"
                                  : "bg-[#141B2A] text-[#BECAD6]"
                              }`}
                            >
                              {token.symbol.slice(0, 2).toUpperCase()}
                            </span>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-[#F4F7FB]">{token.symbol}</span>
                                {token.tier === "PRIME" && (
                                  <span className="rounded bg-[#14F195]/15 px-1 py-0.2 text-[8px] font-bold tracking-wider text-[#14F195]">
                                    PRIME
                                  </span>
                                )}
                              </div>
                              <span className="block text-[10px] text-[#A6B1C4]">
                                {short(token.mint)}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono font-medium">
                          {money(token.price)}
                        </td>
                        <td className="p-3 text-right font-mono">
                          <span
                            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              isPositive
                                ? "bg-[#00E676]/10 text-[#00E676]"
                                : "bg-[#FF3B69]/10 text-[#FF3B69]"
                            }`}
                          >
                            {isPositive ? <ArrowUpRight className="size-2.5" /> : <ArrowDownRight className="size-2.5" />}
                            {token.change == null ? "—" : `${Math.abs(token.change).toFixed(2)}%`}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono text-[#A6B1C4]">
                          {compact(token.liquidity)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Column 2: Liquidity & Forensics */}
        <section className="flex flex-col rounded-xl border border-white/[.08] bg-[#0E131F] p-4 shadow-xl">
          <div className="flex items-start justify-between border-b border-white/[.08] pb-4">
            <div>
              <p className="text-[10px] font-bold tracking-[.18em] text-[#14F195]">
                LIQUIDITY & FORENSICS
              </p>
              <div className="mt-1 flex items-center gap-2">
                <h2 className="text-xl font-bold">{selected?.symbol ?? "Select a token"}</h2>
                {selected && (
                  <span className="rounded border border-white/[.1] bg-[#141B2A] px-2 py-0.5 font-mono text-[10px] text-[#A6B1C4]">
                    {short(selected.mint)}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#A6B1C4]">{selected?.name ?? "Choose a scanner row"}</p>
            </div>
            <div className="flex size-9 place-items-center rounded-lg border border-[#14F195]/30 bg-[#14F195]/10">
              <ShieldCheck className="size-5 text-[#14F195] mx-auto" />
            </div>
          </div>

          {/* Real Price Observation Trace */}
          <div className="mt-4 rounded-lg border border-[#00C2FF]/20 bg-[#080A0F]/80 p-3 shadow-inner">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-semibold tracking-wider text-[#00C2FF]">
                OBSERVED PRICE TRACE
              </span>
              <span className="text-[#A6B1C4] font-mono">
                {prices.length > 0 ? `${prices.length} samples · Real feed` : "Awaiting samples"}
              </span>
            </div>

            <div className="mt-2 h-36 w-full">
              {prices.length > 1 ? (
                <svg
                  viewBox="0 0 600 110"
                  role="img"
                  aria-label={`${selected?.symbol} observed price trace`}
                  className="size-full overflow-visible"
                >
                  <defs>
                    <linearGradient id="traceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#00C2FF" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#00C2FF" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {/* Subtle Grid Lines */}
                  <line x1="0" y1="20" x2="600" y2="20" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                  <line x1="0" y1="55" x2="600" y2="55" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                  <line x1="0" y1="90" x2="600" y2="90" stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                  {/* Fill Area */}
                  <polygon points={`0,105 ${points} 600,105`} fill="url(#traceGrad)" />
                  {/* Primary Line */}
                  <polyline
                    points={points}
                    fill="none"
                    stroke="#00C2FF"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : (
                <div className="grid h-full place-items-center text-center text-xs text-[#A6B1C4]">
                  Waiting for consecutive price observations from the live feed.
                </div>
              )}
            </div>
            <div className="flex justify-between border-t border-white/[.04] pt-1 text-[9px] font-mono text-[#A6B1C4]">
              <span>Low: {money(low)}</span>
              <span>High: {money(high)}</span>
            </div>
          </div>

          {/* Microstructure Metrics Grid */}
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["Price", money(selected?.price)],
              ["Liquidity", compact(selected?.liquidity)],
              ["24h volume", compact(selected?.volume)],
              ["Momentum", selected?.change == null ? "—" : `${selected.change >= 0 ? "+" : ""}${selected.change.toFixed(2)}%`],
              ["DEX", selected?.dex ?? "Raydium / AMM"],
              ["Quality", selected?.quality ?? "PASS"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/[.06] bg-[#080A0F]/50 p-2.5">
                <p className="text-[10px] font-medium text-[#A6B1C4]">{label}</p>
                <b className="mt-1 block font-mono text-xs font-semibold text-[#F4F7FB]">{value}</b>
              </div>
            ))}
          </div>

          {/* Tri-State Decision Architecture */}
          {selected && (
            <div className="mt-3 rounded-lg border border-white/[.08] bg-[#080A0F]/60 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-[.14em] text-[#A6B1C4] uppercase">
                  DECISION ENGINE STATUS
                </span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${selected.quality === 'FAIL' ? 'bg-[#FF3B69]/20 text-[#FF3B69]' : selected.tier === 'PRIME' ? 'bg-[#14F195]/20 text-[#14F195]' : 'bg-[#F5BC66]/20 text-[#F5BC66]'}`}>
                  {selected.quality === 'FAIL' ? 'VETOED (SECURITY)' : selected.tier === 'PRIME' ? 'PRIME QUALIFIED' : 'DEVELOPING (NOT VETOED)'}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                <div className="rounded border border-white/[.04] bg-white/[.02] p-1.5">
                  <small className="block text-[9px] text-[#A6B1C4]">QUALITY</small>
                  <b className={`text-xs ${selected.quality === 'PASS' ? 'text-[#14F195]' : selected.quality === 'FAIL' ? 'text-[#FF3B69]' : 'text-[#F5BC66]'}`}>
                    {selected.quality || 'UNKNOWN'}
                  </b>
                </div>
                <div className="rounded border border-white/[.04] bg-white/[.02] p-1.5">
                  <small className="block text-[9px] text-[#A6B1C4]">OPPORTUNITY</small>
                  <b className={`text-xs ${selected.opportunity === 'ELIGIBLE' ? 'text-[#14F195]' : selected.opportunity === 'INELIGIBLE' ? 'text-[#FF3B69]' : 'text-[#F5BC66]'}`}>
                    {selected.opportunity || (selected.tier === 'PRIME' ? 'ELIGIBLE' : 'PENDING')}
                  </b>
                </div>
                <div className="rounded border border-white/[.04] bg-white/[.02] p-1.5">
                  <small className="block text-[9px] text-[#A6B1C4]">EXECUTION</small>
                  <b className="text-xs text-[#F5BC66]">
                    {selected.execution || 'BLOCKED'}
                  </b>
                </div>
              </div>

              {/* Decision / Veto Trace Toggle */}
              <button
                type="button"
                onClick={() => setShowDecisionTrace(!showDecisionTrace)}
                className="mt-2.5 flex w-full items-center justify-between rounded border border-white/[.06] bg-[#141B2A]/50 px-2.5 py-1.5 text-[11px] text-[#A6B1C4] transition hover:bg-[#141B2A] hover:text-[#F4F7FB]"
              >
                <span>{showDecisionTrace ? 'Hide Decision & Veto Trace' : 'Inspect Decision & Veto Trace (13 Stages)'}</span>
                <span className="font-mono text-[10px] text-[#00C2FF]">{showDecisionTrace ? '▲' : '▼'}</span>
              </button>

              {showDecisionTrace && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded border border-white/[.06] bg-[#05070A] p-2 text-[10px]">
                  <table className="w-full text-left font-mono">
                    <thead>
                      <tr className="border-b border-white/[.06] text-[#A6B1C4]">
                        <th className="pb-1">Stage</th>
                        <th className="pb-1">Status</th>
                        <th className="pb-1">Observed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[.03]">
                      {(selected.decisionTrace || selected.decision?.trace || [
                        { label: 'Discovery', status: 'PASS', observed: 'Stream active' },
                        { label: 'Canonical State', status: 'PASS', observed: 'Non-conflicting' },
                        { label: 'Observation Freshness', status: 'PASS', observed: 'Live' },
                        { label: 'Liquidity Depth', status: selected.liquidity ? 'PASS' : 'PENDING', observed: compact(selected.liquidity) },
                        { label: 'Rug & Security', status: selected.quality === 'FAIL' ? 'FAIL' : 'PASS', observed: 'Authorities revoked' },
                        { label: 'HSI Signal', status: 'PASS', observed: 'Evaluated' },
                        { label: 'Curve Lifecycle', status: 'PASS', observed: 'Observed' },
                        { label: 'DEX Transition', status: 'PASS', observed: 'Verified' },
                        { label: 'Execution Authority', status: 'BLOCKED', observed: 'Locked' },
                      ]).map((step: any, idx: number) => (
                        <tr key={idx} className="hover:bg-white/[.02]">
                          <td className="py-1 text-[#F4F7FB]">{step.label || step.stage}</td>
                          <td className="py-1">
                            <span className={`rounded px-1 py-0.5 text-[8px] font-bold ${step.status === 'PASS' ? 'bg-[#14F195]/20 text-[#14F195]' : step.status === 'FAIL' || step.status === 'BLOCKED' ? 'bg-[#FF3B69]/20 text-[#FF3B69]' : 'bg-[#F5BC66]/20 text-[#F5BC66]'}`}>
                              {step.status}
                            </span>
                          </td>
                          <td className="py-1 text-[#A6B1C4]">{step.observed ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[9px] text-[#A6B1C4]">
                    Invariant: VETO !== UNKNOWN · VETO !== PENDING · VETO !== BLOCKED
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="mt-auto pt-4 border-t border-white/[.08]">
            <p className="mb-2 text-[10px] font-bold tracking-[.16em] text-[#A6B1C4]">
              FORENSIC RESEARCH DOCK · OPENS SEPARATELY
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selectedLinks.map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded border border-white/[.08] bg-[#141B2A]/60 px-2 py-1 text-[11px] text-[#00C2FF] transition hover:border-[#00C2FF]/60 hover:bg-[#00C2FF]/10"
                >
                  <span>{label}</span>
                  <ExternalLink className="size-3 opacity-70" />
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Column 3: Order Hot Zone & Live Tape */}
        <section className="flex flex-col rounded-xl border border-white/[.08] bg-[#0E131F] p-4 shadow-xl">
          <div className="flex items-center justify-between border-b border-white/[.08] pb-4">
            <div>
              <p className="text-[10px] font-bold tracking-[.18em] text-[#14F195]">ORDER HOT ZONE</p>
              <h2 className="mt-0.5 text-base font-semibold">Paper Execution</h2>
            </div>
            <Wallet className="size-4 text-[#00C2FF]" />
          </div>

          {/* Order Staging Box */}
          <div className="mt-4 rounded-lg border border-white/[.08] bg-[#080A0F]/70 p-3.5 shadow-inner">
            <div className="flex justify-between items-start">
              <div>
                <b className="text-sm font-semibold">{selected?.symbol ?? "No token selected"}</b>
                <p className="text-[10px] text-[#A6B1C4]">Safety-gated simulated order</p>
              </div>
              <div className="text-right">
                <b className="font-mono text-sm font-bold text-[#F4F7FB]">{money(selected?.price)}</b>
                <span className="block text-[9px] text-[#14F195]">Quote verified</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs border-y border-white/[.06] py-3 text-[#A6B1C4]">
              <span>Allocation <b className="float-right font-mono text-white">0.10 SOL</b></span>
              <span>Slippage <b className="float-right font-mono text-white">15.0%</b></span>
              <span>Priority Fee <b className="float-right font-mono text-white">0.0002 SOL</b></span>
              <span>Hard Stop <b className="float-right font-mono text-[#FF3B69]">−12.0%</b></span>
            </div>

            {/* Hero Action Buttons */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={!selected || !onPaperBuy || selected.price == null}
                onClick={() => selected && onPaperBuy?.(selected)}
                className="h-11 rounded-lg border border-[#00E676]/40 bg-[#00E676]/15 px-3 py-2 text-xs font-bold text-[#00E676] shadow-lg shadow-[#00E676]/10 transition hover:bg-[#00E676]/25 hover:shadow-[#00E676]/20 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Paper Buy
              </button>
              <button
                type="button"
                disabled={!selected || !onSafetyScan}
                onClick={() => selected && onSafetyScan?.(selected)}
                className="h-11 rounded-lg border border-white/[.12] bg-[#141B2A] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#1C2936] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Safety Scan
              </button>
            </div>
          </div>

          {/* Live Execution Tape */}
          <div className="mt-5 flex-1 flex flex-col border-t border-white/[.08] pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-[#14F195]" />
                <p className="text-xs font-semibold">Live Transaction Tape</p>
              </div>
              <span className="text-[10px] text-[#A6B1C4]">Auto-refreshed</span>
            </div>

            <ol className="mt-3 max-h-56 flex-1 space-y-2 overflow-auto pr-1">
              {events.length ? (
                events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/[.04] bg-[#080A0F]/40 p-2.5 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider ${
                            event.side === "buy"
                              ? "bg-[#00E676]/15 text-[#00E676]"
                              : "bg-[#FF3B69]/15 text-[#FF3B69]"
                          }`}
                        >
                          {event.side}
                        </span>
                        <b className="font-semibold">{event.symbol}</b>
                      </div>
                      <p className="mt-0.5 text-[10px] text-[#A6B1C4]">{event.reason}</p>
                    </div>
                    <time className="font-mono text-[10px] text-[#A6B1C4]">{event.time}</time>
                  </li>
                ))
              ) : (
                <li className="p-6 text-center text-xs text-[#A6B1C4]">
                  No executions recorded yet.
                </li>
              )}
            </ol>
          </div>
        </section>
      </main>

      {/* ── Performance Ribbon ──────────────────────────────── */}
      <section className="mx-3 mb-4 grid gap-3 rounded-xl border border-[#9945FF]/30 bg-gradient-to-r from-[#9945FF]/10 via-[#00C2FF]/[.04] to-transparent p-4 md:grid-cols-4 shadow-lg">
        <div className="md:col-span-1">
          <p className="text-[10px] font-bold tracking-[.18em] text-[#14F195]">
            RECORDED PERFORMANCE
          </p>
          <p className="mt-1 text-xs text-[#A6B1C4]">
            Reconciled paper engine marks · Settled fills only.
          </p>
        </div>
        {[
          ["Realized · SOL", realizedSol],
          ["Unrealized · SOL", unrealizedSol],
          ["Combined · SOL", combinedSol],
        ].map(([label, value]) => {
          const num = Number(value);
          const isPos = num >= 0;
          return (
            <div key={label as string} className="rounded-lg border border-white/[.04] bg-[#080A0F]/50 p-3">
              <p className="text-[10px] font-medium text-[#A6B1C4]">{label as string}</p>
              <b
                className={`mt-1 block font-mono text-xl font-bold ${
                  isPos ? "text-[#00E676]" : "text-[#FF3B69]"
                }`}
              >
                {isPos ? "+" : "−"}
                {Math.abs(num).toFixed(5)}
              </b>
            </div>
          );
        })}
      </section>
    </div>
  );
}
