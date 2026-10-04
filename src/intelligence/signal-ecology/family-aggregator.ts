/**
 * SYLPH FUSION — SIGNAL ECOLOGY-X: FAMILY AGGREGATOR & INDEPENDENT ALPHA UNITS
 * Specifications: Master Blueprint Section XV (Independent Alpha Units, Redundancy Penalty)
 */

import type { SpecialistPrediction } from './signal-specialist.js';
import type { SignalRole } from './signal-role.js';

export interface EcologyAggregationResult {
  readonly effectiveIndependentAlphaUnits: number;
  readonly roleAverages: Record<SignalRole, number>;
  readonly redundancyPenalties: Record<string, number>;
  readonly primarySpecialistByRole: Record<SignalRole, string | undefined>;
}

export class SignalFamilyAggregator {
  public aggregate(specialists: readonly SpecialistPrediction[]): EcologyAggregationResult {
    const roleGroups = new Map<SignalRole, SpecialistPrediction[]>();
    const roles: SignalRole[] = ['ALPHA', 'RISK', 'EXECUTION', 'REGIME', 'AUTHENTICITY', 'CAPACITY', 'SURVIVAL'];

    for (const r of roles) {
      roleGroups.set(r, []);
    }

    for (const s of specialists) {
      roleGroups.get(s.role)?.push(s);
    }

    const roleAverages = {} as Record<SignalRole, number>;
    const redundancyPenalties: Record<string, number> = {};
    const primarySpecialistByRole = {} as Record<SignalRole, string | undefined>;

    let totalIndependentUnits = 0;

    for (const r of roles) {
      const group = roleGroups.get(r) ?? [];
      if (group.length === 0) {
        roleAverages[r] = 0;
        continue;
      }

      // Compute average
      const sum = group.reduce((acc, s) => acc + s.pointEstimate, 0);
      roleAverages[r] = Number((sum / group.length).toFixed(4));
      primarySpecialistByRole[r] = group[0]?.specialistId;

      // Ancestry overlap check: identical evidenceRoot means redundant
      const uniqueEvidenceRoots = new Set(group.map((s) => s.evidenceRoot)).size;
      const redundancyRatio = group.length > 0 ? (group.length - uniqueEvidenceRoots) / group.length : 0;
      redundancyPenalties[r] = Number(redundancyRatio.toFixed(2));

      // Effective independent units = unique evidence roots
      totalIndependentUnits += uniqueEvidenceRoots;
    }

    return {
      effectiveIndependentAlphaUnits: totalIndependentUnits,
      roleAverages,
      redundancyPenalties,
      primarySpecialistByRole,
    };
  }
}
