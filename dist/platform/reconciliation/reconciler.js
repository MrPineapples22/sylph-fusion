/**
 * SOL-SYLPH Multi-User Platform - Continuous Multi-Way Reconciler
 * Specifications: Sections VI (Double-Entry Invariance), XLVI (Continuous Reconciliation).
 *
 * Rules:
 * 1. Continuously compare:
 *    - On-chain verified balance
 *    - Signing service confirmed records
 *    - Internal event ledger
 *    - Customer liabilities
 *    - Platform treasury
 * 2. Unexplained discrepancy > 0 lamports triggers RECONCILIATION_ALERT.
 * 3. Material discrepancies block new risk and settlement until resolved.
 */
import { randomUUID } from 'node:crypto';
export class ContinuousReconciler {
    lastRunResult;
    alertHistory = [];
    reconcile(inputs) {
        const now = Date.now();
        const runId = randomUUID();
        const alerts = [];
        // 1. Invariant 1: On-Chain Assets vs Internal Ledger Controlled Assets
        const onChainVsLedgerDiff = inputs.onChainBalanceLamports - inputs.ledgerControlledAssetsLamports;
        if (onChainVsLedgerDiff !== 0n) {
            alerts.push({
                alertId: randomUUID(),
                timestamp: now,
                severity: 'CRITICAL',
                discrepancyLamports: onChainVsLedgerDiff > 0n ? onChainVsLedgerDiff : -onChainVsLedgerDiff,
                explanation: `On-chain balance (${inputs.onChainBalanceLamports}) does not match internal ledger controlled assets (${inputs.ledgerControlledAssetsLamports}). Delta: ${onChainVsLedgerDiff}`,
                affectedDomains: ['BLOCKCHAIN', 'LEDGER'],
            });
        }
        // 2. Invariant 2: Fundamental Conservation Identity
        // Controlled Assets ≈ Customer Liabilities + Platform Treasury + Explicitly Accounted Differences
        const totalAccountedLiabilities = inputs.vaultCustomerLiabilitiesLamports + inputs.platformTreasuryLamports + inputs.explicitDiscrepancyLamports;
        const conservationDelta = inputs.ledgerControlledAssetsLamports - totalAccountedLiabilities;
        if (conservationDelta !== 0n) {
            alerts.push({
                alertId: randomUUID(),
                timestamp: now,
                severity: 'FATAL',
                discrepancyLamports: conservationDelta > 0n ? conservationDelta : -conservationDelta,
                explanation: `Accounting identity violation: Controlled Assets (${inputs.ledgerControlledAssetsLamports}) != Liabilities + Treasury + Discrepancy (${totalAccountedLiabilities}). Unexplained gap: ${conservationDelta}`,
                affectedDomains: ['LEDGER', 'CUSTOMER_VAULTS', 'TREASURY'],
            });
        }
        const isClean = alerts.length === 0;
        const result = {
            runId,
            timestamp: now,
            isClean,
            deltaLamports: conservationDelta,
            inputs,
            alerts,
        };
        this.lastRunResult = result;
        if (alerts.length > 0) {
            this.alertHistory.push(...alerts);
        }
        return result;
    }
    getLastRun() {
        return this.lastRunResult;
    }
    isSystemReconciliationClean() {
        return this.lastRunResult ? this.lastRunResult.isClean : false;
    }
    getAlertHistory() {
        return this.alertHistory;
    }
}
//# sourceMappingURL=reconciler.js.map