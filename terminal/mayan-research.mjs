const ENDPOINT = 'https://price-api.mayan.finance/v3/quote';
const SDK_VERSION = '15.2.2';
const SOLANA_PROGRAM = 'FC4eXxkyrMPTjiYUpp4EAnkmwMbQyZ6NDCh1kfLn6vsf';
const EVM_FORWARDER = '0x337685fdaB40D39bd02028545a4FfA7D287cC3E2';
const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913';
const MAX_BODY_BYTES = 524_288;
const MAX_CACHE_ENTRIES = 20;
const positiveIntegerString = value => typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value) && BigInt(value) > 0n;
const finiteAmount = value => (typeof value === 'number' && Number.isFinite(value) && value >= 0)
  || (typeof value === 'string' && value.length <= 64 && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) && Number.isFinite(Number(value)));

const unavailable = (errorCode, amountLamports = null) => Object.freeze({
  status: 'UNAVAILABLE', provider: 'MAYAN', authority: 'QUOTE_ONLY', executionAuthorized: false,
  quoteOnly: true, errorCode, ...(amountLamports ? { amountLamports: String(amountLamports) } : {}),
});

/** Read-only cross-chain quote path: only normalized quote fields leave this service. */
export class MayanResearchQuoteService {
  constructor({ amountLamports = 10_000_000, timeoutMs = 6_000, cacheTtlMs = 30_000,
    fetchImpl = fetch, now = Date.now, onValidatedQuote = null, onFailure = null } = {}) {
    this.amountLamports = amountLamports;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.onValidatedQuote = onValidatedQuote;
    this.onFailure = onFailure;
    this.cached = null;
    this.inFlight = null;
  }

  async quoteSolToBaseUsdc() {
    const amount = this.amountLamports;
    if (!Number.isSafeInteger(amount) || amount < 100_000 || amount > 10_000_000_000
      || !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000
      || !Number.isSafeInteger(this.cacheTtlMs) || this.cacheTtlMs < 0 || this.cacheTtlMs > 300_000) {
      return unavailable('MAYAN_RESEARCH_CONFIG_INVALID');
    }
    if (this.cached && this.now() >= this.cached.at && this.now() - this.cached.at < this.cached.ttlMs) return this.cached.result;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.#request(amount);
    try { return await this.inFlight; }
    finally { this.inFlight = null; }
  }

