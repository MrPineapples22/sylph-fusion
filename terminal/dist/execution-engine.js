// ../src/platform/ingestion/provider-health.ts
function authSatisfied(requirement, authenticated) {
  return requirement === "NOT_REQUIRED" || requirement === "REQUIRED" && authenticated === true;
}
var ProviderHealthTracker = class {
  metrics = /* @__PURE__ */ new Map();
  endpointTransitions = /* @__PURE__ */ new Map();
  windowSize = 20;
  circuitCooldownMs = 1e4;
  requiredRecoveryObservations = 3;
  constructor() {
    this.initDefaultProviders();
  }
  initDefaultProviders() {
    const defs = [
      { id: "PUMPPORTAL_WS", role: "DISCOVERY_STREAM", authoritative: true, configured: false, enabled: false, authenticated: false, url: "wss://pumpportal.fun/api/data" },
      { id: "DEXSCREENER_API", role: "MARKET_ENRICHMENT", authoritative: false, configured: false, enabled: false, authenticated: false, url: "https://api.dexscreener.com/latest/dex" },
      { id: "RUGCHECK_API", role: "SECURITY_RISK", authoritative: true, configured: false, enabled: false, authenticated: false, url: "https://api.rugcheck.xyz/v1/tokens" },
      { id: "JUPITER_QUOTE", role: "EXECUTION_ROUTING", authoritative: false, configured: false, enabled: false, authenticated: false, url: "https://quote-api.jup.ag/v6/quote" },
      { id: "SOLANA_RPC", role: "ON_CHAIN_TRUTH", authoritative: true, configured: false, enabled: false, authenticated: false, url: "https://api.mainnet-beta.solana.com" },
      { id: "SOLANA_WSS", role: "ON_CHAIN_TRUTH", authoritative: true, configured: false, enabled: false, authenticated: false, url: "wss://api.mainnet-beta.solana.com" },
      // HELIOS Direct TPU is an optional optimization; unconfigured/disabled by default so it does NOT make platform CRITICAL
      { id: "HELIOS_DIRECT_TPU", role: "DIRECT_TPU_DISPATCH", authoritative: false, configured: false, enabled: false, authenticated: false, url: "udp://validator-leader-tpu:8003" }
    ];
    for (const d of defs) {
      this.metrics.set(d.id, {
        role: d.role,
        isAuthoritative: d.authoritative,
        configured: d.configured,
        enabled: d.enabled,
        authenticationRequirement: "UNKNOWN",
        authenticated: d.authenticated,
        transportReachable: false,
        observationValidated: false,
        sanitizedUrl: d.url,
        currentEndpointUrl: d.url,
        lastAttemptMs: 0,
        lastSuccessMs: 0,
        lastValidatedObservationMs: 0,
        rateLimitedUntilMs: 0,
        samples: [],
        circuitState: "CLOSED",
        circuitTrippedAtMs: 0,
        consecutiveRecoveryObservations: 0,
        slotLag: null,
        lastFailureReason: null,
        totalRequests: 0,
        totalErrors: 0,
        circuitTripCount: 0
      });
    }
  }
  setProviderConfiguration(providerId, configured, enabled, authenticated = false, authenticationRequirement = "UNKNOWN") {
    const entry = this.metrics.get(providerId);
    if (!entry) return;
    entry.configured = configured === true;
    entry.enabled = enabled === true;
    entry.authenticationRequirement = authenticationRequirement === "REQUIRED" || authenticationRequirement === "NOT_REQUIRED" ? authenticationRequirement : "UNKNOWN";
    entry.authenticated = authenticated === true;
  }
  recordTransportReachable(providerId, reachable = true) {
    const entry = this.metrics.get(providerId);
    if (!entry) return;
    entry.transportReachable = reachable;
    if (!reachable) {
      entry.observationValidated = false;
    }
  }
  recordEndpointTransition(providerId, fromUrl, toUrl) {
    const entry = this.metrics.get(providerId);
    if (!entry) return;
    if (fromUrl !== toUrl) {
      entry.currentEndpointUrl = toUrl;
      this.endpointTransitions.set(providerId, { from: fromUrl, to: toUrl, timestamp: Date.now() });
    }
  }
  recordValidatedObservation(providerId, latencyMs, slotLag, now = Date.now()) {
    const entry = this.metrics.get(providerId);
    if (!entry || !Number.isFinite(latencyMs) || latencyMs < 0) return;
    entry.lastAttemptMs = now;
    entry.lastSuccessMs = now;
    entry.lastValidatedObservationMs = now;
    entry.transportReachable = true;
    entry.observationValidated = true;
    entry.totalRequests++;
    entry.lastFailureReason = null;
    entry.rateLimitedUntilMs = 0;
    if (slotLag !== void 0 && Number.isFinite(slotLag)) {
      entry.slotLag = slotLag;
    }
    entry.samples.push({ success: true, latencyMs, timestamp: now, validatedObservation: true });
    if (entry.samples.length > this.windowSize) entry.samples.shift();
    if (entry.circuitState === "OPEN") {
      if (now - entry.circuitTrippedAtMs >= this.circuitCooldownMs) {
        entry.circuitState = "PROBING";
        entry.consecutiveRecoveryObservations = 1;
      }
    } else if (entry.circuitState === "PROBING") {
      entry.circuitState = "RECOVERING";
      entry.consecutiveRecoveryObservations = 1;
    } else if (entry.circuitState === "RECOVERING") {
      entry.consecutiveRecoveryObservations++;
      if (entry.consecutiveRecoveryObservations >= this.requiredRecoveryObservations) {
        entry.circuitState = "HEALTHY";
        entry.consecutiveRecoveryObservations = 0;
      }
    } else if (entry.circuitState === "DEGRADED") {
      const recentErrors = entry.samples.filter((s) => !s.success).length;
      if (recentErrors === 0) {
        entry.circuitState = "HEALTHY";
      }
    } else if (entry.circuitState === "CLOSED") {
      entry.circuitState = "HEALTHY";
    }
  }
  recordSuccess(providerId, latencyMs, slotLag, now = Date.now()) {
    this.recordValidatedObservation(providerId, latencyMs, slotLag, now);
  }
  recordFailure(providerId, reason = "TRANSPORT_OR_DECODE_FAILURE", now = Date.now()) {
    const entry = this.metrics.get(providerId);
    if (!entry) return;
    entry.lastAttemptMs = now;
    entry.totalRequests++;
    entry.totalErrors++;
    entry.lastFailureReason = reason;
    entry.samples.push({ success: false, latencyMs: 0, timestamp: now, validatedObservation: false });
    if (entry.samples.length > this.windowSize) entry.samples.shift();
    const recentErrors = entry.samples.filter((s) => !s.success).length;
    const windowErrorRate = entry.samples.length > 0 ? recentErrors / entry.samples.length : 0;
    if (entry.circuitState === "PROBING" || entry.circuitState === "RECOVERING") {
      entry.circuitState = "OPEN";
      entry.circuitTrippedAtMs = now;
      entry.consecutiveRecoveryObservations = 0;
      entry.circuitTripCount++;
    } else if (windowErrorRate >= 0.4 && entry.samples.length >= 5) {
      entry.circuitState = "OPEN";
      entry.circuitTrippedAtMs = now;
      entry.consecutiveRecoveryObservations = 0;
      entry.circuitTripCount++;
    } else if (windowErrorRate > 0.15 || recentErrors >= 2) {
      entry.circuitState = "DEGRADED";
    }
  }
  recordRateLimit(providerId, backoffMs = 15e3) {
    const entry = this.metrics.get(providerId);
    if (!entry) return;
    const now = Date.now();
    entry.lastAttemptMs = now;
    entry.totalRequests++;
    entry.totalErrors++;
    entry.rateLimitedUntilMs = now + backoffMs;
    entry.lastFailureReason = "HTTP_429_RATE_LIMITED";
    entry.samples.push({ success: false, latencyMs: 0, timestamp: now, validatedObservation: false });
    if (entry.samples.length > this.windowSize) entry.samples.shift();
    entry.circuitState = "DEGRADED";
  }
  async recordRateLimitAndPersist(providerId, backoffMs = 15e3, store) {
    this.recordRateLimit(providerId, backoffMs);
    if (store && typeof store.saveProviderQuota === "function") {
      const entry = this.metrics.get(providerId);
      if (entry) {
        await store.saveProviderQuota({
          providerId,
          rateLimitedUntilMs: entry.rateLimitedUntilMs,
          circuitState: entry.circuitState,
          circuitTrippedAtMs: entry.circuitTrippedAtMs,
          consecutiveRecovery: entry.consecutiveRecoveryObservations,
          lastFailureReason: entry.lastFailureReason
        });
      }
    }
  }
  exportDurableState() {
    const list = [];
    for (const [providerId, entry] of this.metrics.entries()) {
      if (entry.rateLimitedUntilMs > 0 || entry.circuitState !== "CLOSED") {
        list.push({
          providerId,
          rateLimitedUntilMs: entry.rateLimitedUntilMs,
          circuitState: entry.circuitState,
          circuitTrippedAtMs: entry.circuitTrippedAtMs,
          consecutiveRecovery: entry.consecutiveRecoveryObservations,
          lastFailureReason: entry.lastFailureReason
        });
      }
    }
    return list;
  }
  hydrateDurableState(records) {
    let count = 0;
    const now = Date.now();
    for (const r of records) {
      const providerId = String(r.providerId ?? r.provider_id ?? "");
      if (!providerId) continue;
      const entry = this.metrics.get(providerId);
      if (!entry) continue;
      const rateLimitUntil = Number(r.rateLimitedUntilMs ?? r.rate_limited_until_ms ?? 0);
      if (rateLimitUntil > now) {
        entry.rateLimitedUntilMs = rateLimitUntil;
        entry.circuitState = r.circuitState ?? r.circuit_state ?? "DEGRADED";
        entry.lastFailureReason = String(r.lastFailureReason ?? r.last_failure_reason ?? "HTTP_429_RATE_LIMITED");
        count++;
      } else if (r.circuitState === "OPEN") {
        entry.circuitState = "OPEN";
        entry.circuitTrippedAtMs = Number(r.circuitTrippedAtMs ?? r.circuit_tripped_at_ms ?? now);
        entry.consecutiveRecoveryObservations = Number(r.consecutiveRecovery ?? r.consecutive_recovery ?? 0);
        entry.lastFailureReason = String(r.lastFailureReason ?? r.last_failure_reason ?? "PREVIOUSLY_OPEN");
        count++;
      }
    }
    return count;
  }
  updateSlot(currentSlot, networkSlot) {
    const lag = Math.max(0, networkSlot - currentSlot);
    const rpc = this.metrics.get("SOLANA_RPC");
    if (rpc) rpc.slotLag = lag;
    const wss = this.metrics.get("SOLANA_WSS");
    if (wss) wss.slotLag = lag;
  }
  isMarketFeedStale(now = Date.now(), thresholdMs = 1e4) {
    const pump = this.metrics.get("PUMPPORTAL_WS");
    if (!pump || !pump.configured || !pump.enabled || !authSatisfied(pump.authenticationRequirement, pump.authenticated) || !pump.observationValidated || !pump.transportReachable || pump.lastSuccessMs === 0 || now - pump.lastSuccessMs > thresholdMs || pump.circuitState === "OPEN" || pump.rateLimitedUntilMs > now) return true;
    const rpc = this.metrics.get("SOLANA_RPC");
    if (!rpc || !rpc.configured || !rpc.enabled || !authSatisfied(rpc.authenticationRequirement, rpc.authenticated) || !rpc.observationValidated || !rpc.transportReachable || rpc.lastSuccessMs === 0 || now - rpc.lastSuccessMs > thresholdMs || rpc.circuitState === "OPEN" || rpc.rateLimitedUntilMs > now) return true;
    return false;
  }
  getReport(now = Date.now()) {
    const providers = {};
    const activeAlerts = [];
    let criticalCount = 0;
    let degradedCount = 0;
    for (const [id, m] of this.metrics.entries()) {
      if (!m.configured || !m.enabled) {
        providers[id] = {
          providerId: id,
          role: m.role,
          configured: false,
          enabled: false,
          authenticationRequirement: "UNKNOWN",
          transportReachable: false,
          authenticated: false,
          capabilityAvailable: false,
          observationValidated: false,
          freshness: "UNKNOWN",
          slotLag: null,
          latency: 0,
          rateLimited: false,
          circuitState: "CLOSED",
          lastAttempt: 0,
          lastSuccess: 0,
          lastValidatedObservation: 0,
          failureReason: "PROVIDER_NOT_CONFIGURED",
          state: "OFFLINE",
          isAuthoritative: m.isAuthoritative,
          lastSuccessTimestampMs: 0,
          avgLatencyMs: 0,
          errorRatePct: 0,
          totalRequestsCount: 0,
          totalErrorsCount: 0,
          feedAgeMs: 0,
          circuitBreakerTripped: false,
          failoverActive: false,
          endpointUrlSanitized: m.sanitizedUrl
        };
        continue;
      }
      const feedAgeMs = Math.max(0, now - m.lastSuccessMs);
      const successfulSamples = m.samples.filter((s) => s.success && s.latencyMs > 0);
      const avgLatency = successfulSamples.length ? Math.round(successfulSamples.reduce((a, b) => a + b.latencyMs, 0) / successfulSamples.length) : 0;
      const recentErrors = m.samples.filter((s) => !s.success).length;
      const errorRate = m.samples.length > 0 ? recentErrors / m.samples.length * 100 : 0;
      let freshness = "UNKNOWN";
      if (m.lastSuccessMs === 0) freshness = "UNKNOWN";
      else if (m.isAuthoritative) {
        freshness = feedAgeMs <= 1e4 ? "FRESH" : "STALE";
      } else {
        if (feedAgeMs <= 3e4) freshness = "FRESH";
        else if (feedAgeMs <= 45e3) freshness = "DEGRADED";
        else freshness = "STALE";
      }
      let state = "OPTIMAL";
      if (now < m.rateLimitedUntilMs) {
        state = "RATE_LIMITED";
        if (m.isAuthoritative) criticalCount++;
        else degradedCount++;
        activeAlerts.push({
          severity: m.isAuthoritative ? "CRITICAL" : "WARNING",
          source: id,
          message: `Provider ${id} rate limited (HTTP 429). Backing off for ${Math.round((m.rateLimitedUntilMs - now) / 1e3)}s.`,
          timestampMs: now,
          actionRequired: "Throttle request rate or configure dedicated API key."
        });
      } else if (m.circuitState === "OPEN") {
        state = "CIRCUIT_OPEN";
        criticalCount++;
        activeAlerts.push({
          severity: "CRITICAL",
          source: id,
          message: `Circuit breaker tripped for ${id}. Excessive rolling failure rate (${errorRate.toFixed(1)}%).`,
          timestampMs: now,
          actionRequired: "Inspect network connection and API rate limits."
        });
      } else if (m.lastSuccessMs === 0) {
        state = "OFFLINE";
        if (m.isAuthoritative) criticalCount++;
        else degradedCount++;
        activeAlerts.push({
          severity: m.isAuthoritative ? "CRITICAL" : "WARNING",
          source: id,
          message: `No successful provider observation has been received for ${id}.`,
          timestampMs: now
        });
      } else if (freshness === "STALE") {
        state = "STALE";
        if (m.isAuthoritative) criticalCount++;
        else degradedCount++;
        activeAlerts.push({
          severity: m.isAuthoritative ? "CRITICAL" : "WARNING",
          source: id,
          message: `Feed data for ${id} is stale (${Math.round(feedAgeMs / 1e3)}s since last tick).`,
          timestampMs: now,
          actionRequired: "Trigger WebSocket reconnect or poll backup provider."
        });
      } else if (errorRate > 15 || avgLatency > 500 || m.circuitState === "DEGRADED" || m.circuitState === "RECOVERING") {
        state = "DEGRADED";
        degradedCount++;
        activeAlerts.push({
          severity: "NOTICE",
          source: id,
          message: `Provider ${id} latency or error rate elevated (${avgLatency}ms, ${errorRate.toFixed(1)}% errors, circuit: ${m.circuitState}).`,
          timestampMs: now
        });
      } else if (avgLatency > 150) {
        state = "CONNECTED";
      }
      const transition = this.endpointTransitions.get(id);
      const failoverActive = Boolean(transition && now - transition.timestamp < 6e4);
      providers[id] = {
        providerId: id,
        role: m.role,
        configured: m.configured,
        enabled: m.enabled,
        authenticationRequirement: m.authenticationRequirement,
        transportReachable: m.transportReachable,
        authenticated: m.authenticated,
        capabilityAvailable: m.configured && m.enabled && authSatisfied(m.authenticationRequirement, m.authenticated) && m.transportReachable && m.observationValidated && freshness === "FRESH" && m.circuitState !== "OPEN" && now >= m.rateLimitedUntilMs,
        observationValidated: m.observationValidated,
        freshness,
        slotLag: m.slotLag,
        latency: avgLatency,
        rateLimited: now < m.rateLimitedUntilMs,
        circuitState: m.circuitState,
        lastAttempt: m.lastAttemptMs,
        lastSuccess: m.lastSuccessMs,
        lastValidatedObservation: m.lastValidatedObservationMs,
        failureReason: m.lastFailureReason,
        state,
        isAuthoritative: m.isAuthoritative,
        lastSuccessTimestampMs: m.lastSuccessMs,
        avgLatencyMs: avgLatency,
        errorRatePct: Number(errorRate.toFixed(1)),
        totalRequestsCount: m.totalRequests,
        totalErrorsCount: m.totalErrors,
        feedAgeMs,
        circuitBreakerTripped: m.circuitState === "OPEN",
        failoverActive,
        failoverProviderId: transition?.to,
        endpointUrlSanitized: m.sanitizedUrl,
        rateLimitedUntilMs: m.rateLimitedUntilMs
      };
    }
    const marketFeedStale = this.isMarketFeedStale(now);
    let overall = "NOMINAL";
    if (criticalCount > 0 || marketFeedStale) overall = "CRITICAL";
    else if (degradedCount > 1) overall = "RESTRICTED";
    else if (degradedCount === 1) overall = "DEGRADED";
    return {
      overallSystemState: overall,
      isMarketFeedStale: marketFeedStale,
      providers,
      activeAlerts,
      evaluatedAtMs: now
    };
  }
};
var globalProviderHealthTracker = new ProviderHealthTracker();

