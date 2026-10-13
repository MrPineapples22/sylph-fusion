const ENDPOINT = 'https://api.jup.ag/swap/v2/order';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const MAX_BODY_BYTES = 262_144;
const MAX_CACHED_MINTS = 100;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const positiveIntegerString = value => typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n;

export class JupiterResearchQuoteService {
  constructor({ apiKey = '', amountLamports = 10_000_000, minRequestGapMs = 2_100,
    cacheTtlMs = 15_000, timeoutMs = 5_000, fetchImpl = fetch, now = Date.now,
    onValidatedQuote = null, onFailure = null, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
    this.apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    this.amountLamports = amountLamports;
    this.minRequestGapMs = minRequestGapMs;
    this.cacheTtlMs = cacheTtlMs;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.onValidatedQuote = onValidatedQuote;
    this.onFailure = onFailure;
    this.wait = wait;
    this.cache = new Map();
    this.inFlight = new Map();
    this.nextRequestAt = 0;
    this.queue = Promise.resolve();
  }

  async quoteRoundTrip(mint) {
    const key = typeof mint === 'string' ? mint.trim() : '';
    if (!MINT.test(key)) return Object.freeze({ status: 'UNAVAILABLE', errorCode: 'JUPITER_MINT_INVALID', authority: 'QUOTE_ONLY', executionAuthorized: false });
    if (!Number.isSafeInteger(this.amountLamports) || this.amountLamports < 100_000 || this.amountLamports > 10_000_000_000 ||
        !Number.isSafeInteger(this.minRequestGapMs) || this.minRequestGapMs < 0 || this.minRequestGapMs > 60_000 ||
        !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
      return Object.freeze({ status: 'UNAVAILABLE', errorCode: 'JUPITER_RESEARCH_CONFIG_INVALID', authority: 'QUOTE_ONLY', executionAuthorized: false });
    }
    const cached = this.cache.get(key);
    const cachedAge = cached ? this.now() - cached.cachedAt : -1;
    const cachedTtl = cached?.result.status === 'QUOTED' ? this.cacheTtlMs : 1_000;
    if (cached && cachedAge >= 0 && cachedAge < cachedTtl) return cached.result;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    if (this.inFlight.size >= 4) return Object.freeze({ status: 'UNAVAILABLE', errorCode: 'JUPITER_REQUEST_QUEUE_FULL', authority: 'QUOTE_ONLY', executionAuthorized: false });
    const operation = this.queue.then(() => this.#quote(key));
    this.queue = operation.then(() => undefined, () => undefined);
    this.inFlight.set(key, operation);
    try { return await operation; }
    finally { this.inFlight.delete(key); }
  }

  async #quote(mint) {
    const amount = BigInt(this.amountLamports);
    try {
      const buy = await this.#request(WRAPPED_SOL, mint, amount);
      let sell;
      try { sell = await this.#request(mint, WRAPPED_SOL, BigInt(buy.outAmount)); }
      catch (error) {
        const result = Object.freeze({ status: 'PARTIAL', authority: 'QUOTE_ONLY', executionAuthorized: false,
          mint, amountLamports: String(amount), buyOutputRaw: buy.outAmount, buyRouter: buy.router,
          buyQuotedAt: buy.quotedAt, sellOutputLamports: null, sellRouter: null, sellQuotedAt: null,
          roundTripDeltaBps: null, roundTripWindowMs: null, errorCode: error?.code || 'JUPITER_SELL_QUOTE_UNAVAILABLE',
          note: 'Buy quote only; no round-trip estimate. No transaction was requested or returned.' });
        this.#cacheResult(mint, result);
        return result;
      }
      const deltaBps = Number((BigInt(sell.outAmount) - amount) * 10_000n * 1_000_000n / amount) / 1_000_000;
      const result = Object.freeze({ status: 'QUOTED', authority: 'QUOTE_ONLY', executionAuthorized: false,
        mint, amountLamports: String(amount), buyOutputRaw: buy.outAmount, buyRouter: buy.router,
        buyQuotedAt: buy.quotedAt, sellOutputLamports: sell.outAmount, sellRouter: sell.router,
        sellQuotedAt: sell.quotedAt, roundTripDeltaBps: deltaBps, roundTripWindowMs: Math.max(0, sell.quotedAt - buy.quotedAt),
        note: 'Sequential Jupiter quote-only snapshots; excludes network/landing costs, state movement, and unmodeled costs. Not a fill or profit forecast.' });
      this.#cacheResult(mint, result);
      return result;
    } catch (error) {
      const result = Object.freeze({ status: 'UNAVAILABLE', authority: 'QUOTE_ONLY', executionAuthorized: false,
        mint, amountLamports: String(amount), errorCode: error?.code || 'JUPITER_QUOTE_UNAVAILABLE',
        note: 'No executable transaction was requested or accepted.' });
      this.#cacheResult(mint, result);
      return result;
    }
  }

  #cacheResult(mint, result) {
    this.cache.set(mint, { cachedAt: this.now(), result });
    for (const [key, value] of this.cache) {
      if (this.now() - value.cachedAt > this.cacheTtlMs || this.now() < value.cachedAt) this.cache.delete(key);
    }
    while (this.cache.size > MAX_CACHED_MINTS) this.cache.delete(this.cache.keys().next().value);
  }

  async #request(inputMint, outputMint, amount) {
    const waitMs = Math.max(0, this.nextRequestAt - this.now());
    if (waitMs) await this.wait(waitMs);
    const url = new URL(ENDPOINT);
    url.search = new URLSearchParams({ inputMint, outputMint, amount: String(amount) }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const quotedAt = this.now();
    this.nextRequestAt = quotedAt + this.minRequestGapMs;
    try {
      const response = await this.fetchImpl(url, { method: 'GET', signal: controller.signal, redirect: 'error',
        headers: { accept: 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) } });
      if (!response.ok) {
        const error = new Error('Jupiter quote request failed');
        error.code = `JUPITER_HTTP_${response.status}`;
        throw error;
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
        const error = new Error('Jupiter quote response too large'); error.code = 'JUPITER_RESPONSE_TOO_LARGE'; throw error;
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) { const error = new Error('Jupiter quote response too large'); error.code = 'JUPITER_RESPONSE_TOO_LARGE'; throw error; }
      let body;
      try { body = JSON.parse(raw); } catch { const error = new Error('Jupiter quote response invalid'); error.code = 'JUPITER_RESPONSE_JSON_INVALID'; throw error; }
      if (!body || typeof body !== 'object' || body.inputMint !== inputMint || body.outputMint !== outputMint ||
          body.inAmount !== String(amount) || !positiveIntegerString(body.outAmount) ||
          (body.transaction !== undefined && body.transaction !== null && body.transaction !== '')) {
        const error = new Error('Jupiter did not return a valid quote-only response'); error.code = 'JUPITER_QUOTE_SCHEMA_INVALID'; throw error;
      }
      try { this.onValidatedQuote?.(Math.max(0, this.now() - quotedAt)); } catch { /* Health telemetry cannot alter quote results. */ }
      return Object.freeze({ outAmount: body.outAmount, router: typeof body.router === 'string' ? body.router.slice(0, 48) : 'UNKNOWN', quotedAt });
    } catch (error) {
      const failure = error?.name === 'AbortError' ? Object.assign(new Error('Jupiter quote timeout'), { code: 'JUPITER_TIMEOUT' }) : error;
      try { this.onFailure?.(failure?.code || 'JUPITER_NETWORK_FAILURE'); } catch { /* Health telemetry cannot alter quote results. */ }
      throw failure;
    } finally { clearTimeout(timer); }
  }
}

export function createJupiterResearchQuoteService(env = process.env, fetchImpl = fetch, callbacks = {}) {
  const rawAmount = env.BUY_LAMPORTS?.trim();
  const amountLamports = rawAmount && /^\d+$/.test(rawAmount) ? Number(rawAmount) : 10_000_000;
  return new JupiterResearchQuoteService({ apiKey: env.JUPITER_API_KEY || '', amountLamports, fetchImpl, ...callbacks });
}
