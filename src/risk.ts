import { PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, ExtensionType, TRANSFER_FEE_CONFIG_SIZE, DEFAULT_ACCOUNT_STATE_SIZE, PERMANENT_DELEGATE_SIZE, TRANSFER_HOOK_SIZE, getExtensionTypes, getTypeLen, isMintExtension, getPermanentDelegate, getDefaultAccountState, getTransferFeeConfig, getTransferHook, unpackMint } from '@solana/spl-token';
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

function validateToken2022MintTlvData(tlvData: Buffer): Buffer {
  const seen = new Set<number>();
  let offset = 0;
  let usedEnd = tlvData.length;
  while (offset < tlvData.length) {
    if (tlvData.length - offset < 2) {
      // Token-2022 permits one trailing byte while reallocating account data.
      usedEnd = offset;
      break;
    }
    const extensionType = tlvData.readUInt16LE(offset);
    if (extensionType === ExtensionType.Uninitialized) {
      // The canonical parser treats this two-byte marker as the end; the
      // remaining allocated bytes may be unused account space.
      usedEnd = offset;
      break;
    }
    if (tlvData.length - offset < 4) throw new Error('TOKEN_2022_MINT_TLV_HEADER_TRUNCATED');
    const extensionLength = tlvData.readUInt16LE(offset + 2);
    if (seen.has(extensionType)) throw new Error('TOKEN_2022_MINT_TLV_DUPLICATE_EXTENSION');
    if (!isMintExtension(extensionType as ExtensionType)) throw new Error('TOKEN_2022_ACCOUNT_EXTENSION_IN_MINT');
    seen.add(extensionType);
    const valueStart = offset + 4;
    const valueEnd = valueStart + extensionLength;
    if (valueEnd > tlvData.length) throw new Error('TOKEN_2022_MINT_TLV_VALUE_TRUNCATED');

    let expectedLength: number | null;
    try {
      expectedLength = extensionType === ExtensionType.TokenMetadata ? null : getTypeLen(extensionType as ExtensionType);
    } catch {
      throw new Error('TOKEN_2022_MINT_EXTENSION_UNKNOWN');
    }
    // Keep explicit size constants as a guard against changes in SPL's
    // exported type-length table for the fields decoded below.
    const decoderLength = extensionType === ExtensionType.TransferFeeConfig ? TRANSFER_FEE_CONFIG_SIZE
      : extensionType === ExtensionType.DefaultAccountState ? DEFAULT_ACCOUNT_STATE_SIZE
      : extensionType === ExtensionType.PermanentDelegate ? PERMANENT_DELEGATE_SIZE
      : extensionType === ExtensionType.TransferHook ? TRANSFER_HOOK_SIZE
      : expectedLength;
    if (decoderLength !== null && extensionLength !== decoderLength) {
      throw new Error('TOKEN_2022_MINT_TLV_EXTENSION_LENGTH_INVALID');
    }
    offset = valueEnd;
  }
  return tlvData.subarray(0, usedEnd);
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
  const isVerifiedSafe = out.rugged === false && out.authorities.status === 'revoked' && !dangerous && out.holders.top10Status === 'within-limit' && (['burned','locked'].includes(out.liquidity.state) || out.liquidity.state === 'bonding_curve');
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
      try {
        const owner = new PublicKey(raw.owner);
        if (!owner.equals(TOKEN_PROGRAM_ID) && !owner.equals(TOKEN_2022_PROGRAM_ID)) {
          out.authorities.status = 'unknown';
          out.risks.push({ level: 'warning', name: 'Unsupported mint program owner', description: 'RPC returned a mint account owned by neither the Token Program nor Token-2022; token authority evidence remains unknown.' });
        } else {
          const info = { executable: false, owner, lamports: 0, data: Buffer.from(raw.data[0], 'base64'), rentEpoch: 0 }; const unpackedMint = unpackMint(new PublicKey(mint), info, owner);
          const mintState = owner.equals(TOKEN_2022_PROGRAM_ID)
            ? { ...unpackedMint, tlvData: validateToken2022MintTlvData(unpackedMint.tlvData) }
            : unpackedMint;
          out.providers.rpc = 'live';
          out.authorities.mint = mintState.mintAuthority?.toBase58() ?? null; out.authorities.freeze = mintState.freezeAuthority?.toBase58() ?? null;
          out.authorities.status = out.authorities.mint === null && out.authorities.freeze === null ? 'revoked' : 'active';
          out.token2022.enabled = owner.equals(TOKEN_2022_PROGRAM_ID); out.token2022.extensions = getExtensionTypes(mintState.tlvData).map((x: unknown) => String(x));
          if (out.token2022.enabled) {
            const inspected = new Set([ExtensionType.TransferFeeConfig, ExtensionType.DefaultAccountState, ExtensionType.PermanentDelegate, ExtensionType.TransferHook, ExtensionType.MetadataPointer, ExtensionType.TokenMetadata]);
            if (getExtensionTypes(mintState.tlvData).some((extension: ExtensionType) => !inspected.has(extension))) {
              out.risks.push({ level: 'danger', name: 'Unreviewed Token-2022 extension', description: 'A valid mint extension is outside the risk scanner’s reviewed extension policy.' });
            }
          }
          if (out.token2022.enabled) {
            const fee = getTransferFeeConfig(mintState); out.token2022.transferFeeBps = fee?.newerTransferFee.transferFeeBasisPoints ?? null; out.token2022.feeAuthority = fee?.transferFeeConfigAuthority?.toBase58() ?? null;
            out.token2022.permanentDelegate = getPermanentDelegate(mintState)?.delegate.toBase58() ?? null; out.token2022.defaultFrozen = getDefaultAccountState(mintState)?.state === 2;
            out.token2022.transferHook = getTransferHook(mintState)?.programId.toBase58() ?? null;
          }
        }
      } catch {
        out.providers.rpc = 'unavailable';
        out.authorities.status = 'unknown';
        out.risks.push({ level: 'warning', name: 'Invalid mint account data', description: 'RPC token mint bytes failed account or Token-2022 extension validation; authority evidence remains unknown.' });
      }
    }
  }
  if (out.token2022.enabled && (out.token2022.transferFeeBps ?? 0) > 0) out.risks.push({ level: 'danger', name: 'Token-2022 transfer fee enabled', description: 'Transfers can be charged a non-zero fee.' });
  if (out.token2022.permanentDelegate) out.risks.push({ level: 'danger', name: 'Token-2022 permanent delegate', description: 'An authority can transfer or burn holder tokens.' });
  if (out.token2022.defaultFrozen) out.risks.push({ level: 'danger', name: 'Token-2022 default frozen', description: 'New accounts may be frozen by default.' });
  if (out.token2022.transferHook) out.risks.push({ level: 'warning', name: 'Token-2022 transfer hook', description: 'Transfers invoke an external program.' });
  // Missing evidence is unknown, never a pass; final checks include RPC extensions.
  const dangerous = out.rugged === true || out.authorities.freeze !== null || out.holders.top10Status === 'over-limit' || out.risks.some(r => /danger|critical/i.test(r.level)) || !!out.token2022.transferHook;
  out.safe = dangerous ? false : out.providers.rpc === 'live' && out.providers.rugcheck === 'live' && out.rugged === false && out.authorities.status === 'revoked' && out.holders.top10Status === 'within-limit' && (['burned','locked'].includes(out.liquidity.state) || out.liquidity.state === 'bonding_curve') ? true : null;
  return out;
}

