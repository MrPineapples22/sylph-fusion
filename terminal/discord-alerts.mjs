const WEBHOOK_PATH = /^\/api\/webhooks\/\d{5,22}\/[A-Za-z0-9._-]{20,}$/;
const SOURCE_ID = /^[A-Z0-9_-]{1,64}$/;

function validateWebhook(value) {
  if (!value?.trim()) return {status: 'DISABLED', url: null};
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'discord.com' || url.port || url.username || url.password ||
      url.search || url.hash || !WEBHOOK_PATH.test(url.pathname)) return {status: 'INVALID_CONFIG', url: null};
    return {status: 'READY', url: url.toString()};
  } catch {
    return {status: 'INVALID_CONFIG', url: null};
  }
}

/**
 * Optional output-only Discord incident notifier. It accepts only sanitized
 * provider identifiers and fixed message templates; webhook responses and
 * Discord messages are never interpreted as commands or policy inputs.
 */
export function createDiscordAlertService({webhookUrl = '', fetchImpl = fetch, timeoutMs = 2500} = {}) {
  const config = validateWebhook(webhookUrl);
  const announced = new Set();
  let deliveredCount = 0;
  let lastSuccessMs = null;
  let lastStatus = config.status;
  let busy = false;

  const status = () => Object.freeze({
    provider: 'Discord webhook',
    status: lastStatus,
    configured: config.status === 'READY',
    outputOnly: true,
    deliveredCount,
    lastSuccessMs,
  });

  async function send(content, now) {
    if (config.status !== 'READY') return false;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
      lastStatus = 'INVALID_CONFIG';
      return false;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(config.url, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({content, allowed_mentions: {parse: []}}),
      });
      if (!response.ok) {
        lastStatus = response.status === 429 ? 'RATE_LIMITED' : 'DELIVERY_FAILED';
        return false;
      }
      lastStatus = 'CONNECTED';
      lastSuccessMs = now;
      deliveredCount += 1;
      return true;
    } catch (error) {
      lastStatus = error?.name === 'AbortError' ? 'TIMEOUT' : 'DELIVERY_FAILED';
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function observe(report, now = Date.now()) {
    if (busy || config.status !== 'READY') return status();
    busy = true;
    try {
      const current = new Set((Array.isArray(report?.activeAlerts) ? report.activeAlerts : [])
        .filter(alert => alert?.severity === 'CRITICAL' && typeof alert.source === 'string' && SOURCE_ID.test(alert.source))
        .map(alert => alert.source));
      for (const source of current) {
        if (announced.has(source)) continue;
        const delivered = await send(`Sylph Fusion alert: provider ${source} entered CRITICAL state. Notification only; review the local operator dashboard.`, now);
        if (delivered) announced.add(source);
      }
      for (const source of [...announced]) {
        if (current.has(source)) continue;
        const delivered = await send(`Sylph Fusion update: provider ${source} no longer reports a CRITICAL condition. Notification only; verify current provider health locally.`, now);
        if (delivered) announced.delete(source);
      }
      return status();
    } finally {
      busy = false;
    }
  }

  return Object.freeze({observe, getStatus: status});
}
