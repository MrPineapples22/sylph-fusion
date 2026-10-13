const ENDPOINT = 'https://public-api.birdeye.so/defi/token_overview';
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_BODY_BYTES = 262_144;
const MAX_CACHE_ENTRIES = 100;
const finiteNonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const unavailable = (mint, errorCode) => Object.freeze({
  status: 'UNAVAILABLE', provider: 'BIRDEYE', authority: 'RESEARCH_ONLY', executionAuthorized: false,
  mint, errorCode,
});

/** On-demand, bounded cross-check of Birdeye's Solana token overview. */
export class BirdeyeResearchService {
  constructor({apiKey = '', timeoutMs = 4_000, cacheTtlMs = 15_000, minRequestGapMs = 1_000,
    fetchImpl = fetch, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms))} = {}) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.minRequestGapMs = minRequestGapMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.wait = wait;
    this.cache = new Map();
    this.inFlight = new Map();
    this.queue = Promise.resolve();
    this.nextRequestAt = 0;
  }

  async overview(mint) {
    const address = typeof mint === 'string' ? mint.trim() : '';
    if (!MINT.test(address)) return unavailable(address, 'BIRDEYE_MINT_INVALID');
    if (!this.apiKey) return unavailable(address, 'BIRDEYE_API_KEY_UNCONFIGURED');
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 15_000 ||
        !Number.isSafeInteger(this.cacheTtlMs) || this.cacheTtlMs < 0 || this.cacheTtlMs > 300_000 ||
        !Number.isSafeInteger(this.minRequestGapMs) || this.minRequestGapMs < 1_000 || this.minRequestGapMs > 60_000) {
      return unavailable(address, 'BIRDEYE_RESEARCH_CONFIG_INVALID');
    }
    const cached = this.cache.get(address);
    if (cached && this.now() >= cached.at && this.now() - cached.at < cached.ttlMs) return cached.result;
    if (this.inFlight.has(address)) return this.inFlight.get(address);
    if (this.inFlight.size >= 4) return unavailable(address, 'BIRDEYE_REQUEST_QUEUE_FULL');
    const operation = this.queue.then(async () => {
      const waitMs = Math.max(0, this.nextRequestAt - this.now());
      if (waitMs) await this.wait(waitMs);
      this.nextRequestAt = this.now() + this.minRequestGapMs;
      return this.#request(address);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    this.inFlight.set(address, operation);
    try { return await operation; }
    finally { this.inFlight.delete(address); }
  }

  async #request(mint) {
    const started = this.now();
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({address: mint, frames: '1h,24h'}).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {method: 'GET', signal: controller.signal, redirect: 'error',
        headers: {accept: 'application/json', 'X-API-KEY': this.apiKey, 'x-chain': 'solana'}});
      if (!response.ok) return this.#fail(mint, `BIRDEYE_HTTP_${response.status}`);
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
        return this.#fail(mint, 'BIRDEYE_RESPONSE_TOO_LARGE');
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return this.#fail(mint, 'BIRDEYE_RESPONSE_TOO_LARGE');
      let body;
      try { body = JSON.parse(raw); } catch { return this.#fail(mint, 'BIRDEYE_RESPONSE_JSON_INVALID'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.success === false ||
          !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
        return this.#fail(mint, 'BIRDEYE_RESPONSE_SCHEMA_INVALID');
      }
      const data = body.data;
      if (typeof data.address === 'string' && data.address !== mint) return this.#fail(mint, 'BIRDEYE_MINT_MISMATCH');
      const marketCap = finiteNonnegative(data.mc) ? data.mc : finiteNonnegative(data.marketCap) ? data.marketCap : null;
      const fields = Object.freeze({
        priceUsd: finiteNonnegative(data.price) && data.price > 0 ? data.price : null,
        liquidityUsd: finiteNonnegative(data.liquidity) ? data.liquidity : null,
        marketCapUsd: marketCap,
      });
      if (fields.priceUsd === null && fields.liquidityUsd === null && fields.marketCapUsd === null) {
        return this.#fail(mint, 'BIRDEYE_NO_VALID_MARKET_FIELDS');
      }
      const result = Object.freeze({status: 'AVAILABLE', provider: 'BIRDEYE', authority: 'RESEARCH_ONLY',
        executionAuthorized: false, mint, fields, observedAt: this.now(), latencyMs: Math.max(0, this.now() - started),
        note: 'Independent provider overview for manual cross-check only. It does not affect candidate eligibility or authorize an order.'});
      this.#cacheResult(mint, result, this.cacheTtlMs);
      return result;
    } catch (error) {
      return this.#fail(mint, error?.name === 'AbortError' ? 'BIRDEYE_TIMEOUT' : 'BIRDEYE_NETWORK_FAILURE');
    } finally { clearTimeout(timer); }
  }

  #fail(mint, errorCode) {
    const result = unavailable(mint, errorCode);
    this.#cacheResult(mint, result, Math.min(this.cacheTtlMs, 1_000));
    return result;
  }

  #cacheResult(mint, result, ttlMs) {
    this.cache.set(mint, {at: this.now(), ttlMs, result});
    for (const [key, entry] of this.cache) if (this.now() < entry.at || this.now() - entry.at >= entry.ttlMs) this.cache.delete(key);
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
  }
}

export function createBirdeyeResearchService(env = process.env, fetchImpl = fetch) {
  return new BirdeyeResearchService({apiKey: env.BIRDEYE_API_KEY || '', fetchImpl});
}
