/**
 * SYLPH FUSION — JITO LIFECYCLE COORDINATOR
 * Specifications: Sections 29 (Jito/Leader Intelligence), 37 (Execution Generations).
 *
 * Provides sub-second inflight bundle status tracking using Jito's JSON-RPC:
 * - getInflightBundleStatuses
 * - getBundleStatuses
 *
 * Eliminates the 15-second blind spot where dropped bundles stall capital.
 */
export class JitoLifecycleCoordinator {
    jitoRpcUrl;
    jitoAuth;
    timeoutMs;
    fetchFn;
    constructor(jitoRpcUrl, jitoAuth, timeoutMs = 2000, fetchFn = fetch) {
        this.jitoRpcUrl = jitoRpcUrl;
        this.jitoAuth = jitoAuth;
        this.timeoutMs = timeoutMs;
        this.fetchFn = fetchFn;
    }
    /**
     * Fast-poll inflight bundle status to detect dropped bundles in <800ms.
     */
    async checkInflightStatus(bundleId, signature) {
        const started = Date.now();
        const unknown = (failureReason) => ({ bundleId, signature, status: 'UNKNOWN',
            latencyMs: Date.now() - started, terminal: false, failureReason });
        try {
            if (!bundleId || !signature || !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 100 || this.timeoutMs > 30_000) {
                return unknown('INVALID_REQUEST');
            }
            const headers = { 'content-type': 'application/json' };
            if (this.jitoAuth) {
                headers['x-jito-auth'] = this.jitoAuth;
            }
            const body = JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getInflightBundleStatuses',
                params: [[bundleId]],
            });
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
            try {
                const resp = await this.fetchFn(this.jitoRpcUrl, { method: 'POST', headers, body, signal: controller.signal, redirect: 'error' });
                if (!resp.ok)
                    return unknown(`HTTP_${resp.status}`);
                const payload = await resp.json();
                if (!payload || payload.jsonrpc !== '2.0' || payload.id !== 1 || payload.error != null)
                    return unknown('JSON_RPC_RESPONSE_INVALID');
                const values = payload?.result?.value;
                // Jito retains inflight statuses for five minutes. null/empty and
                // Invalid mean no retained outcome, not that the relay failed or the
                // transaction failed. Chain reconciliation remains authoritative.
                if (values === null || (Array.isArray(values) && values.length === 0))
                    return {
                        bundleId, signature, status: 'STATUS_NOT_RETAINED', failureReason: 'BUNDLE_NOT_FOUND_IN_INFLIGHT_WINDOW',
                        latencyMs: Date.now() - started, terminal: false,
                    };
                if (!Array.isArray(values))
                    return unknown('STATUS_RESPONSE_INVALID');
                const item = values[0];
                if (!item)
                    return { bundleId, signature, status: 'STATUS_NOT_RETAINED', failureReason: 'BUNDLE_NOT_FOUND_IN_INFLIGHT_WINDOW',
                        latencyMs: Date.now() - started, terminal: false };
                if (item.bundle_id !== bundleId)
                    return unknown('BUNDLE_ID_MISMATCH');
                if (item.status === 'Landed') {
                    if (!Number.isSafeInteger(item.landed_slot) || item.landed_slot <= 0)
                        return unknown('LANDED_SLOT_INVALID');
                    return { bundleId, signature, status: 'BUNDLE_LANDED', landedSlot: item.landed_slot,
                        latencyMs: Date.now() - started, terminal: true };
                }
                if (item.status === 'Failed')
                    return { bundleId, signature, status: 'AUCTION_LOST',
                        failureReason: 'BUNDLE_DROPPED_BY_LEADER', latencyMs: Date.now() - started, terminal: true };
                if (item.status === 'Invalid')
                    return { bundleId, signature, status: 'STATUS_NOT_RETAINED',
                        failureReason: 'BUNDLE_NOT_FOUND_IN_INFLIGHT_WINDOW', latencyMs: Date.now() - started, terminal: false };
                if (item.status === 'Pending')
                    return { bundleId, signature, status: 'INFLIGHT_PENDING', latencyMs: Date.now() - started, terminal: false };
                return unknown('BUNDLE_STATUS_INVALID');
            }
            finally {
                clearTimeout(timeout);
            }
        }
        catch (e) {
            return unknown(e instanceof Error && e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
        }
    }
}
//# sourceMappingURL=jito-lifecycle-coordinator.js.map