  async #request(amountLamports) {
    const params = new URLSearchParams({
      wormhole: 'true', swift: 'true', mctp: 'true', shuttle: 'false', fastMctp: 'true',
      gasless: 'false', onlyDirect: 'false', fullList: 'true', guaranteedOutput: 'true', monoChain: 'false',
      solanaProgram: SOLANA_PROGRAM, forwarderAddress: EVM_FORWARDER,
      amountIn64: String(amountLamports), fromToken: WRAPPED_SOL, fromChain: 'solana',
      toToken: BASE_USDC, toChain: 'base', slippageBps: 'auto', sdkVersion: SDK_VERSION,
    });
    const started = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${ENDPOINT}?${params}`, {
        method: 'GET', signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' },
      });
      if (response.status !== 200 && response.status !== 201) return this.#fail(`MAYAN_HTTP_${response.status}`, amountLamports);
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
        return this.#fail('MAYAN_RESPONSE_TOO_LARGE', amountLamports);
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return this.#fail('MAYAN_RESPONSE_TOO_LARGE', amountLamports);
      let body;
      try { body = JSON.parse(raw); } catch { return this.#fail('MAYAN_RESPONSE_JSON_INVALID', amountLamports); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.quotes)) {
        return this.#fail('MAYAN_RESPONSE_SCHEMA_INVALID', amountLamports);
      }
      if (body.minimumSdkVersion !== undefined && !this.#sdkCompatible(body.minimumSdkVersion)) {
        return this.#fail('MAYAN_SDK_UPDATE_REQUIRED', amountLamports);
      }
      const routeTypes = new Set(['SWIFT', 'MCTP', 'FAST_MCTP', 'WH', 'SHUTTLE']);
      const routes = body.quotes.filter(q => q && typeof q === 'object' && routeTypes.has(q.type)
        && positiveIntegerString(q.expectedAmountOutBaseUnits) && positiveIntegerString(q.minAmountOutBaseUnits)
        && finiteAmount(q.expectedAmountOut) && finiteAmount(q.minAmountOut)
        && Number.isFinite(q.etaSeconds) && q.etaSeconds >= 0
        && Number.isFinite(q.slippageBps) && q.slippageBps >= 0 && q.slippageBps <= 10_000
        && q.fromChain === 'solana' && q.toChain === 'base')
        .map(q => Object.freeze({
          type: q.type,
          expectedAmountOut: String(q.expectedAmountOut),
          expectedAmountOutBaseUnits: q.expectedAmountOutBaseUnits,
          minimumAmountOut: String(q.minAmountOut),
          minimumAmountOutBaseUnits: q.minAmountOutBaseUnits,
          etaSeconds: q.etaSeconds,
          slippageBps: q.slippageBps,
        }))
        .sort((a, b) => BigInt(b.expectedAmountOutBaseUnits) > BigInt(a.expectedAmountOutBaseUnits) ? 1
          : BigInt(b.expectedAmountOutBaseUnits) < BigInt(a.expectedAmountOutBaseUnits) ? -1 : a.etaSeconds - b.etaSeconds);
      if (routes.length === 0) return this.#fail('MAYAN_NO_VALID_ROUTES', amountLamports);
      const result = Object.freeze({
        status: 'QUOTED', provider: 'MAYAN', authority: 'QUOTE_ONLY', executionAuthorized: false, quoteOnly: true,
        source: Object.freeze({ token: 'WSOL', chain: 'solana', amountLamports: String(amountLamports) }),
        destination: Object.freeze({ token: 'USDC', chain: 'base' }),
        highestOutputRouteType: routes[0].type, routes: Object.freeze(routes.slice(0, 8)),
        quotedAt: this.now(), latencyMs: Math.max(0, this.now() - started), sdkVersion: SDK_VERSION,
        note: 'Indicative Mayan cross-chain quotes. No swap transaction was built, signed, or submitted; route settlement and received amount are not guaranteed.',
      });
      this.cached = { at: this.now(), result, ttlMs: this.cacheTtlMs };
      try { this.onValidatedQuote?.(result.latencyMs); } catch { /* health reporting does not alter results */ }
      return result;
    } catch (error) {
      return this.#fail(error instanceof Error && error.name === 'AbortError' ? 'MAYAN_TIMEOUT' : 'MAYAN_NETWORK_FAILURE', amountLamports);
    } finally { clearTimeout(timer); }
  }

  #sdkCompatible(value) {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(n => Number.isSafeInteger(n) && n >= 0)) return false;
    const [major, minor, patch] = value;
    const [sdkMajor, sdkMinor, sdkPatch] = SDK_VERSION.split('.').map(Number);
    return sdkMajor > major || sdkMajor === major && (sdkMinor > minor || sdkMinor === minor && sdkPatch >= patch);
  }

  #fail(errorCode, amountLamports) {
    try { this.onFailure?.(errorCode); } catch { /* health reporting does not alter results */ }
    const result = unavailable(errorCode, amountLamports);
    this.cached = { at: this.now(), result, ttlMs: Math.min(this.cacheTtlMs, 1_000) };
    return result;
  }
}

export function createMayanResearchQuoteService(env = process.env, fetchImpl = fetch, callbacks = {}) {
  const rawAmount = env.BUY_LAMPORTS?.trim();
  const amountLamports = rawAmount && /^\d+$/.test(rawAmount) ? Number(rawAmount) : 10_000_000;
  return new MayanResearchQuoteService({ amountLamports, fetchImpl, ...callbacks });
}
