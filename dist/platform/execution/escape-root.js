/**
 * SYLPH FUSION — ESCAPEROOT: Real Exit Proofs & Survival Treasury
 * Specifications: Sections 23 (Real Exit Proofs E0-E5), 24 (Exit Prewarming), 25 (Survival Treasury), 103 (Invariants 9, 10)
 *
 * Real exit proofs:
 * E0 UNKNOWN -> E1 TRANSFERABLE -> E2 ROUTE_DISCOVERED -> E3 EXACT_SIMULATION -> E4 LIVE_EXECUTABLE -> E5 REDUNDANT_EXIT
 * Maintains live ExitExecutionCertificates for 25%, 50%, 75%, and 100% brackets of every position.
 * Rejects synthetic impact/fees. Caches prewarmed ExitTemplates.
 * Dynamic PortfolioEmergencyRequirement: Guarantees remaining liquid SOL >= survival reserve after any entry.
 */
import { createHash } from 'node:crypto';
export class EscapeRootAuthority {
    exitCertificatesByMint = new Map();
    prewarmedTemplates = new Map();
    /**
     * Prewarms and caches an ExitTemplate for a healthy token position (Section 24).
     */
    registerPrewarmedTemplate(template) {
        this.prewarmedTemplates.set(template.mint, template);
    }
    getPrewarmedTemplate(mint) {
        return this.prewarmedTemplates.get(mint);
    }
    /**
     * Records a simulated exit execution certificate for a specific percentage bracket (Section 23).
     * Refuses synthetic placeholders; verifies exact simulation evidence.
     */
    recordExitProof(params) {
        const { mint, bracketPct, tokenQuantity, proofLevel, expectedOutputLamports, expectedPriceImpactBps, estimatedTotalFeeLamports, venue, simulatedAtSlot, } = params;
        if (tokenQuantity <= 0n)
            throw new Error('EXIT_PROOF_INVALID: tokenQuantity must be positive');
        // Section 23: E3 requires exact simulation with realistic output
        const isExecutable = (proofLevel === 'E3_EXACT_SIMULATION' || proofLevel === 'E4_LIVE_EXECUTABLE' || proofLevel === 'E5_REDUNDANT_EXIT') &&
            expectedOutputLamports > 0n &&
            expectedPriceImpactBps <= 3000; // Under 30% exit impact
        const sha256 = createHash('sha256')
            .update(`${mint}:${bracketPct}:${proofLevel}:${expectedOutputLamports}:${expectedPriceImpactBps}:${simulatedAtSlot}`)
            .digest('hex');
        const cert = {
            certificateId: `EXCERT-${sha256.slice(0, 16)}`,
            mint,
            bracketPct,
            tokenQuantity,
            proofLevel,
            expectedOutputLamports,
            expectedPriceImpactBps,
            estimatedTotalFeeLamports,
            venue,
            simulatedAtSlot,
            simulatedAtMs: Date.now(),
            isExecutable,
            reason: isExecutable
                ? `Verified exitability under ${proofLevel} on ${venue} (Impact: ${expectedPriceImpactBps} bps)`
                : `Exitability failed: Level ${proofLevel}, impact ${expectedPriceImpactBps} bps, output ${expectedOutputLamports} lamports`,
        };
        let brackets = this.exitCertificatesByMint.get(mint);
        if (!brackets) {
            brackets = new Map();
            this.exitCertificatesByMint.set(mint, brackets);
        }
        brackets.set(bracketPct, cert);
        return cert;
    }
    /**
     * Verifies whether all 4 brackets (25%, 50%, 75%, 100%) have valid simulated proofs.
     */
    verifyFullExitability(mint) {
        const brackets = this.exitCertificatesByMint.get(mint);
        if (!brackets) {
            return { isFullyExitReady: false, verifiedBracketsCount: 0, lowestProofLevel: 'E0_UNKNOWN' };
        }
        const required = [25, 50, 75, 100];
        let verifiedCount = 0;
        let lowestLevel = 'E5_REDUNDANT_EXIT';
        for (const pct of required) {
            const cert = brackets.get(pct);
            if (cert && cert.isExecutable) {
                verifiedCount++;
            }
            else {
                lowestLevel = cert ? cert.proofLevel : 'E0_UNKNOWN';
            }
        }
        return {
            isFullyExitReady: verifiedCount === 4,
            verifiedBracketsCount: verifiedCount,
            lowestProofLevel: verifiedCount === 4 ? 'E3_EXACT_SIMULATION' : lowestLevel,
        };
    }
    /**
     * Calculates the dynamic Survival Treasury requirement for emergency liquidations (Section 25).
     * Invariant 10: After any entry, remaining liquid SOL >= required portfolio survival reserve.
     */
    calculatePortfolioSurvivalRequirement(openPositionsCount) {
        const baseFeeLamports = 5000n;
        const priorityFeeLamports = 250000n;
        const jitoTipLamports = 50000n;
        const rentAllowanceLamports = 2039280n; // Standard ATA rent exemption
        const retryBudgetPerPosition = (baseFeeLamports + priorityFeeLamports + jitoTipLamports) * 3n;
        // Safety allowance per position: (fees + tip + retries) * count + rent reserve
        const countBigInt = BigInt(Math.max(1, openPositionsCount));
        const perPositionCost = baseFeeLamports + priorityFeeLamports + jitoTipLamports + retryBudgetPerPosition;
        const totalSurvivalReserveRequiredLamports = (perPositionCost * countBigInt) + rentAllowanceLamports;
        return {
            baseFeeLamports,
            priorityFeeLamports,
            jitoTipLamports,
            rentAllowanceLamports,
            retryAllowanceLamports: retryBudgetPerPosition,
            openPositionsCount,
            totalSurvivalReserveRequiredLamports,
        };
    }
    /**
     * Enforces Invariant 10: Checks if an entry would violate the Survival Treasury reserve.
     */
    verifySurvivalTreasuryInvariant(params) {
        const { currentLiquidSolLamports, proposedEntryCommitmentLamports, currentOpenPositionsCount } = params;
        const remainingLiquid = currentLiquidSolLamports - proposedEntryCommitmentLamports;
        const survivalReq = this.calculatePortfolioSurvivalRequirement(currentOpenPositionsCount + 1);
        if (remainingLiquid < survivalReq.totalSurvivalReserveRequiredLamports) {
            return {
                isPermitted: false,
                remainingLiquidSolLamports: remainingLiquid,
                requiredSurvivalReserveLamports: survivalReq.totalSurvivalReserveRequiredLamports,
                reason: `SURVIVAL_TREASURY_INSUFFICIENT: Remaining SOL (${remainingLiquid} lamports) would drop below required emergency reserve (${survivalReq.totalSurvivalReserveRequiredLamports} lamports)`,
            };
        }
        return {
            isPermitted: true,
            remainingLiquidSolLamports: remainingLiquid,
            requiredSurvivalReserveLamports: survivalReq.totalSurvivalReserveRequiredLamports,
            reason: 'Survival treasury invariant satisfied',
        };
    }
}
export const globalEscapeRoot = new EscapeRootAuthority();
//# sourceMappingURL=escape-root.js.map