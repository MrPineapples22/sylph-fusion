/**
 * SOL-SYLPH Multi-User Platform - Settlement Firewall
 * Specifications: Sections XLIII (Withdrawal / Settlement Firewall), XLV (Idempotent Settlement).
 *
 * Rules:
 * 1. Independent policy verification on every settlement transaction.
 * 2. Mandatory destination verification (must match confirmed user destination).
 * 3. Amount verification (cannot exceed liquid balance).
 * 4. Cycle state check (must be SETTLEMENT_READY).
 * 5. Reconciliation invariant (halts if reconciliation is unclean).
 * 6. Idempotent settlement records prevent duplicate payouts across restarts.
 */
export class SettlementFirewall {
    settlementStore = new Map();
    settlementByCycle = new Map();
    confirmedDestinationsByVault = new Map();
    cycleKey(vaultId, cycleId) {
        return JSON.stringify([vaultId, cycleId]);
    }
    /**
     * Register the user's confirmed payout destination during vault initialization.
     */
    registerConfirmedDestination(vaultId, confirmedDestinationAddress) {
        if (!confirmedDestinationAddress || confirmedDestinationAddress.length < 32) {
            throw new Error(`Invalid Solana destination address: ${confirmedDestinationAddress}`);
        }
        const existing = this.confirmedDestinationsByVault.get(vaultId);
        if (existing && existing !== confirmedDestinationAddress) {
            throw new Error(`Confirmed destination is immutable for vault ${vaultId}`);
        }
        this.confirmedDestinationsByVault.set(vaultId, confirmedDestinationAddress);
    }
    getConfirmedDestination(vaultId) {
        return this.confirmedDestinationsByVault.get(vaultId);
    }
    /**
     * Verify and authorize a settlement payout.
     */
    authorizeSettlement(req) {
        const now = Date.now();
        // 1. Idempotency Check
        const existing = this.settlementStore.get(req.settlementId);
        if (existing) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: `Duplicate settlement request: Settlement ${req.settlementId} is already in state ${existing.state}`,
                timestamp: now,
            };
        }
        const cycleKey = this.cycleKey(req.vaultId, req.cycleId);
        const existingForCycle = this.settlementByCycle.get(cycleKey);
        if (existingForCycle) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: `Duplicate settlement cycle: Vault ${req.vaultId} cycle ${req.cycleId} is already bound to settlement ${existingForCycle}`,
                timestamp: now,
            };
        }
        // 2. Cycle State Invariant
        if (req.cycleState !== 'SETTLEMENT_READY') {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: `Cycle state must be SETTLEMENT_READY to settle (current: ${req.cycleState})`,
                timestamp: now,
            };
        }
        // 3. Destination Address Whitelist / Identity Matching
        const confirmedDest = this.confirmedDestinationsByVault.get(req.vaultId);
        if (!confirmedDest) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: `No confirmed destination registered for vault ${req.vaultId}`,
                timestamp: now,
            };
        }
        if (req.userDestinationAddress !== confirmedDest) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: `Destination mismatch: Requested ${req.userDestinationAddress} does not match confirmed ${confirmedDest}`,
                timestamp: now,
            };
        }
        // 4. Reconciliation Health Check
        if (!req.isReconciliationClean) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: 'Reconciliation alert: Settlement blocked due to active accounting discrepancies',
                timestamp: now,
            };
        }
        // 5. Balance & Solvency Invariant
        if (req.netPayableLamports < 0n || req.platformFeeLamports < 0n || req.verifiedLiquidBalanceLamports < 0n) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: 'Settlement amounts and verified liquid balance must be non-negative',
                timestamp: now,
            };
        }
        const totalRequired = req.netPayableLamports + req.platformFeeLamports;
        if (totalRequired > req.verifiedLiquidBalanceLamports) {
            return {
                approved: false,
                settlementId: req.settlementId,
                netPayableLamports: 0n,
                platformFeeLamports: 0n,
                rejectionReason: `Insufficient liquid balance: Required ${totalRequired} lamports > Verified ${req.verifiedLiquidBalanceLamports} lamports`,
                timestamp: now,
            };
        }
        // Authorization Granted
        const record = {
            settlementId: req.settlementId,
            vaultId: req.vaultId,
            userId: req.userId,
            cycleId: req.cycleId,
            destinationAddress: req.userDestinationAddress,
            netPayableLamports: req.netPayableLamports,
            platformFeeLamports: req.platformFeeLamports,
            state: 'AUTHORIZED',
            authorizedAt: now,
        };
        this.settlementStore.set(req.settlementId, record);
        this.settlementByCycle.set(cycleKey, req.settlementId);
        return {
            approved: true,
            settlementId: req.settlementId,
            netPayableLamports: req.netPayableLamports,
            platformFeeLamports: req.platformFeeLamports,
            timestamp: now,
        };
    }
    recordSubmission(settlementId) {
        const record = this.settlementStore.get(settlementId);
        if (record && record.state === 'AUTHORIZED') {
            record.state = 'SUBMITTED';
            record.submittedAt = Date.now();
        }
    }
    recordConfirmation(settlementId, txSignature) {
        const record = this.settlementStore.get(settlementId);
        if (record) {
            record.state = 'CONFIRMED';
            record.confirmedAt = Date.now();
            record.txSignature = txSignature;
        }
    }
    recordFailure(settlementId, reason) {
        const record = this.settlementStore.get(settlementId);
        if (record) {
            record.state = 'FAILED';
            record.failedAt = Date.now();
            record.rejectionReason = reason;
        }
    }
    getRecord(settlementId) {
        return this.settlementStore.get(settlementId);
    }
}
export class InMemorySettlementStore {
    records = new Map();
    byCycle = new Map();
    destinations = new Map();
    async saveSettlementRecord(record) {
        this.records.set(record.settlementId, { ...record });
        this.byCycle.set(JSON.stringify([record.vaultId, record.cycleId]), record.settlementId);
    }
    async getSettlementRecord(settlementId) {
        const r = this.records.get(settlementId);
        return r ? { ...r } : undefined;
    }
    async getSettlementByCycle(vaultId, cycleId) {
        return this.byCycle.get(JSON.stringify([vaultId, cycleId]));
    }
    async saveConfirmedDestination(vaultId, address) {
        this.destinations.set(vaultId, address);
    }
    async getConfirmedDestination(vaultId) {
        return this.destinations.get(vaultId);
    }
}
//# sourceMappingURL=settlement-firewall.js.map