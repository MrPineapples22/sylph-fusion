/**
 * SYLPH FUSION — EMERGENCY EXIT RESOURCE PARTITION
 * Specifications: Blueprint Section 48
 * Workbook: #519 (Emergency-Reserve Partition)
 *
 * Invariant:
 * 1. Dedicated resources are strictly partitioned for risk reduction (A2 REDUCE/CLOSE).
 * 2. New entry intents (A3/A4) CANNOT consume, borrow, or encumber the emergency partition.
 * 3. Emergency partition guarantees exit capacity during network congestion or degradation.
 */
export class EmergencyPartitionManager {
    partition;
    constructor(partition) {
        this.partition = partition;
    }
    getPartition() {
        return this.partition;
    }
    /**
     * Evaluates resource availability.
     * Prohibits non-risk-reducing entries (A3/A4) from encroaching into the emergency reserve.
     */
    evaluateAllocation(availableCashLamports, request) {
        const isRiskReducing = request.actionLattice === 'A2_REDUCE';
        // Total required emergency buffer
        const emergencyBuffer = this.partition.emergencyFeeReserveLamports + this.partition.emergencyJitoTipLamports;
        // For non-risk-reducing actions, available cash is strictly capped above the emergency buffer
        const usableCash = availableCashLamports > emergencyBuffer ? availableCashLamports - emergencyBuffer : 0n;
        if (!isRiskReducing) {
            if (request.requestedCashLamports > usableCash) {
                return {
                    isApproved: false,
                    unencumberedAvailableLamports: usableCash,
                    reason: `EMERGENCY_PARTITION_ENCROACHMENT: Requested ${request.requestedCashLamports} lamports exceeds unencumbered capital ${usableCash} (emergency buffer ${emergencyBuffer} is protected for A2 exits)`,
                };
            }
        }
        else {
            // Risk reducing actions CAN access emergency funds
            if (request.requestedCashLamports > availableCashLamports) {
                return {
                    isApproved: false,
                    unencumberedAvailableLamports: availableCashLamports,
                    reason: `INSUFFICIENT_TOTAL_CASH: Requested exit ${request.requestedCashLamports} exceeds total ${availableCashLamports}`,
                };
            }
        }
        return {
            isApproved: true,
            unencumberedAvailableLamports: isRiskReducing ? availableCashLamports : usableCash,
        };
    }
}
//# sourceMappingURL=emergency-partition.js.map