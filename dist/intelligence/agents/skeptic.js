/**
 * SOL-SYLPH Master Production Intelligence - The Skeptic
 * Specifications: Section 28 (The Skeptic).
 *
 * Rules:
 * 1. The Skeptic does not simply predict the opposite outcome.
 * 2. It directly attacks the decision thesis (Are buyers independent? Is liquidity persistent? Does clean-room state agree?).
 * 3. Produces a structured ChallengeReport.
 */
export class Skeptic {
    challenge(input) {
        const flaws = [];
        const fragile = [];
        // 1. Sybil / Bundling Attack
        if (input.clusterDispersalRatio < 0.25) {
            flaws.push(`Buyers are heavily bundled (cluster dispersal ${(input.clusterDispersalRatio * 100).toFixed(1)}% < 25%)`);
            fragile.push('assumption: buyers represent independent retail demand');
        }
        // 2. Clean-Room Disagreement Attack
        if (input.cleanRoomDeceptionSevere) {
            flaws.push('Decontaminated clean-room state severely contradicts raw observed metrics');
            fragile.push('assumption: volume reflects genuine price discovery');
        }
        // 3. Cheap Manipulation Vulnerability Attack
        if (input.decisionManipulabilityCostSol < 0.2) {
            flaws.push(`Decision easily manipulable (estimated attack cost ${input.decisionManipulabilityCostSol.toFixed(3)} SOL < 0.2 SOL)`);
            fragile.push('assumption: signals are costly for adversaries to fake');
        }
        // 4. Shallow Liquidity Vulnerability
        if (input.poolLiquiditySol < 1.0) {
            flaws.push(`Fragile pool depth (${input.poolLiquiditySol.toFixed(2)} SOL < 1.0 SOL floor)`);
            fragile.push('assumption: pool depth supports exit without catastrophic slippage');
        }
        const vulnerable = flaws.length > 0;
        let rec = 'PROCEED';
        if (flaws.length >= 2 || input.cleanRoomDeceptionSevere) {
            rec = 'ABSTAIN';
        }
        else if (vulnerable) {
            rec = 'REDUCE_SIZE';
        }
        return {
            skepticId: 'skeptic-core-v1',
            thesisChallenged: input.thesis,
            thesisVulnerable: vulnerable,
            fatalFlawsDetected: flaws,
            fragileAssumptions: fragile,
            recommendedAction: rec,
            evaluatedAtMs: Date.now(),
        };
    }
}
//# sourceMappingURL=skeptic.js.map