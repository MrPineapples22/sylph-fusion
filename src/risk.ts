import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getExtensionTypes, getPermanentDelegate, getDefaultAccountState, getTransferFeeConfig, getTransferHook, unpackMint } from '@solana/spl-token';
import { httpJson } from './rpc.js';

export type RiskCheck = {
  mint: string;
  at: number;
  safe: boolean | null;
  score: number | null;
  rugged: boolean | null;
  authorities: { mint: string | null; freeze: string | null; status: 'revoked' | 'active' | 'unknown' };
  token2022: { enabled: boolean; transferFeeBps: number | null; feeAuthority: string | null; permanentDelegate: string | null; defaultFrozen: boolean | null; transferHook: string | null; extensions: string[] };
  liquidity: { state: 'burned' | 'locked' | 'removable' | 'bonding_curve' | 'unknown'; lockedPct: number | null; unlockAt: number | null; pools: number };
  holders: { top10Bps: number | null; top10Status: 'within-limit' | 'over-limit' | 'unknown' };
  bundling: { insiders: number | null; bundledPct: number | null; state: 'flagged' | 'clear' | 'unknown' };
  risks: { level: string; name: string; description: string }[];
  providers: { rugcheck: 'live' | 'unavailable'; solanaTracker: 'live' | 'unavailable'; rpc: 'live' | 'unavailable' };
  links: { rugcheck: string; tracker: string; solscan: string };
};

const key = (value: unknown) => typeof value === 'string' && value.length ? value : null;
const finite = (value: unknown) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const asRisk = (risks: unknown): { level: string; name: string; description: string }[] => Array.isArray(risks) ? risks.slice(0, 40).flatMap((r: any) => {
  if (!r || typeof r !== 'object') return [];
  return [{ level: String(r.level ?? 'info').toLowerCase(), name: String(r.name ?? 'Unnamed risk').slice(0, 160), description: String(r.description ?? '').slice(0, 500) }];
}) : [];

function base(mint: string): RiskCheck {
  return { mint, at: Date.now(), safe: null, score: null, rugged: null,
    authorities: { mint: null, freeze: null, status: 'unknown' },
    token2022: { enabled: false, transferFeeBps: null, feeAuthority: null, permanentDelegate: null, defaultFrozen: null, transferHook: null, extensions: [] },
    liquidity: { state: 'unknown', lockedPct: null, unlockAt: null, pools: 0 },
    holders: { top10Bps: null, top10Status: 'unknown' },
    bundling: { insiders: null, bundledPct: null, state: 'unknown' }, risks: [],
    providers: { rugcheck: 'unavailable', solanaTracker: 'unavailable', rpc: 'unavailable' },
    links: { rugcheck: `https://rugcheck.xyz/tokens/${encodeURIComponent(mint)}`, tracker: `https://www.solanatracker.io/rugcheck?token=${encodeURIComponent(mint)}`, solscan: `https://solscan.io/token/${encodeURIComponent(mint)}` } };
}

