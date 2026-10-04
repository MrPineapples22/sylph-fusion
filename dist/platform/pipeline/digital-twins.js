/**
 * SYLPH FUSION — DIGITAL TWINS, LIVE/REPLAY EQUIVALENCE & EPISTEMIC GOVERNANCE
 * Specifications: Prompt 31 (Digital Twins), Prompt 57 (Live/Replay Equivalence),
 *                 Prompt 59 (System Objective), Prompt 60 (Epistemic Labeling)
 *
 * Requirements:
 * 1. Counterfactual research environments: market-twin, agent-market-twin,
 *    maxwell-twin, shadow-portfolio, simulacrum-x.
 * 2. Invariant: Authority is strictly SIMULATE / INFER. Never AUTHORIZE, RESERVE, or SIGN.
 * 3. Invariant: Simulated landing is NEVER treated as proof that a mainnet transaction would have landed.
 * 4. Live/Replay Equivalence: Same evidence + same versions + same policy = IDENTICAL roots.
 * 5. Epistemic Classification: Explicit 4-category taxonomy (Verified Fact, Hypothesis, Experiment, Gate).
 */
import { hashCanonical } from './canonical-hashing.js';
export class DigitalTwinEnvironment {
    /**
     * Executes a counterfactual simulation scenario.
     * Authority is strictly locked to INFER; simulation output explicitly notes
     * that simulated landing does not constitute mainnet proof.
     */
    simulateScenario(scenario) {
        // Epistemic Invariant: Simulated landing is NEVER proof of mainnet inclusion
        const disclaimer = 'COUNTERFACTUAL_RESEARCH_ONLY: Simulated outcomes do not constitute proof of mainnet landing or capital authority';
        let netPnl = 0n;
        let mfe = 0;
        let mae = 0;
        for (const driftBps of scenario.simulatedPriceTrajectoryBps) {
            if (driftBps > mfe)
                mfe = driftBps;
            if (driftBps < mae)
                mae = driftBps;
        }
        // Conservative integer accounting for counterfactual delta
        const lastDrift = scenario.simulatedPriceTrajectoryBps[scenario.simulatedPriceTrajectoryBps.length - 1] ?? 0;
        netPnl = BigInt(lastDrift) * 1000000n; // scaled lamports
        const simulatedLanding = scenario.simulatedLandingLatencyMs < 400; // Simulated threshold
        const preimage = {
            scenarioId: scenario.scenarioId,
            kind: scenario.kind,
            authority: 'INFER',
            simulatedLanding,
            simulatedPnlLamports: netPnl,
            counterfactualMfePct: mfe / 100,
            counterfactualMaePct: mae / 100,
            disclaimer,
        };
        const simulationOutputRoot = hashCanonical(preimage);
        return Object.freeze({
            ...preimage,
            simulationOutputRoot,
        });
    }
}
export class LiveReplayEquivalenceHarness {
    /**
     * Evaluates live vs replay state roots given identical inputs, versions, and policies.
     * Returns isEquivalent: true if deterministic replay produces identical cryptographic roots.
     */
    verifyEquivalence(liveStateRoot, replayComputeFn) {
        const replayStateRoot = replayComputeFn();
        if (liveStateRoot !== replayStateRoot) {
            return Object.freeze({
                isEquivalent: false,
                liveStateRoot,
                replayStateRoot,
                divergenceReason: `STATE_ROOT_DIVERGENCE: Live (${liveStateRoot}) != Replay (${replayStateRoot})`,
            });
        }
        return Object.freeze({
            isEquivalent: true,
            liveStateRoot,
            replayStateRoot,
        });
    }
}
export class EpistemicIdeaClassifier {
    ideas = new Map();
    /**
     * Registers a research discovery or architectural proposal into the strict 4-category taxonomy.
     * Throws if required fields for the category are missing.
     */
    registerIdea(ideaId, title, category, details, registeredAt = new Date().toISOString()) {
        if (category === 'VERIFIED_EXTERNAL_FACT' && !details.verifiedSource) {
            throw new Error(`EPISTEMIC_VIOLATION: VERIFIED_EXTERNAL_FACT requires verifiedSource`);
        }
        if (category === 'TESTABLE_FUSION_HYPOTHESIS' && !details.empiricalPrediction) {
            throw new Error(`EPISTEMIC_VIOLATION: TESTABLE_FUSION_HYPOTHESIS requires empiricalPrediction`);
        }
        if (category === 'PROPOSED_EXPERIMENT' && !details.experimentalDesign) {
            throw new Error(`EPISTEMIC_VIOLATION: PROPOSED_EXPERIMENT requires experimentalDesign`);
        }
        if (category === 'PROMOTION_FALSIFICATION_GATE' && !details.killCriteria) {
            throw new Error(`EPISTEMIC_VIOLATION: PROMOTION_FALSIFICATION_GATE requires killCriteria`);
        }
        const preimage = {
            ideaId,
            title,
            category,
            details,
            registeredAt,
        };
        const proposalHash = hashCanonical(preimage);
        const proposal = Object.freeze({
            ...preimage,
            proposalHash,
        });
        this.ideas.set(ideaId, proposal);
        return proposal;
    }
    getIdea(ideaId) {
        return this.ideas.get(ideaId);
    }
}
//# sourceMappingURL=digital-twins.js.map