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
        try {
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
            const resp = await this.fetchFn(this.jitoRpcUrl, {
                method: 'POST',
                headers,
                body,
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!resp.ok) {
                return {
                    bundleId,
                    signature,
                    status: 'UNKNOWN',
                    latencyMs: Date.now() - started,
                    terminal: false,
                    failureReason: 'HTTP_' + String(resp.status),
                };
            }
            const json = (await resp.json());
            const item = json.result?.value?.[0];
            if (!item) {
                return {
                    bundleId,
                    signature,
                    status: 'INFLIGHT_PENDING',
                    latencyMs: Date.now() - started,
                    terminal: false,
                };
            }
            if (item.status === 'Landed') {
                return {
                    bundleId,
                    signature,
                    status: 'BUNDLE_LANDED',
                    landedSlot: item.landed_slot,
                    latencyMs: Date.now() - started,
                    terminal: true,
                };
            }
            if (item.status === 'Failed') {
                return {
                    bundleId,
                    signature,
                    status: 'AUCTION_LOST',
                    failureReason: 'BUNDLE_DROPPED_BY_LEADER',
                    latencyMs: Date.now() - started,
                    terminal: true,
                };
            }
            if (item.status === 'Invalid') {
                return {
                    bundleId,
                    signature,
                    status: 'RELAY_UNAVAILABLE',
                    failureReason: 'BUNDLE_DROPPED_BY_JITO_RELAY_NON_TERMINAL',
                    latencyMs: Date.now() - started,
                    terminal: false,
                };
            }
            return {
                bundleId,
                signature,
                status: 'INFLIGHT_PENDING',
                latencyMs: Date.now() - started,
                terminal: false,
            };
        }
        catch (e) {
            return {
                bundleId,
                signature,
                status: 'UNKNOWN',
                latencyMs: Date.now() - started,
                terminal: false,
                failureReason: e?.message || 'NETWORK_ERROR',
            };
        }
    }
}
//# sourceMappingURL=jito-lifecycle-coordinator.js.map