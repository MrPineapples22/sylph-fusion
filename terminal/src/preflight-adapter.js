export function normalizeToRugcheckReport(raw) {
  if (!raw || typeof raw !== 'object') return { score: 9999, token: { mintAuthority: 'UNKNOWN', freezeAuthority: 'UNKNOWN' }, markets: [{ lp: { lpBurnedPct: 0 } }], topHolders: [{ pct: 100 }] };
  if (raw.token && Array.isArray(raw.markets) && 'mintAuthority' in raw.token && 'freezeAuthority' in raw.token && Number.isFinite(raw.score) && Array.isArray(raw.topHolders)) return raw;
  const mintAuthority = raw.token?.mintAuthority ?? (raw.hasMintAuthority === false ? null : raw.hasMintAuthority === true ? 'ACTIVE' : 'UNKNOWN');
  const freezeAuthority = raw.token?.freezeAuthority ?? (raw.hasFreezeAuthority === false ? null : raw.hasFreezeAuthority === true ? 'ACTIVE' : 'UNKNOWN');
  const lpBurnedPct = Number(raw.lpBurnedPercent ?? raw.markets?.[0]?.lp?.lpBurnedPct ?? (raw.lpBurnedBps != null ? raw.lpBurnedBps / 100 : 0));
  const topHolders = Array.isArray(raw.topHolders) ? raw.topHolders : Number.isFinite(raw.topHoldersShareBps) ? [{ pct: raw.topHoldersShareBps / 100 }] : [{ pct: 100 }];
  const score = Number.isFinite(raw.score) ? raw.score : (mintAuthority || freezeAuthority ? 2000 : 0) + (lpBurnedPct < 90 ? 1000 : 0);
  return { score, token: { mintAuthority, freezeAuthority }, markets: [{ lp: { lpBurnedPct } }], topHolders };
}