// ../src/execution-engine.ts
var AdverseSelectionTracker = class {
  constructor(alpha = 0.35) {
    this.alpha = alpha;
  }
  alpha;
  score = 0;
  registerDrift(d) {
    const penalty = d.priceDriftPct < 0 ? Math.min(100, Math.abs(d.priceDriftPct) * 25) : 0;
    this.score = this.alpha * penalty + (1 - this.alpha) * this.score;
    return Math.round(this.score);
  }
  getScore() {
    return Math.round(this.score);
  }
  reset() {
    this.score = 0;
  }
};
var BPS = 10000n;
var FEE_BPS = 25n;
var SLOT_MS = 400;
var clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function computeTrancheSlippageBps(trancheIndex, cumulativeTokenAmount, poolTokenReserve, baseSlippageBps = 150, maxSlippageBps = 1500) {
  if (poolTokenReserve <= 0n || cumulativeTokenAmount <= 0n) return baseSlippageBps;
  const depthRatioBps = Number(cumulativeTokenAmount * 10000n / poolTokenReserve);
  return Math.min(maxSlippageBps, baseSlippageBps + Math.round(depthRatioBps * 1.35));
}
function quote(state, side, input) {
  const x = state.reserves.sol, y = state.reserves.token;
  if (x <= 0n || y <= 0n || input <= 0n) throw Error("invalid reserves");
  const fee = input * FEE_BPS / BPS, eff = input - fee;
  if (side === "BUY") {
    const out2 = y * eff / (x + eff);
    return { out: out2, post: { sol: x + input, token: y - out2 }, spot: Number(x) / Number(y), realized: Number(input) / Number(out2) };
  }
  const out = x * eff / (y + eff);
  return { out, post: { sol: x - out, token: y + input }, spot: Number(x) / Number(y), realized: Number(out) / Number(input) };
}
var SimulatedEngine = class {
  constructor(seed = 7, tipFloor = 100000n, tipCeiling = 10000000n) {
    this.tipFloor = tipFloor;
    this.tipCeiling = tipCeiling;
    let s = seed >>> 0;
    this.random = () => {
      s = 1664525 * s + 1013904223 >>> 0;
      return s / 4294967296;
    };
  }
  tipFloor;
  tipCeiling;
  statesByPool = /* @__PURE__ */ new Map();
  overlays = /* @__PURE__ */ new Map();
  random;
  pending = /* @__PURE__ */ new Map();
  onDriftCallback;
  adverseSelection = new AdverseSelectionTracker();
  lifecycleAudits = /* @__PURE__ */ new Map();
  setDriftListener(callback) {
    this.onDriftCallback = callback;
  }
  recordStage(orderId, stage, reason, metadata) {
    let records = this.lifecycleAudits.get(orderId);
    if (!records) {
      records = [];
      this.lifecycleAudits.set(orderId, records);
      if (this.lifecycleAudits.size > 200) {
        this.lifecycleAudits.delete(this.lifecycleAudits.keys().next().value);
      }
    }
    records.push({
      stage,
      timestampMs: Date.now(),
      reason,
      metadata
    });
    return records;
  }
  enforceLiveFeedFreshness = false;
  setEnforceLiveFeedFreshness(enforce) {
    this.enforceLiveFeedFreshness = enforce;
  }
  getLifecycleHistory(orderId) {
    return this.lifecycleAudits.get(orderId) || [];
  }
  getRecentLifecycleAudits(limit = 50) {
    return [...this.lifecycleAudits.entries()].slice(-limit).map(([orderId, history]) => ({ orderId, history }));
  }
  pushState(state, poolAddress = "") {
    if (!Number.isFinite(state.timestamp) || !Number.isFinite(state.slot) || state.reserves.sol <= 0n || state.reserves.token <= 0n) return;
    const existing = this.statesByPool.get(poolAddress);
    if (existing?.length && state.timestamp <= existing[existing.length - 1].timestamp) return;
    const overlay = this.overlays.get(poolAddress);
    if (overlay && (state.migrated || state.slot >= overlay.appliedAtSlot)) {
      const a = Number(overlay.reserves.sol) / Number(overlay.reserves.token), b = Number(state.reserves.sol) / Number(state.reserves.token), priceDriftPct = a > 0 ? (b - a) / a * 100 : 0;
      this.onDriftCallback?.({ poolAddress, reconciledAtSlot: state.slot, deltaSolLamports: state.reserves.sol - overlay.reserves.sol, deltaTokenUnits: state.reserves.token - overlay.reserves.token, priceDriftPct, adverseSelectionDetected: priceDriftPct < -0.75 });
      this.overlays.delete(poolAddress);
    }
    const states = this.statesByPool.get(poolAddress) || [];
    if (states.length && state.timestamp <= states[states.length - 1].timestamp) return;
    states.push(state);
    if (states.length > 300) states.shift();
    this.statesByPool.set(poolAddress, states);
  }
  exportState() {
    return { adverseSelectionScore: this.adverseSelection.getScore(), overlays: [...this.overlays.values()].map((o) => ({ poolAddress: o.poolAddress, reserves: { sol: o.reserves.sol.toString(), token: o.reserves.token.toString() }, appliedAtTimestamp: o.appliedAtTimestamp, appliedAtSlot: o.appliedAtSlot })) };
  }
  hydrateState(state) {
    if (!state || !Array.isArray(state.overlays)) return;
    this.overlays.clear();
    for (const o of state.overlays) {
      try {
        if (o?.poolAddress && o.reserves?.sol && o.reserves?.token) this.overlays.set(o.poolAddress, { ...o, reserves: { sol: BigInt(o.reserves.sol), token: BigInt(o.reserves.token) } });
      } catch {
      }
    }
  }
  clearOverlay(poolAddress) {
    if (poolAddress) this.overlays.delete(poolAddress);
    else this.overlays.clear();
  }
  getOverlay(poolAddress) {
    return this.overlays.get(poolAddress);
  }
  hasActiveOverlay(poolAddress) {
    return this.overlays.has(poolAddress);
  }
  async execute(order) {
    this.recordStage(order.orderId, "IDLE", "Order received");
    this.recordStage(order.orderId, "VALIDATING", "Pre-trade risk & invariant check");
    if (order.amountLamports <= 0n) {
      return this.reject(order, "PRE_TRADE_RISK_REJECTED", 0, 0, 0n, "Invalid order amount (zero or negative)");
    }
    if (this.enforceLiveFeedFreshness && order.side === "BUY" && !order.emergency && globalProviderHealthTracker.isMarketFeedStale()) {
      return this.reject(order, "STALE_STATE", 0, 0, 0n, "Market feed stale: buy order rejected for safety");
    }
    const delay = 400 + Math.floor(this.random() * 401);
    const target = order.triggerTimestamp + delay;
    const controller = new AbortController();
    this.pending.set(order.orderId, controller);
    try {
      await this.sleep(delay, controller.signal);
      const frames = this.statesByPool.get(order.poolAddress) || this.statesByPool.get("") || [];
      const state = frames.find((x) => x.timestamp >= target) || frames[frames.length - 1];
      if (order.side === "SELL" || order.emergency) {
        this.recordStage(order.orderId, "QUOTING", "Emergency or sell exit quote");
        this.overlays.delete(order.poolAddress);
        if (!state) {
          return this.reject(order, "STALE_STATE", delay, 0n, 0n, "No market state available for exit quote");
        }
        const preTradeReserves2 = state.reserves;
        let realized = 0, outSol = 0n, postReserves = { sol: preTradeReserves2.sol, token: preTradeReserves2.token }, impact2 = 0;
        const isStaleOrMigrated = !state || Date.now() - state.timestamp > 15e3 || !order.emergency && state.timestamp < order.triggerTimestamp || state.migrated;
        if (state && (!isStaleOrMigrated || order.emergency)) {
          try {
            const q2 = quote({ ...state, reserves: preTradeReserves2 }, "SELL", order.amountLamports);
            realized = q2.realized;
            outSol = q2.out;
            postReserves = q2.post;
            const ratio2 = q2.realized / q2.spot;
            impact2 = Math.max(0, (1 - ratio2) * 100);
          } catch {
          }
        }
        if (outSol <= 0n || realized <= 0) {
          if (order.emergency || order.fallbackPriceSol) {
            const fallbackPriceSol = order.fallbackPriceSol && order.fallbackPriceSol > 0 ? order.fallbackPriceSol : state?.price || 1e-7;
            const decimals = order.amountDecimals ?? 9;
            const tokenUnits = Number(order.amountLamports) / 10 ** decimals;
            outSol = BigInt(Math.max(1, Math.round(tokenUnits * fallbackPriceSol * 1e9)));
            realized = fallbackPriceSol;
            impact2 = 0;
          } else if (!state) {
            return this.reject(order, "STALE_STATE", delay, 0n, 0n, "No market state available for exit quote");
          } else if (isStaleOrMigrated) {
            return this.reject(order, "STALE_STATE", Math.max(delay, Date.now() - state.timestamp), state.slot, 0n, "Exit quote is stale or migrated");
          } else {
            return this.reject(order, "PRE_TRADE_RISK_REJECTED", delay, state.slot, 0n, "Exit quote has no positive proceeds");
          }
        }
        const lag2 = state ? Math.max(delay, state.timestamp - order.triggerTimestamp) : delay;
        this.recordStage(order.orderId, "SIGNING", "Packing and signing exit transaction");
        this.recordStage(order.orderId, "SUBMITTING", "Submitting exit bundle");
        const history2 = this.recordStage(order.orderId, "SETTLED", "Exit filled and settled");
        const report2 = {
          orderId: order.orderId,
          status: "FILLED",
          execPrice: realized,
          inputAmount: order.amountLamports,
          outputAmount: outSol,
          priorityFeeLamports: 50000n,
          jitoTipLamports: 100000n,
          slotLatency: Math.max(1, Math.round(lag2 / SLOT_MS)),
          lifecycleHistory: history2,
          currentStage: "SETTLED"
        };
        return { report: report2, telemetry: { engineMode: "PAPER", simulatedSlotLagMs: lag2, priceImpactPct: impact2, preTradeReserves: preTradeReserves2, postTradeReserves: postReserves } };
      }
      if (!state) {
        return this.reject(order, "STALE_STATE", Math.max(delay, Date.now() - order.triggerTimestamp), 0n, 0n);
      }
      const lag = Math.max(delay, state.timestamp - order.triggerTimestamp);
      if (Date.now() - state.timestamp > 15e3 || lag > 6e4 || state.migrated) {
        return this.reject(order, "STALE_STATE", lag, state.slot, 0n);
      }
      this.recordStage(order.orderId, "QUOTING", "Calculating executable SDK curve quote");
      const overlay = this.overlays.get(order.poolAddress);
      const preTradeReserves = overlay ? overlay.reserves : state.reserves;
      const q = quote({ ...state, reserves: preTradeReserves }, order.side, order.amountLamports);
      const ratio = q.realized / q.spot;
      const impact = order.side === "BUY" ? Math.max(0, (ratio - 1) * 100) : Math.max(0, (1 - ratio) * 100);
      const tip = BigInt(Math.round(clamp(Number(order.amountLamports) * 0.02 * (1 + state.volatility), Number(this.tipFloor), Number(this.tipCeiling))));
      const priority = 50000n;
      const allowedSlippage = Math.max(order.maxSlippageBps, order.emergency ? 5e3 : order.maxSlippageBps);
      if (impact * 100 > allowedSlippage) {
        return this.reject(order, "SLIPPAGE_EXCEEDED", lag, state.slot, tip);
      }
      this.recordStage(order.orderId, "SIGNING", "Building and signing transaction with tip instruction");
      this.recordStage(order.orderId, "SUBMITTING", "Transmitting bundle with auction priority");
      const drop = Math.min(0.35, Math.max(0, state.volatility * 0.08));
      if (this.random() < drop) {
        return this.reject(order, "AUCTION_LOST", lag, state.slot, tip);
      }
      this.overlays.set(order.poolAddress, { poolAddress: order.poolAddress, reserves: q.post, appliedAtTimestamp: target, appliedAtSlot: state.slot + Math.round(lag / SLOT_MS) });
      const history = this.recordStage(order.orderId, "SETTLED", "Confirmed fill settled on chain");
      const report = {
        orderId: order.orderId,
        status: "FILLED",
        execPrice: q.realized,
        inputAmount: order.amountLamports,
        outputAmount: q.out,
        priorityFeeLamports: priority,
        jitoTipLamports: tip,
        slotLatency: Math.round(lag / SLOT_MS),
        lifecycleHistory: history,
        currentStage: "SETTLED"
      };
      return { report, telemetry: { engineMode: "PAPER", simulatedSlotLagMs: lag, priceImpactPct: impact, preTradeReserves, postTradeReserves: q.post } };
    } catch {
      if (order.side === "SELL" || order.emergency) {
        this.overlays.delete(order.poolAddress);
        if (order.emergency || order.fallbackPriceSol) {
          const fallbackPriceSol = order.fallbackPriceSol || 1e-7;
          const decimals = order.amountDecimals ?? 9;
          const tokenUnits = Number(order.amountLamports) / 10 ** decimals;
          const outSol = BigInt(Math.max(1, Math.round(tokenUnits * fallbackPriceSol * 1e9)));
          const history = this.recordStage(order.orderId, "SETTLED", "Fallback emergency exit executed");
          return {
            report: {
              orderId: order.orderId,
              status: "FILLED",
              execPrice: fallbackPriceSol,
              inputAmount: order.amountLamports,
              outputAmount: outSol,
              priorityFeeLamports: 50000n,
              jitoTipLamports: 0n,
              slotLatency: 1,
              lifecycleHistory: history,
              currentStage: "SETTLED"
            },
            telemetry: {
              engineMode: "PAPER",
              simulatedSlotLagMs: 0,
              priceImpactPct: 0,
              preTradeReserves: { sol: 0n, token: 0n },
              postTradeReserves: { sol: 0n, token: 0n }
            }
          };
        }
      }
      this.recordStage(order.orderId, "FAILED", "Execution timeout or cancelled");
      return this.reject(order, "STALE_STATE", Date.now() - order.triggerTimestamp, 0n, 0n);
    } finally {
      this.pending.delete(order.orderId);
    }
  }
  cancel(orderId) {
    this.recordStage(orderId, "REJECTED", "Order explicitly cancelled by operator");
    this.pending.get(orderId)?.abort();
  }
  cancelAllBuys() {
    for (const id of this.pending.keys()) this.pending.get(id)?.abort();
    this.clearOverlay();
  }
  panicClose(poolAddress) {
    this.clearOverlay(poolAddress);
  }
  sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(ms, 3e3));
      const stop = () => {
        clearTimeout(timer);
        reject(new Error("STALE_STATE"));
      };
      if (signal.aborted) stop();
      else signal.addEventListener("abort", stop, { once: true });
    });
  }
  reject(order, reason, lag, slot, tip, stageDetail) {
    const history = this.recordStage(order.orderId, reason === "STALE_STATE" ? "EXPIRED" : "REJECTED", stageDetail || reason);
    const report = {
      orderId: order.orderId,
      status: reason === "STALE_STATE" ? "EXPIRED" : "REJECTED",
      execPrice: 0,
      inputAmount: order.amountLamports,
      outputAmount: 0n,
      priorityFeeLamports: reason === "SLIPPAGE_EXCEEDED" ? 50000n : 0n,
      jitoTipLamports: 0n,
      slotLatency: Math.round(lag / SLOT_MS),
      failureReason: reason,
      lifecycleHistory: history,
      currentStage: reason === "STALE_STATE" ? "EXPIRED" : "REJECTED"
    };
    return { report, telemetry: { engineMode: "PAPER", simulatedSlotLagMs: lag, priceImpactPct: 0, preTradeReserves: { sol: 0n, token: 0n }, postTradeReserves: { sol: 0n, token: 0n } } };
  }
};
var EngineFactory = class {
  static create(config, onDrift) {
    if (config.mode === "PAPER") {
      const p = config.paper ?? {};
      const engine = new SimulatedEngine(p.seed ?? 7, p.tipFloorLamports ?? 100000n, p.tipCeilingLamports ?? 10000000n);
      if (onDrift) engine.setDriftListener(onDrift);
      return engine;
    }
    if (config.mode === "LIVE") throw new Error("Live execution transport is intentionally unavailable in this credential-free build.");
    throw new Error(`Unsupported engine mode: ${String(config.mode)}`);
  }
};
export {
  AdverseSelectionTracker,
  EngineFactory,
  SimulatedEngine,
  computeTrancheSlippageBps
};
