"use client";

import { Activity, BarChart3, ExternalLink, Radar, ShieldCheck, Wallet } from "lucide-react";
import { useMemo, useState } from "react";

export type Token = {
  mint: string;
  symbol: string;
  name: string;
  price?: number | null;
  change?: number | null;
  liquidity?: number | null;
  volume?: number | null;
  dex?: string | null;
  prices?: number[];
};

type Props = {
  tokens: Token[];
  events?: { id: string; side: "buy" | "sell"; symbol: string; time: string; reason: string }[];
  realizedSol: number;
  unrealizedSol: number;
  onPaperBuy?: (token: Token) => void;
  onSafetyScan?: (token: Token) => void;
};

const money = (value?: number | null) => value == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 5 }).format(value);
const short = (mint: string) => `${mint.slice(0, 5)}…${mint.slice(-5)}`;

export function SylphTerminal({ tokens, events = [], realizedSol, unrealizedSol, onPaperBuy, onSafetyScan }: Props) {
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const selected = tokens.find(token => token.mint === selectedMint) ?? tokens[0] ?? null;
  const prices = (selected?.prices ?? []).filter(Number.isFinite);
  const low = Math.min(...prices), high = Math.max(...prices);
  const points = prices.map((price, index) => `${index / Math.max(1, prices.length - 1) * 600},${100 - (price - low) / (high - low || 1) * 85}`).join(" ");
  const combined = realizedSol + unrealizedSol;
  const selectedLinks = useMemo(() => selected ? [
    ["Solsniffer", `https://solsniffer.com/scanner/${encodeURIComponent(selected.mint)}`],
    ["Bubblemaps", `https://app.bubblemaps.io/sol/token/${encodeURIComponent(selected.mint)}`],
    ["GMGN", `https://gmgn.ai/sol/token/${encodeURIComponent(selected.mint)}`],
    ["Axiom", `https://axiom.trade/t/${encodeURIComponent(selected.mint)}`],
    ["Photon", `https://photon-sol.tinyastro.io/en/lp/${encodeURIComponent(selected.mint)}`],
    ["BullX", `https://bullx.io/terminal?chainId=1399811149&address=${encodeURIComponent(selected.mint)}`],
    ["Jupiter", `https://jup.ag/swap/SOL-${encodeURIComponent(selected.mint)}`],
  ] : [], [selected]);

  return <div className="min-h-screen bg-[#080A0F] text-[#F4F7FB] [font-variant-numeric:tabular-nums]">
    <header className="flex items-center justify-between border-b border-white/[.08] bg-[#0B1019]/95 px-5 py-3">
      <div className="flex items-center gap-3"><div className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-[#14F195] via-[#00C2FF] to-[#9945FF] font-black text-[#080A0F]">S</div><div><p className="text-sm font-bold tracking-[.16em]">SYLPH</p><p className="text-[10px] tracking-[.22em] text-[#A6B1C4]">FUSION TERMINAL</p></div></div>
      <div className="flex items-center gap-4 text-xs text-[#A6B1C4]"><span className="rounded border border-[#9945FF]/30 px-2 py-1 text-[#14F195]">PAPER · LIVE QUOTES</span><span>Local engine</span></div>
    </header>
    <main className="grid gap-3 p-3 xl:grid-cols-[1.05fr_1fr_.86fr]">
      <section className="rounded-xl border border-white/[.08] bg-[#0E131F]">
        <div className="flex items-center justify-between border-b border-white/[.08] p-4"><div><p className="text-[10px] font-bold tracking-[.16em] text-[#14F195]">WATCH & SIGNALS</p><h1 className="mt-1 text-base font-semibold">Token scanner</h1></div><Radar className="size-4 text-[#00C2FF]" /></div>
        <div className="max-h-[680px] overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-[#0B1019] text-[10px] uppercase tracking-wider text-[#A6B1C4]"><tr><th className="p-3">Token</th><th className="p-3 text-right">Price</th><th className="p-3 text-right">24h</th><th className="p-3 text-right">Liquidity</th></tr></thead><tbody>{tokens.map(token => <tr key={token.mint} onClick={() => setSelectedMint(token.mint)} className={`cursor-pointer border-t border-white/[.06] transition hover:bg-[#9945FF]/[.07] ${selected?.mint === token.mint ? "bg-[#9945FF]/[.10]" : ""}`}><td className="p-3"><button aria-pressed={selected?.mint === token.mint} onClick={() => setSelectedMint(token.mint)} className="rounded px-1 py-2 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00C2FF]">{token.symbol}</button><span className="block text-[10px] text-[#A6B1C4]">{token.name} · {short(token.mint)}</span></td><td className="p-3 text-right">{money(token.price)}</td><td className={`p-3 text-right ${token.change && token.change < 0 ? "text-[#FF3B69]" : "text-[#00E676]"}`}>{token.change == null ? "—" : `${token.change.toFixed(2)}%`}</td><td className="p-3 text-right text-[#A6B1C4]">{money(token.liquidity)}</td></tr>)}</tbody></table></div>
      </section>
      <section className="rounded-xl border border-[#9945FF]/20 bg-[#0E131F] p-4">
        <div className="flex items-start justify-between"><div><p className="text-[10px] font-bold tracking-[.16em] text-[#14F195]">LIQUIDITY & FORENSICS</p><h2 className="mt-1 text-lg font-semibold">{selected?.symbol ?? "Select a token"}</h2><p className="text-xs text-[#A6B1C4]">{selected ? `${selected.name} · ${short(selected.mint)}` : "Choose a scanner row"}</p></div><ShieldCheck className="size-5 text-[#14F195]" /></div>
        <div className="mt-5 h-40 rounded-lg border border-[#00C2FF]/20 bg-gradient-to-b from-[#00C2FF]/10 to-transparent"><div className="p-3 text-[10px] text-[#00C2FF]">OBSERVED PRICE · supplied samples</div>{prices.length > 1 ? <svg viewBox="0 0 600 110" role="img" aria-label={`${selected?.symbol} observed price trace`} className="h-24 w-full"><polyline points={points} fill="none" stroke="#00C2FF" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg> : <p className="px-3 text-xs text-[#A6B1C4]">Waiting for at least two price observations.</p>}</div>
        <div className="mt-3 grid grid-cols-3 gap-2">{[["Price", money(selected?.price)], ["Liquidity", money(selected?.liquidity)], ["24h volume", money(selected?.volume)], ["Momentum", selected?.change == null ? "—" : `${selected.change.toFixed(2)}%`], ["DEX", selected?.dex ?? "—"], ["Risk", "Run scan"]].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[.08] bg-[#080A0F]/60 p-2"><p className="text-[10px] text-[#A6B1C4]">{label}</p><b className="mt-1 block text-xs">{value}</b></div>)}</div>
        <div className="mt-4"><p className="mb-2 text-[10px] font-bold tracking-[.14em] text-[#A6B1C4]">RESEARCH DOCK · OPENS SEPARATELY</p><div className="flex flex-wrap gap-2">{selectedLinks.map(([label, href]) => <a key={label} href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-white/[.08] px-2 py-1 text-[11px] text-[#00C2FF] hover:border-[#00C2FF]/60"><span>{label}</span><ExternalLink className="size-3" /></a>)}</div></div>
      </section>
      <section className="rounded-xl border border-white/[.08] bg-[#0E131F] p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] font-bold tracking-[.16em] text-[#14F195]">ORDER HOT ZONE</p><h2 className="mt-1 text-base font-semibold">Paper execution</h2></div><Wallet className="size-4 text-[#00C2FF]" /></div><div className="mt-5 rounded-lg border border-white/[.08] bg-[#080A0F]/60 p-3"><div className="flex justify-between"><div><b>{selected?.symbol ?? "No token"}</b><p className="text-[10px] text-[#A6B1C4]">Safety-gated simulator</p></div><b>{money(selected?.price)}</b></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs text-[#A6B1C4]"><span>Allocation <b className="float-right text-white">0.10000 SOL</b></span><span>Slippage <b className="float-right text-white">15.0%</b></span><span>Priority <b className="float-right text-white">0.00000</b></span><span>Stop <b className="float-right text-[#FF3B69]">−12.0%</b></span></div><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={!selected || !onPaperBuy || selected.price == null} onClick={() => selected && onPaperBuy?.(selected)} className="rounded-lg border border-[#00E676]/40 bg-[#00E676]/10 px-3 py-2 text-xs font-bold text-[#00E676]">Paper buy</button><button disabled={!selected || !onSafetyScan} onClick={() => selected && onSafetyScan?.(selected)} className="rounded-lg border border-white/[.1] bg-[#141B2A] px-3 py-2 text-xs font-bold text-white">Safety scan</button></div></div><div className="mt-5 border-t border-white/[.08] pt-4"><div className="flex items-center gap-2"><Activity className="size-4 text-[#14F195]" /><p className="text-xs font-semibold">Live transaction tape</p></div><p className="mt-2 text-[11px] text-[#A6B1C4]">Activity supplied by the connected engine.</p><ol className="mt-3 max-h-64 overflow-auto">{events.length ? events.map(event => <li key={event.id} className="flex justify-between gap-3 border-t border-white/10 py-3 text-xs"><div><b className={event.side === "buy" ? "text-[#00E676]" : "text-[#FF3B69]"}>{event.side.toUpperCase()} · {event.symbol}</b><p className="mt-1 text-[#A6B1C4]">{event.reason}</p></div><time className="text-[#A6B1C4]">{event.time}</time></li>) : <li className="py-3 text-xs text-[#A6B1C4]">No executions recorded.</li>}</ol></div></section>
    </main>
    <section className="mx-3 mb-3 grid gap-3 rounded-xl border border-[#9945FF]/30 bg-gradient-to-r from-[#9945FF]/10 to-[#00C2FF]/[.04] p-4 md:grid-cols-4"><div className="md:col-span-1"><p className="text-[10px] font-bold tracking-[.16em] text-[#14F195]">RECORDED PERFORMANCE</p><p className="mt-1 text-xs text-[#A6B1C4]">Only settled engine fills are profit.</p></div>{[["Realized · SOL",realizedSol],["Unrealized · SOL",unrealizedSol],["Combined · SOL",combined]].map(([label,value]) => <div key={label as string}><p className="text-[10px] text-[#A6B1C4]">{label as string}</p><b className={`mt-1 block text-xl ${Number(value) < 0 ? "text-[#FF3B69]" : "text-[#00E676]"}`}>{Number(value).toFixed(5)}</b></div>)}</section>
  </div>;
}