/**
 * Hard Filtration & Anti-Sniper Baseline Guard (AGENTS.md)
 * 1. Tokens at age < 10s must establish >= 3 unique buyers to avoid 0-second dev dumps (>80% probability).
 * 2. All venues require verified distinct-buyer evidence; venue and age do not substitute for it.
 */
export function checkAntiSniperAndDexAsymmetry(params: {
  ageMs: number | null;
  uniqueBuyers: number | null;
  isDex?: boolean;
}): { allowed: boolean; reason?: string } {
  const { ageMs, uniqueBuyers, isDex } = params;
  const ageKnown = typeof ageMs === 'number' && Number.isFinite(ageMs) && ageMs >= 0;
  if (!ageKnown) {
    return {
      allowed: false,
      reason: 'UNVERIFIED_TOKEN_AGE: Token age evidence is unavailable',
    };
  }
  if (ageMs! < 10_000) {
    return {
      allowed: false,
      reason: 'ANTI_SNIPER_BASELINE_NOT_MET: Token age < 10s requires waiting before entry',
    };
  }

  // Raw trade counts cannot substitute for a unique economic buyer count.
  if (!Number.isSafeInteger(uniqueBuyers) || uniqueBuyers! < 0) {
    return {
      allowed: false,
      reason: 'UNVERIFIED_UNIQUE_BUYER_COUNT: Distinct buyer evidence is unavailable',
    };
  }

  // Young launches and bonding curves need three independently observed buyers.
  if (uniqueBuyers! < 3) {
    return {
      allowed: false,
      reason: 'INSUFFICIENT_BUYER_ACCUMULATION: At least 3 unique buyers are required',
    };
  }

  return { allowed: true };
}
