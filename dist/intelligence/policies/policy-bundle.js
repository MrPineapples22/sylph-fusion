/**
 * SOL-SYLPH Versioned Policy Bundles & Compatibility Matrix
 * Specifications: Parts XLV, XLVI, XLVIII
 *
 * Enforces:
 * 1. Versioned policy bundles: QualificationPolicy, ProtectionPolicy, RiskPolicy, ExecutionPolicy.
 * 2. Startup Policy Compatibility Verification (e.g. Policy requires Pump >= v15, HSI >= v9, PoD >= v8).
 * 3. Authority Boundary: OBSERVE, ANALYZE, SIMULATE, PROPOSE, AUTHORIZE, EXECUTE.
 */
export const DEFAULT_PRODUCTION_POLICY = {
    policyId: 'pol_institutional_v43',
    policyVersion: 'v43.0.0',
    releaseDateMs: 1789772400000,
    authorityLevel: 'SIMULATE', // Safe default
    requirements: {
        minPumpVersion: 15,
        minHsiVersion: 9,
        minPodVersion: 8,
        minEvidenceVersion: 7,
        minGraphVersion: 6,
        minWorldModelVersion: 4,
    },
    thresholds: {
        minHsiForQualification: 45,
        minPumpForQualification: 40,
        minLiquiditySol: 20.0,
        maxCreatorHoldingPct: 15.0,
        maxRugCheckScore: 30,
        maxUncertaintyAllowed: 0.50,
    },
};
export class PolicyEngine {
    activePolicy = DEFAULT_PRODUCTION_POLICY;
    setPolicy(policy) {
        this.activePolicy = policy;
    }
    getActivePolicy() {
        return this.activePolicy;
    }
    /**
     * Part XLVI: Startup Compatibility Verification.
     */
    verifyCompatibility(actualVersions) {
        const req = this.activePolicy.requirements;
        const errors = [];
        if (actualVersions.pumpVersion < req.minPumpVersion) {
            errors.push(`Pump version ${actualVersions.pumpVersion} < required ${req.minPumpVersion}`);
        }
        if (actualVersions.hsiVersion < req.minHsiVersion) {
            errors.push(`HSI version ${actualVersions.hsiVersion} < required ${req.minHsiVersion}`);
        }
        if (actualVersions.podVersion < req.minPodVersion) {
            errors.push(`PoD version ${actualVersions.podVersion} < required ${req.minPodVersion}`);
        }
        if (actualVersions.evidenceVersion < req.minEvidenceVersion) {
            errors.push(`Evidence version ${actualVersions.evidenceVersion} < required ${req.minEvidenceVersion}`);
        }
        if (actualVersions.graphVersion < req.minGraphVersion) {
            errors.push(`Graph version ${actualVersions.graphVersion} < required ${req.minGraphVersion}`);
        }
        if (actualVersions.worldModelVersion < req.minWorldModelVersion) {
            errors.push(`WorldModel version ${actualVersions.worldModelVersion} < required ${req.minWorldModelVersion}`);
        }
        return {
            isCompatible: errors.length === 0,
            incompatibleDetails: errors,
        };
    }
    /**
     * Evaluates if a canonical token passes qualification under the active policy.
     */
    evaluateQualification(token) {
        const t = this.activePolicy.thresholds;
        const reasons = [];
        if (token.hsi < t.minHsiForQualification) {
            reasons.push(`HSI ${token.hsi} < required ${t.minHsiForQualification}`);
        }
        if (token.pumpScore < t.minPumpForQualification) {
            reasons.push(`PumpScore ${token.pumpScore} < required ${t.minPumpForQualification}`);
        }
        if (token.realLiquiditySol < t.minLiquiditySol) {
            reasons.push(`Liquidity ${token.realLiquiditySol.toFixed(1)} SOL < required ${t.minLiquiditySol} SOL`);
        }
        if (token.creatorHoldingPct > t.maxCreatorHoldingPct) {
            reasons.push(`Creator holding ${token.creatorHoldingPct.toFixed(1)}% > allowed ${t.maxCreatorHoldingPct}%`);
        }
        if (token.rugCheckScore > t.maxRugCheckScore) {
            reasons.push(`RugCheck risk ${token.rugCheckScore} > allowed ${t.maxRugCheckScore}`);
        }
        if (token.overallUncertainty > t.maxUncertaintyAllowed) {
            reasons.push(`Uncertainty ${token.overallUncertainty.toFixed(2)} > allowed ${t.maxUncertaintyAllowed}`);
        }
        return {
            qualified: reasons.length === 0,
            reasons,
        };
    }
}
//# sourceMappingURL=policy-bundle.js.map