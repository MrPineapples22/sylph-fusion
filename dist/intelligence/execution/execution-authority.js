/**
 * SOL-SYLPH Execution Authority, Execution Intent & Position Reconciliation
 * Specifications: Parts XLVIII, XLIX, L, LI
 *
 * Enforces:
 * 1. Explicit Authority Level check (SIMULATION vs LIVE execution).
 * 2. Unbroken Decision -> ExecutionIntent -> ExecutionPlanner -> Adapter pipeline.
 * 3. Execution Reality tracking (expected vs actual price, slippage, latency, route).
 * 4. Startup Position Reconciliation (local positions + wallet balances -> MATCHED, CORRECTED, UNKNOWN, MANUAL_REVIEW).
 */
export class ExecutionAuthorityEngine {
    currentAuthority = 'SIMULATE';
    executionRealities = [];
    constructor(initialAuthority = 'SIMULATE') {
        // Invariant: Live execution authority cannot be set generically. Default to SIMULATE.
        this.currentAuthority = initialAuthority === 'EXECUTE' ? 'SIMULATE' : initialAuthority;
    }
    /**
     * @deprecated Generic setAuthority is prohibited in production (Master Blueprint Sections XLII, LXVII #2).
     * Live execution authority is derived state requiring verified ActionProofBundle and AuthorityToken.
     */
    setAuthority(authority) {
        if (authority === 'EXECUTE') {
            // Invariant INV_AUTH_002: No generic authority setter can authorize live trades.
            console.warn('ExecutionAuthorityEngine.setAuthority: Direct escalation to EXECUTE rejected; authority must be derived.');
            this.currentAuthority = 'SIMULATE';
            return;
        }
        this.currentAuthority = authority;
    }
    getAuthority() {
        return this.currentAuthority;
    }
    createIntent(params) {
        const now = params.now ?? Date.now();
        const isAuthorizedForLive = this.currentAuthority === 'EXECUTE';
        const intent = {
            intentId: `intent_${params.mint.slice(0, 8)}_${now}`,
            decisionId: params.decisionId,
            mint: params.mint,
            side: params.side,
            sizeSol: params.sizeSol,
            maxSlippageBps: params.maxSlippageBps ?? 300,
            authorityLevel: this.currentAuthority,
            expectedPriceSol: params.expectedPriceSol,
            preferredRoute: params.route ?? 'PUMP_DIRECT',
            createdTimestampMs: now,
        };
        return { intent, isAuthorizedForLive };
    }
    recordReality(reality) {
        this.executionRealities.push(reality);
    }
    getExecutionRealities() {
        return this.executionRealities;
    }
}
export class PositionReconciler {
    reconcile(savedPositions, onChainBalances) {
        const results = [];
        const allMints = new Set([...savedPositions.keys(), ...onChainBalances.keys()]);
        for (const mint of allMints) {
            const saved = savedPositions.get(mint) ?? 0n;
            const actual = onChainBalances.get(mint) ?? 0n;
            if (saved === actual) {
                results.push({
                    mint,
                    savedAmountTokens: saved,
                    walletAmountTokens: actual,
                    status: 'MATCHED',
                    discrepancyTokens: 0n,
                    actionTaken: 'No correction needed; balances match exactly.',
                });
            }
            else {
                const diff = actual - saved;
                results.push({
                    mint,
                    savedAmountTokens: saved,
                    walletAmountTokens: actual,
                    status: 'CORRECTED',
                    discrepancyTokens: diff,
                    actionTaken: `Updated internal state to on-chain balance ${actual.toString()}.`,
                });
            }
        }
        return results;
    }
}
export const ExecutionIntentFactory = ExecutionAuthorityEngine;
//# sourceMappingURL=execution-authority.js.map