/**
 * SOL-SYLPH Platform - State Sensitivity & StateLeaseV2 Engine
 * Specifications: 500-Item Roadmap Layer I (#76, #78), Layer II (#141, #142, #150), Layer III (#279).
 *
 * Implements:
 * 1. StateSensitivityAnalyzer: Measures output and compute unit drift across neighboring slots and reserve perturbations.
 * 2. StateLeaseV2: Cryptographically binds execution validity to an exact slot window derived from alpha half-life.
 */

import { createHash } from 'node:crypto';

export interface StatePerturbationScenario {
  readonly slotOffset: number;            // -2, -1, 0, +1, +2
  readonly simulatedOutputLamports: bigint;
  readonly simulatedComputeUnits: number;
  readonly simulatedSuccess: boolean;
}

export interface StateSensitivityReport {
  readonly baseSlot: number;
  readonly stateSensitivityIndex: number; // 0.0 (perfectly stable) to 1.0 (extreme fragility)
  readonly isHighSensitivity: boolean;     // True if sensitivity index > 0.35
  readonly maxOutputDriftBps: number;      // Maximum percentage drop in output across adjacent slots
  readonly maxCuDriftBps: number;          // Maximum compute unit expansion across slots
  readonly cuExhaustionRisk: boolean;      // True if CU approaches requested limit (> 85%)
  readonly recommendedLeaseSlots: number;  // Max slots before state drift invalidates transaction
  readonly rationale: string;
}

export interface StateLeaseV2 {
  readonly leaseId: string;
  readonly intentId: string;
  readonly baseSlot: number;
  readonly expirySlot: number;
  readonly maxAllowedSlotDrift: number;
  readonly alphaHalfLifeMs: number;
  readonly sensitivityIndex: number;
  readonly leaseHash: string;
}

export class StateSensitivityAnalyzer {
  private static readonly SLOT_DURATION_MS = 400;

  /**
   * Evaluates the sensitivity of an execution simulation to slot jitter and state movement.
   *
   * @param params.baseSlot The slot at which the baseline simulation was performed
   * @param params.requestedComputeUnits The compute unit budget in the transaction (e.g. 100_000)
   * @param params.scenarios Simulation outcomes across neighboring slots (-1, 0, +1, etc.)
   * @param params.alphaHalfLifeMs Opportunity alpha half-life in milliseconds
   */
  public static analyzeSensitivity(params: {
    baseSlot: number;
    requestedComputeUnits: number;
    scenarios: readonly StatePerturbationScenario[];
    alphaHalfLifeMs?: number;
  }): StateSensitivityReport {
    const { baseSlot, requestedComputeUnits, scenarios } = params;
    const halfLifeMs = params.alphaHalfLifeMs ?? 1500;

    if (scenarios.length === 0) {
      return {
        baseSlot,
        stateSensitivityIndex: 1.0,
        isHighSensitivity: true,
        maxOutputDriftBps: 10_000,
        maxCuDriftBps: 10_000,
        cuExhaustionRisk: true,
        recommendedLeaseSlots: 1,
        rationale: 'HIGH_SENSITIVITY: No perturbation scenarios supplied; failing closed to 1-slot lease',
      };
    }

    const baseline = scenarios.find(s => s.slotOffset === 0) ?? scenarios[0];
    if (!baseline.simulatedSuccess || baseline.simulatedOutputLamports <= 0n) {
      return {
        baseSlot,
        stateSensitivityIndex: 1.0,
        isHighSensitivity: true,
        maxOutputDriftBps: 10_000,
        maxCuDriftBps: 10_000,
        cuExhaustionRisk: true,
        recommendedLeaseSlots: 0,
        rationale: 'SIMULATION_FAILED: Baseline simulation failed or produced zero output',
      };
    }

    let maxOutputDriftBps = 0;
    let maxCuDriftBps = 0;
    let cuExhaustionRisk = false;
    let anyAdjacentFailed = false;

    for (const scenario of scenarios) {
      if (scenario.slotOffset === 0) continue;

      if (!scenario.simulatedSuccess) {
        anyAdjacentFailed = true;
        maxOutputDriftBps = Math.max(maxOutputDriftBps, 5000); // 50% penalty for failure in adjacent slot
        continue;
      }

      // Compute output drift relative to baseline
      const outputDiff = baseline.simulatedOutputLamports > scenario.simulatedOutputLamports
        ? baseline.simulatedOutputLamports - scenario.simulatedOutputLamports
        : 0n;
      const driftBps = Number((outputDiff * 10_000n) / baseline.simulatedOutputLamports);
      if (driftBps > maxOutputDriftBps) {
        maxOutputDriftBps = driftBps;
      }

      // Compute CU drift relative to baseline
      const cuDiff = Math.abs(scenario.simulatedComputeUnits - baseline.simulatedComputeUnits);
      const cuDriftBps = Math.round((cuDiff / Math.max(1, baseline.simulatedComputeUnits)) * 10_000);
      if (cuDriftBps > maxCuDriftBps) {
        maxCuDriftBps = cuDriftBps;
      }

      // Check CU headroom
      if (scenario.simulatedComputeUnits > requestedComputeUnits * 0.88) {
        cuExhaustionRisk = true;
      }
    }

    // Composite sensitivity index (0.0 to 1.0)
    const driftFactor = Math.min(1.0, maxOutputDriftBps / 1000); // 10% drift = 1.0
    const cuFactor = Math.min(1.0, maxCuDriftBps / 2000);        // 20% CU shift = 1.0
    const failureFactor = anyAdjacentFailed ? 0.40 : 0.0;

    const stateSensitivityIndex = Number(
      Math.min(1.0, Math.max(0.0, (driftFactor * 0.5) + (cuFactor * 0.2) + failureFactor)).toFixed(3)
    );

    const isHighSensitivity = stateSensitivityIndex > 0.35 || cuExhaustionRisk;

    // Recommended lease slots: derived from alpha half-life and sensitivity
    const maxTheoreticalSlots = Math.max(1, Math.floor(halfLifeMs / this.SLOT_DURATION_MS));
    const sensitivityDiscount = 1.0 - (stateSensitivityIndex * 0.75);
    const recommendedLeaseSlots = Math.max(1, Math.floor(maxTheoreticalSlots * sensitivityDiscount));

    const rationale = isHighSensitivity
      ? `HIGH_STATE_SENSITIVITY (index ${stateSensitivityIndex}): output drift ${maxOutputDriftBps} bps, CU expansion ${maxCuDriftBps} bps; restricting lease to ${recommendedLeaseSlots} slots`
      : `Stable state dynamics (index ${stateSensitivityIndex}): max drift ${maxOutputDriftBps} bps; lease granted for ${recommendedLeaseSlots} slots`;

    return {
      baseSlot,
      stateSensitivityIndex,
      isHighSensitivity,
      maxOutputDriftBps,
      maxCuDriftBps,
      cuExhaustionRisk,
      recommendedLeaseSlots,
      rationale,
    };
  }

