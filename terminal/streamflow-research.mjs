const STREAMFLOW_PROGRAM = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MAX_CACHE_ENTRIES = 100;
const MAX_RESULT_STREAMS = 2_000;

const unavailable = (mint, errorCode) => Object.freeze({status: 'UNAVAILABLE', provider: 'STREAMFLOW', authority: 'RESEARCH_ONLY', executionAuthorized: false, mint, programId: STREAMFLOW_PROGRAM, errorCode});
const bigintValue = value => {
  try { const raw = typeof value === 'bigint' ? value : BigInt(value?.toString?.() ?? value); return raw >= 0n ? raw : null; }
  catch { return null; }
};
const safeTimestamp = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

function validRpcUrl(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)))) return false;
    return true;
  } catch { return false; }
}

async function createSdkClient(rpcUrl, timeoutMs) {
  const [{SolanaStreamClient}, {Connection}] = await Promise.all([import('@streamflow/stream'), import('@solana/web3.js')]);
  const connection = new Connection(rpcUrl, {commitment: 'confirmed', fetch: (input, init = {}) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, {...init, signal});
  }});
  return new SolanaStreamClient({connection, cluster: 'mainnet'});
}

/** Read-only, mint-scoped Streamflow program lookup using the official SDK. */
export class StreamflowResearchService {
  constructor({rpcUrl = '', timeoutMs = 8_000, cacheTtlMs = 20_000, now = Date.now, clientFactory = createSdkClient} = {}) {
    this.rpcUrl = typeof rpcUrl === 'string' ? rpcUrl.trim() : '';
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.clientFactory = clientFactory;
    this.cache = new Map();
    this.inFlight = new Map();
  }

  async lookupMint(mint) {
    const address = typeof mint === 'string' ? mint.trim() : '';
    if (!MINT.test(address)) return unavailable(address, 'STREAMFLOW_MINT_INVALID');
    if (!this.rpcUrl) return unavailable(address, 'STREAMFLOW_RPC_UNCONFIGURED');
    if (!validRpcUrl(this.rpcUrl)) return unavailable(address, 'STREAMFLOW_RPC_URL_INVALID');
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 30_000 ||
        !Number.isSafeInteger(this.cacheTtlMs) || this.cacheTtlMs < 0 || this.cacheTtlMs > 300_000) return unavailable(address, 'STREAMFLOW_RESEARCH_CONFIG_INVALID');
    const cached = this.cache.get(address);
    if (cached && this.now() >= cached.at && this.now() - cached.at < cached.ttlMs) return cached.result;
    if (this.inFlight.has(address)) return this.inFlight.get(address);
    if (this.inFlight.size >= 3) return unavailable(address, 'STREAMFLOW_QUERY_QUEUE_FULL');
    const operation = this.#query(address);
    this.inFlight.set(address, operation);
    try { return await operation; } finally { this.inFlight.delete(address); }
  }

  async #query(mint) {
    try {
      const client = await this.clientFactory(this.rpcUrl, this.timeoutMs);
      if (!client || typeof client.searchStreams !== 'function') return this.#fail(mint, 'STREAMFLOW_SDK_CLIENT_INVALID');
      const accounts = await client.searchStreams({mint});
      if (!Array.isArray(accounts) || accounts.length > MAX_RESULT_STREAMS) return this.#fail(mint, 'STREAMFLOW_RESPONSE_LIMIT');
      const records = [];
      let totalRemainingRaw = 0n;
      let totalUnlockNext7dRaw = 0n;
      let cancelableBySenderCount = 0;
      const nowSeconds = Math.floor(this.now() / 1000);
      for (const entry of accounts) {
        const account = entry?.account;
        if (!account || account.mint !== mint) continue;
        const deposited = bigintValue(account.depositedAmount);
        const withdrawn = bigintValue(account.withdrawnAmount);
        if (deposited === null || withdrawn === null) continue;
        const remaining = deposited > withdrawn ? deposited - withdrawn : 0n;
        if (account.closed === true || Number(account.canceledAt) > 0) continue;
        let next7d = 0n;
        if (typeof account.unlocked === 'function') {
          try {
            const nowUnlocked = bigintValue(account.unlocked(nowSeconds));
            const futureUnlocked = bigintValue(account.unlocked(nowSeconds + WEEK_SECONDS));
            if (nowUnlocked !== null && futureUnlocked !== null && futureUnlocked > nowUnlocked) next7d = futureUnlocked - nowUnlocked;
          } catch { /* Unsupported schedules contribute zero unlock volume, never an estimate. */ }
        }
        totalRemainingRaw += remaining;
        totalUnlockNext7dRaw += next7d;
        if (account.cancelableBySender === true) cancelableBySenderCount += 1;
        records.push(Object.freeze({streamId: typeof entry.publicKey?.toBase58 === 'function' ? entry.publicKey.toBase58() : null,
          remainingRaw: remaining.toString(), unlockNext7dRaw: next7d.toString(), start: safeTimestamp(account.start),
          end: safeTimestamp(account.end), cancelableBySender: account.cancelableBySender === true}));
      }
      records.sort((a, b) => BigInt(b.unlockNext7dRaw) > BigInt(a.unlockNext7dRaw) ? 1
        : BigInt(b.unlockNext7dRaw) < BigInt(a.unlockNext7dRaw) ? -1
          : BigInt(b.remainingRaw) > BigInt(a.remainingRaw) ? 1 : BigInt(b.remainingRaw) < BigInt(a.remainingRaw) ? -1 : 0);
      const result = Object.freeze({status: 'AVAILABLE', provider: 'STREAMFLOW', authority: 'RESEARCH_ONLY', executionAuthorized: false,
        mint, programId: STREAMFLOW_PROGRAM, observedAt: this.now(), scheduleCount: records.length,
        remainingRawTotal: totalRemainingRaw.toString(), unlockNext7dRawTotal: totalUnlockNext7dRaw.toString(),
        cancelableBySenderCount, schedules: Object.freeze(records.slice(0, 10)),
        note: 'Read-only Streamflow on-chain schedule lookup. Amounts are raw token base units; other vesting programs and non-Streamflow locks are not included. This evidence does not authorize an order.'});
      this.#cacheResult(mint, result, this.cacheTtlMs);
      return result;
    } catch (error) {
      return this.#fail(mint, error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'STREAMFLOW_TIMEOUT' : 'STREAMFLOW_RPC_OR_DECODE_FAILURE');
    }
  }

  #fail(mint, errorCode) {
    const result = unavailable(mint, errorCode);
    this.#cacheResult(mint, result, Math.min(this.cacheTtlMs, 1_000));
    return result;
  }

  #cacheResult(mint, result, ttlMs) {
    this.cache.set(mint, {at: this.now(), ttlMs, result});
    for (const [key, item] of this.cache) if (this.now() < item.at || this.now() - item.at >= item.ttlMs) this.cache.delete(key);
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
  }
}

export function createStreamflowResearchService(env = process.env, options = {}) {
  return new StreamflowResearchService({rpcUrl: env.STREAMFLOW_RPC_URL?.trim() || env.MARKET_RPC_URL?.trim() || env.SOLANA_RPC_URL?.trim() || '', ...options});
}