function applyReport(out: RiskCheck, report: any) {
  if (!report || typeof report !== 'object') return;
  out.providers.rugcheck = 'live';
  out.score = finite(report.score_normalised ?? report.score);
  out.rugged = typeof report.rugged === 'boolean' ? report.rugged : null;
  out.risks = asRisk(report.risks);
  const token = report.token ?? {};
  out.authorities.mint = key(token.mintAuthority ?? report.mintAuthority);
  out.authorities.freeze = key(token.freezeAuthority ?? report.freezeAuthority);
  out.authorities.status = !('mintAuthority' in token || 'mintAuthority' in report) || !('freezeAuthority' in token || 'freezeAuthority' in report) ? 'unknown' : out.authorities.mint === null && out.authorities.freeze === null ? 'revoked' : (out.authorities.mint || out.authorities.freeze ? 'active' : 'unknown');
  const fee = report.transferFee;
  if (fee && typeof fee === 'object') { out.token2022.transferFeeBps = finite(fee.pct) === null ? null : Math.round(Number(fee.pct) * 100); out.token2022.feeAuthority = key(fee.authority); }
  const ext = Array.isArray(report.token_extensions) ? report.token_extensions : [];
  out.token2022.extensions = ext.map((x: unknown) => String(x).slice(0, 80));
  const markets = Array.isArray(report.markets) ? report.markets : [];
  out.liquidity.pools = markets.length;
  const locked = markets.map((m: any) => finite(m.lp?.lpLockedPct ?? m.lpLockedPct ?? m.lp?.lpLockedPercent)).filter((x: number | null): x is number => x !== null);
  const burned = markets.some((m: any) => {
    const b = finite(m.lp?.lpBurnedPct ?? m.lp?.lpBurn ?? m.lpBurnedPct ?? m.lpBurn ?? (m.lp?.burned ? 100 : null));
    return b !== null && Number(b) >= 99;
  });
  const lockers = report.lockers && typeof report.lockers === 'object' ? Object.values(report.lockers as Record<string, any>) : [];
  const future = lockers.map((x: any) => finite(x?.unlockDate)).filter((x): x is number => x !== null && x > Date.now() / 1000);
  out.liquidity.lockedPct = locked.length ? Math.max(...locked) : null;
  out.liquidity.unlockAt = future.length ? Math.max(...future) * 1000 : null;
  const isPump = out.mint.toLowerCase().endsWith('pump') || markets.some((m: any) => String(m.protocol || m.dex || m.name || '').toLowerCase().includes('pump'));
  out.liquidity.state = burned ? 'burned' : (future.length > 0 || (out.liquidity.lockedPct !== null && out.liquidity.lockedPct >= 80)) ? 'locked' : isPump ? 'bonding_curve' : !markets.length ? 'unknown' : 'unknown';
  const holders = Array.isArray(report.topHolders) ? report.topHolders : [];
  const bps = holders.slice(0, 10).reduce((sum: number, h: any) => sum + (finite(h?.pct ?? h?.percentage) ?? 0) * 100, 0);
  out.holders.top10Bps = holders.length ? Math.round(bps) : null;
  out.holders.top10Status = out.holders.top10Bps === null ? 'unknown' : out.holders.top10Bps > 4000 ? 'over-limit' : 'within-limit';
  out.bundling.insiders = finite(report.graphInsidersDetected);
  const bundle = out.risks.find(r => /bundl|insider|cluster|sniper/i.test(r.name));
  out.bundling.bundledPct = bundle?.description.match(/(\d+(?:\.\d+)?)\s*%/)?.[1] ? Number(bundle.description.match(/(\d+(?:\.\d+)?)\s*%/)![1]) * 100 : null;
  out.bundling.state = bundle ? 'flagged' : 'clear';
  const dangerous = out.risks.some(r => /danger|critical/i.test(r.level));
  const isUnsafe = out.rugged === true || dangerous || out.authorities.freeze !== null || out.holders.top10Status === 'over-limit';
  const isVerifiedSafe = !out.rugged && out.authorities.status === 'revoked' && !dangerous && out.holders.top10Status === 'within-limit' && (['burned','locked'].includes(out.liquidity.state) || out.liquidity.state === 'bonding_curve');
  out.safe = isUnsafe ? false : isVerifiedSafe ? true : null;
}