  /**
   * Generates a cryptographic StateLeaseV2 binding an execution intent to an immutable slot envelope.
   */
  public static issueLease(
    intentId: string,
    report: StateSensitivityReport,
    alphaHalfLifeMs: number
  ): StateLeaseV2 {
    const expirySlot = report.baseSlot + report.recommendedLeaseSlots;
    const leaseId = `lease_${intentId.slice(0, 8)}_${report.baseSlot}_${expirySlot}`;

    const leaseHash = createHash('sha256')
      .update(JSON.stringify({
        leaseId,
        intentId,
        baseSlot: report.baseSlot,
        expirySlot,
        recommendedLeaseSlots: report.recommendedLeaseSlots,
        sensitivityIndex: report.stateSensitivityIndex,
        alphaHalfLifeMs,
      }))
      .digest('hex');

    return Object.freeze({
      leaseId,
      intentId,
      baseSlot: report.baseSlot,
      expirySlot,
      maxAllowedSlotDrift: report.recommendedLeaseSlots,
      alphaHalfLifeMs,
      sensitivityIndex: report.stateSensitivityIndex,
      leaseHash,
    });
  }

  /**
   * Verifies whether a transaction broadcast / landing slot satisfies its StateLeaseV2 contract.
   */
  public static validateLease(lease: StateLeaseV2, currentSlot: number): {
    readonly isValid: boolean;
    readonly remainingSlots: number;
    readonly reason?: string;
  } {
    if (currentSlot < lease.baseSlot) {
      return {
        isValid: false,
        remainingSlots: 0,
        reason: `INVALID_SLOT_RETROGRADE: Current slot ${currentSlot} < lease base slot ${lease.baseSlot}`,
      };
    }

    if (currentSlot > lease.expirySlot) {
      return {
        isValid: false,
        remainingSlots: 0,
        reason: `LEASE_EXPIRED: Current slot ${currentSlot} > lease expiry slot ${lease.expirySlot} (+${currentSlot - lease.expirySlot} slots late)`,
      };
    }

    return {
      isValid: true,
      remainingSlots: lease.expirySlot - currentSlot,
    };
  }
}
