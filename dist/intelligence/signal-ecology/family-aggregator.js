/**
 * SYLPH FUSION — SIGNAL ECOLOGY-X: FAMILY AGGREGATOR & INDEPENDENT ALPHA UNITS
 * Specifications: Master Blueprint Section XV (Independent Alpha Units, Redundancy Penalty)
 */
export class SignalFamilyAggregator {
    aggregate(specialists) {
        const roleGroups = new Map();
        const roles = ['ALPHA', 'RISK', 'EXECUTION', 'REGIME', 'AUTHENTICITY', 'CAPACITY', 'SURVIVAL'];
        for (const r of roles) {
            roleGroups.set(r, []);
        }
        for (const s of specialists) {
            roleGroups.get(s.role)?.push(s);
        }
        const roleAverages = {};
        const redundancyPenalties = {};
        const primarySpecialistByRole = {};
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
//# sourceMappingURL=family-aggregator.js.map