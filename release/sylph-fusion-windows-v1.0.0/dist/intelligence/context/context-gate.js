/**
 * SOL-SYLPH Intelligence Fabric - Pre-Execution Context Gate
 * Specifications: Section 30 (Context Gate).
 *
 * Rules:
 * 1. Executes immediately before transaction building and signing.
 * 2. Checks: quote freshness, snapshot freshness, route validity, network state, kill switches.
 * 3. Possible outputs: AUTHORIZE, REQUOTE, WAIT, REDECIDE, REJECT, SAFE_MODE.
 */
export class ContextGate {
    /**
     * Authorize or reject immediate transaction dispatch based on live runtime context.
     */
    static authorize(inputs) {
        const now = Date.now();
        // 1. Global Kill Switch check
        if (inputs.isKillSwitchActive) {
            return {
                decision: 'SAFE_MODE',
                isPermittedToSign: false,
                reason: 'CONTEXT_GATE: Global emergency kill-switch is active',
                checkedAtMs: now,
            };
        }
        // 2. Risk Engine Capital Authorization check
        if (!inputs.isRiskAuthorized) {
            return {
                decision: 'REJECT',
                isPermittedToSign: false,
                reason: 'CONTEXT_GATE: Risk engine has not authorized capital deployment',
                checkedAtMs: now,
            };
        }
        // 3. Stale Quote check (> 1200ms)
        if (inputs.quoteAgeMs > 1200) {
            return {
                decision: 'REQUOTE',
                isPermittedToSign: false,
                reason: `CONTEXT_GATE: Stale swap quote (${inputs.quoteAgeMs} ms > 1200 ms threshold)`,
                checkedAtMs: now,
            };
        }
        // 4. Invalid or Broken Routing check
        if (!inputs.isRouteValid) {
            return {
                decision: 'REJECT',
                isPermittedToSign: false,
                reason: 'CONTEXT_GATE: Swap execution route is invalid or liquidity pool depleted',
                checkedAtMs: now,
            };
        }
        // 5. Degraded Network / Severe Slot Lag (> 20 slots)
        if (inputs.snapshot.networkState.congestionLevel === 'DEGRADED') {
            return {
                decision: 'WAIT',
                isPermittedToSign: false,
                reason: 'CONTEXT_GATE: Solana network degraded or zero healthy RPC providers available',
                checkedAtMs: now,
            };
        }
        // 6. Sol Shock Active -> Redecide sizing
        if (inputs.snapshot.solState.isShockActive) {
            return {
                decision: 'REDECIDE',
                isPermittedToSign: false,
                reason: 'CONTEXT_GATE: Active macro SOL price shock detected; thesis re-evaluation required',
                checkedAtMs: now,
            };
        }
        // 7. Liquidity Floor check (< 1.0 SOL)
        if (inputs.poolLiquiditySol < 1.0) {
            return {
                decision: 'REJECT',
                isPermittedToSign: false,
                reason: 'CONTEXT_GATE: Pool liquidity below minimum viable floor of 1.0 SOL',
                checkedAtMs: now,
            };
        }
        // All clear -> AUTHORIZE
        return {
            decision: 'AUTHORIZE',
            isPermittedToSign: true,
            reason: 'CONTEXT_GATE: All temporal, risk, network, and quote assertions verified',
            checkedAtMs: now,
        };
    }
}
//# sourceMappingURL=context-gate.js.map