/**
 * SENTINEL: Zero-Trust Integrity & Security Architecture
 * Blueprint Engine #28
 *
 * Enforces strict boundary isolation across 6 Security Zones:
 * - ZONE 0: SIGNING (Hardware/Vault signer, zero intelligence/research access)
 * - ZONE 1: EXECUTION (RPC Gateway, transaction submission, receipt reconciliation)
 * - ZONE 2: RISK (Guardian hard risk authority, exposure/drawdown non-bypassable limits)
 * - ZONE 3: INTELLIGENCE (Bohr, Bayes, Einstein, Kepler, Hawking, etc.)
 * - ZONE 4: EXTERNAL DATA (PumpPortal, DexScreener, RPC websockets, RugCheck)
 * - ZONE 5: RESEARCH (Franklin, Da Vinci, offline labs, replay engines)
 *
 * Invariant: AI != SIGNER | PREDICTION != AUTHORIZATION
 * No private keys in Atlas, CSV, logs, prompts, or UI.
 */
export class SentinelSecurityZonesEngine {
    static VERSION = '1.0.0';
    static KEY_REGEX = /(?:[1-9A-HJ-NP-Za-km-z]{43,88}|[0-9a-fA-F]{64})/g;
    /**
     * Sanitizes text strings and logs to guarantee no Solana base58 private keys or hex seeds leak.
     */
    static sanitizeTelemetry(content) {
        if (!content || typeof content !== 'string')
            return '';
        return content.replace(this.KEY_REGEX, '[REDACTED_SECRET_KEY]');
    }
    /**
     * Validates cross-zone communication and blocks unauthorized privilege escalation.
     */
    static assertZoneAccess(callerZone, targetZone, action) {
        // Zero-access rule: Intelligence (Zone 3) or Research (Zone 5) cannot directly access Signing (Zone 0) or Execution (Zone 1)
        if (callerZone === 'ZONE_3_INTELLIGENCE' || callerZone === 'ZONE_5_RESEARCH') {
            if (targetZone === 'ZONE_0_SIGNING') {
                throw new Error(`[SENTINEL SECURITY VIOLATION] Unauthorized direct access from ${callerZone} to ${targetZone} for action: ${action}. AI != SIGNER.`);
            }
            if (targetZone === 'ZONE_1_EXECUTION') {
                throw new Error(`[SENTINEL SECURITY VIOLATION] Unauthorized bypass: ${callerZone} cannot invoke ${targetZone} directly without Zone 2 (Guardian Risk).`);
            }
        }
        // External data (Zone 4) cannot access anything above Zone 3 directly
        if (callerZone === 'ZONE_4_EXTERNAL_DATA') {
            if (targetZone === 'ZONE_0_SIGNING' || targetZone === 'ZONE_1_EXECUTION' || targetZone === 'ZONE_2_RISK') {
                throw new Error(`[SENTINEL SECURITY VIOLATION] External untrusted data (${callerZone}) cannot access privileged ${targetZone}.`);
            }
        }
    }
    /**
     * Verifies that an execution permit was legitimately issued by Zone 2 (Guardian),
     * is within its TTL window, and has not expired.
     */
    static verifyExecutionPermit(permit, nowMs = Date.now()) {
        if (!permit.authorized_by_guardian) {
            return { is_valid: false, reason: 'Permit lacks authoritative Guardian authorization signature.' };
        }
        if (nowMs > permit.expires_at_ms) {
            return {
                is_valid: false,
                reason: `Permit expired ${nowMs - permit.expires_at_ms}ms ago. Stale execution intent rejected.`
            };
        }
        if (permit.max_slippage_bps > 2500) {
            return { is_valid: false, reason: `Permit slippage (${permit.max_slippage_bps} bps) exceeds hard safety boundary.` };
        }
        return { is_valid: true };
    }
}
//# sourceMappingURL=sentinel-zones.js.map