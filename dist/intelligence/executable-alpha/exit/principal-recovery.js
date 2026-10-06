/**
 * SYLPH FUSION — PRINCIPAL RECOVERY ENGINE
 * Section XXXVIII & Study 41: RUNNER-HOLD-vs-RECOVERY-X
 *
 * Implements mathematically sound principal extraction:
 * f_{recover} = \frac{Principal + EntryCosts + DesiredLockedProfit}{ExecutableGrossValue - ExitCosts}
 *
 * Crucial Invariant: Never blindly sell 50%.
 * Computes the exact tokens required after factoring in stressed exit impact and fees.
 */
export class PrincipalRecoveryEngine {
    static calculateRecoveryFraction(params) {
        const { principalInvestedUsd, entryFeesPaidUsd, desiredLockedProfitUsd = 0, executablePositionValueUsd, projectedExitCostsUsd, } = params;
        const requiredProceedsUsd = principalInvestedUsd + entryFeesPaidUsd + desiredLockedProfitUsd;
        const executableNetValueUsd = Math.max(0, executablePositionValueUsd - projectedExitCostsUsd);
        if (executableNetValueUsd <= 0 || requiredProceedsUsd <= 0) {
            return {
                requiredProceedsUsd,
                executableNetValueUsd: 0,
                optimalRecoveryFraction: 0,
                isPrincipalRecoverable: false,
                remainingPositionValueUsd: 0,
            };
        }
        const optimalRecoveryFraction = Math.min(1.0, requiredProceedsUsd / executableNetValueUsd);
        const isPrincipalRecoverable = executableNetValueUsd >= requiredProceedsUsd;
        const remainingPositionValueUsd = Math.max(0, executableNetValueUsd - requiredProceedsUsd);
        return {
            requiredProceedsUsd,
            executableNetValueUsd,
            optimalRecoveryFraction,
            isPrincipalRecoverable,
            remainingPositionValueUsd,
        };
    }
    /**
     * Factory for creating parameterized principal recovery policies (2x, 3x, 5x, 10x target)
     */
    static createPolicy(targetMultiple, desiredProfitPct = 0) {
        return {
            policyId: `principal-recovery-${targetMultiple}x`,
            evaluate(pos, research, liquidation) {
                // If target multiple reached, recover principal
                if (pos.currentMultiple >= targetMultiple) {
                    const desiredProfitUsd = pos.principalInvestedUsd * desiredProfitPct;
                    const report = PrincipalRecoveryEngine.calculateRecoveryFraction({
                        principalInvestedUsd: pos.principalInvestedUsd,
                        entryFeesPaidUsd: pos.entryFeesPaidUsd,
                        desiredLockedProfitUsd: desiredProfitUsd,
                        executablePositionValueUsd: liquidation.currentMarkUsd,
                        projectedExitCostsUsd: liquidation.projectedFeesUsd + liquidation.ownImpactUsd,
                    });
                    if (report.isPrincipalRecoverable) {
                        return {
                            policyId: `principal-recovery-${targetMultiple}x`,
                            action: 'RECOVER_PRINCIPAL',
                            targetFraction: report.optimalRecoveryFraction,
                            expectedProceedsUsd: report.requiredProceedsUsd,
                            expectedImpactBps: Math.round((liquidation.ownImpactUsd / liquidation.currentMarkUsd) * 10000),
                            urgency: 'NORMAL',
                            rationale: `Target ${targetMultiple}x reached; locking principal $${pos.principalInvestedUsd.toFixed(2)} via fraction ${(report.optimalRecoveryFraction * 100).toFixed(1)}%`,
                        };
                    }
                }
                return {
                    policyId: `principal-recovery-${targetMultiple}x`,
                    action: 'HOLD',
                    targetFraction: 0,
                    expectedProceedsUsd: 0,
                    expectedImpactBps: 0,
                    urgency: 'LOW',
                    rationale: `Current multiple ${pos.currentMultiple.toFixed(2)}x below target ${targetMultiple}x`,
                };
            },
        };
    }
}
//# sourceMappingURL=principal-recovery.js.map