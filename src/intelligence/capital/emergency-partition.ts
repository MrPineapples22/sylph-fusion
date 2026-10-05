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

export interface EmergencyResourcePartition {
  readonly emergencyFeeReserveLamports: bigint;
  readonly emergencyJitoTipLamports: bigint;
  readonly reservedExitRpcBandwidthRequestsPerSec: number;
  readonly minimumExitComputeUnits: number;
  readonly totalCapitalLamports: bigint;
}

export interface ResourceAllocationRequest {
  readonly intentId: string;
  readonly actionLattice: 'A0_OBSERVE' | 'A1_SIMULATE' | 'A2_REDUCE' | 'A3_MAINTAIN' | 'A4_EXPAND';
  readonly requestedCashLamports: bigint;
  readonly requestedFeeLamports: bigint;
}

export class EmergencyPartitionManager {
  private readonly partition: EmergencyResourcePartition;

  constructor(partition: EmergencyResourcePartition) {
    this.partition = partition;
  }

  public getPartition(): EmergencyResourcePartition {
    return this.partition;
  }

  /**
   * Evaluates resource availability.
   * Prohibits non-risk-reducing entries (A3/A4) from encroaching into the emergency reserve.
   */
  public evaluateAllocation(
    availableCashLamports: bigint,
    request: ResourceAllocationRequest
  ): { isApproved: boolean; unencumberedAvailableLamports: bigint; reason?: string } {
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
    } else {
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