export async function scanToken(mint: string, rpcUrl: string, rugUrl: string, trackerKey = ''): Promise<RiskCheck> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) throw new Error('Invalid Solana mint');
  const out = base(mint);
  const reports = await Promise.allSettled([
    httpJson<any>(`${rugUrl}/${encodeURIComponent(mint)}/report`, 8000),
    trackerKey ? httpJson<any>(`https://data.solanatracker.io/tokens/${encodeURIComponent(mint)}`, 8000, { headers: { 'x-api-key': trackerKey } }) : Promise.reject(new Error('Solana Tracker key not configured')),
    httpJson<any>(rpcUrl, 8000, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'base64', commitment: 'confirmed' }] }) }),
  ]);
  if (reports[0].status === 'fulfilled') applyReport(out, reports[0].value);
  if (reports[1].status === 'fulfilled') {
    out.providers.solanaTracker = 'live'; const risk = (reports[1].value as any)?.risk; if (risk) { out.score ??= finite(risk.score); out.risks = [...out.risks, ...asRisk(risk.risks)]; if (risk.rugged === true) out.rugged = true; }
  }
  if (reports[2].status === 'fulfilled') {
    const raw = (reports[2].value as any)?.result?.value; if (raw?.data?.[0] && raw.owner) {
      out.providers.rpc = 'live';
      try {
        const owner = new PublicKey(raw.owner); const info = { executable: false, owner, lamports: 0, data: Buffer.from(raw.data[0], 'base64'), rentEpoch: 0 }; const mintState = unpackMint(new PublicKey(mint), info, owner);
        out.authorities.mint = mintState.mintAuthority?.toBase58() ?? null; out.authorities.freeze = mintState.freezeAuthority?.toBase58() ?? null;
        out.authorities.status = out.authorities.mint === null && out.authorities.freeze === null ? 'revoked' : 'active';
        out.token2022.enabled = owner.equals(TOKEN_2022_PROGRAM_ID); out.token2022.extensions = getExtensionTypes(mintState.tlvData).map((x: unknown) => String(x));
        if (out.token2022.enabled) {
          const fee = getTransferFeeConfig(mintState); out.token2022.transferFeeBps = fee?.newerTransferFee.transferFeeBasisPoints ?? null; out.token2022.feeAuthority = fee?.transferFeeConfigAuthority?.toBase58() ?? null;
          out.token2022.permanentDelegate = getPermanentDelegate(mintState)?.delegate.toBase58() ?? null; out.token2022.defaultFrozen = getDefaultAccountState(mintState)?.state === 2;
          out.token2022.transferHook = getTransferHook(mintState)?.programId.toBase58() ?? null;
        }
      } catch { out.providers.rpc = 'unavailable'; }
    }
  }
  if (out.token2022.enabled && (out.token2022.transferFeeBps ?? 0) > 0) out.risks.push({ level: 'danger', name: 'Token-2022 transfer fee enabled', description: 'Transfers can be charged a non-zero fee.' });
  if (out.token2022.permanentDelegate) out.risks.push({ level: 'danger', name: 'Token-2022 permanent delegate', description: 'An authority can transfer or burn holder tokens.' });
  if (out.token2022.defaultFrozen) out.risks.push({ level: 'danger', name: 'Token-2022 default frozen', description: 'New accounts may be frozen by default.' });
  if (out.token2022.transferHook) out.risks.push({ level: 'warning', name: 'Token-2022 transfer hook', description: 'Transfers invoke an external program.' });
  // Missing evidence is unknown, never a pass; final checks include RPC extensions.
  const dangerous = out.rugged === true || out.authorities.freeze !== null || out.holders.top10Status === 'over-limit' || out.risks.some(r => /danger|critical/i.test(r.level)) || !!out.token2022.transferHook;
  out.safe = dangerous ? false : out.providers.rpc === 'live' && out.providers.rugcheck === 'live' && out.authorities.status === 'revoked' && out.holders.top10Status === 'within-limit' && (['burned','locked'].includes(out.liquidity.state) || out.liquidity.state === 'bonding_curve') ? true : null;
  return out;
}

/**
 * Hard Filtration & Anti-Sniper Baseline Guard (AGENTS.md)
 * 1. Tokens at age < 10s must establish >= 3 unique buyers to avoid 0-second dev dumps (>80% probability).
 * 2. DEX vs Bonding Curve Asymmetry: len(traders) < 3 check must be bypassed for mature DEX tokens (isDex || txs >= 10).
 */
export function checkAntiSniperAndDexAsymmetry(params: {
  ageMs: number;
  uniqueBuyers: number;
  isDex?: boolean;
  txs?: number;
}): { allowed: boolean; reason?: string } {
  const { ageMs, uniqueBuyers, isDex, txs } = params;
  const isMatureDex = Boolean(isDex || (typeof txs === 'number' && txs >= 10));

  // Anti-sniper baseline: Tokens < 10s must have at least 3 unique buyers
  if (!isMatureDex && ageMs < 10_000 && uniqueBuyers < 3) {
    return {
      allowed: false,
      reason: 'ANTI_SNIPER_BASELINE_NOT_MET: Token age < 10s requires >= 3 unique buyers before entry',
    };
  }

  // Bonding curve illiquidity check: If not mature DEX, require >= 3 unique buyers
  if (!isMatureDex && uniqueBuyers < 3) {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_BUYER_ACCUMULATION: Bonding curve requires >= 3 unique buyers',
    };
  }

  return { allowed: true };
}
