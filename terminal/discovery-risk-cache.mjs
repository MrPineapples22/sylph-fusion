// Read-only discovery enrichment. Failed or pending scans never become evidence.
export function createDiscoveryRiskCache({scan, onChange = () => {}, now = Date.now,
  concurrency = 4, capacity = 200, refreshMs = 40_000, retryMs = 10_000}) {
  for (const value of [concurrency, capacity, refreshMs, retryMs]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError('Invalid discovery cache limit');
  }
  const risks = new Map();
  const entries = new Map();
  const pending = new Map();
  let active = 0;
  let stopped = false;

  function drain() {
    while (!stopped && active < concurrency && pending.size) {
      const [mint, entry] = pending.entries().next().value;
      pending.delete(mint);
      entry.running = true;
      active++;
      Promise.resolve().then(() => {
        if (!stopped && entries.get(mint) === entry) return scan(mint);
      }).then(risk => {
        if (stopped || entries.get(mint) !== entry) return;
        const receivedAt = now();
        const validTimestamp = value => Number.isFinite(value) && value > 0 && value <= receivedAt;
        if (!risk || typeof risk !== 'object' || Array.isArray(risk) || !validTimestamp(risk.at)) return;
        // A manual scan may have published while this request was in flight.
        // Keep the newer observation, without changing either evidence time.
        const existing = risks.get(mint);
        if (validTimestamp(existing?.at) && existing.at >= risk.at) return;
        risks.set(mint, risk);
        onChange();
      }).catch(() => {
        // Preserve absence or the original timestamp of older evidence.
      }).finally(() => {
        entry.running = false;
        entry.retryAt = now() + retryMs;
        active--;
        drain();
      });
    }
  }

  function refresh(tokens, timestamp = now()) {
    if (stopped) return;
    const wanted = new Set();
    for (const token of tokens) {
      if (typeof token?.mint === 'string' && token.mint) wanted.add(token.mint);
      if (wanted.size >= capacity) break;
    }
    for (const mint of entries.keys()) {
      if (!wanted.has(mint)) {
        entries.delete(mint);
        pending.delete(mint);
      }
    }
    // Manual requests can populate evidence without a scheduler entry.
    for (const mint of risks.keys()) {
      if (!wanted.has(mint)) risks.delete(mint);
    }
    for (const mint of wanted) {
      let entry = entries.get(mint);
      if (!entry) entries.set(mint, entry = {running: false, retryAt: 0});
      const evidence = risks.get(mint);
      const fresh = Number.isFinite(evidence?.at) && evidence.at > 0 &&
        evidence.at <= timestamp && timestamp - evidence.at < refreshMs;
      if (!fresh && !entry.running && timestamp >= entry.retryAt) pending.set(mint, entry);
    }
    drain();
  }

  return {risks, refresh, stop() {
    stopped = true;
    pending.clear();
    entries.clear();
    risks.clear();
  }};
}
