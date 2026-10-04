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
import type { PipelineAuthority } from './pipeline-state.js';

export type DigitalTwinKind =
  | 'MARKET_TWIN'
  | 'AGENT_MARKET_TWIN'
  | 'MAXWELL_TWIN'
  | 'SHADOW_PORTFOLIO'
  | 'SIMULACRUM_X';

export interface CounterfactualScenario {
  readonly scenarioId: string;
  readonly kind: DigitalTwinKind;
  readonly baseSlot: bigint;
  readonly inputEvidenceRoots: readonly string[];
  readonly assumptions: Readonly<Record<string, unknown>>;
  readonly simulatedPriceTrajectoryBps: readonly number[];
  readonly simulatedLandingLatencyMs: number;
}

export interface SimulationResult {
  readonly scenarioId: string;
  readonly kind: DigitalTwinKind;
  readonly authority: PipelineAuthority; // Strictly INFER
  readonly simulatedLanding: boolean;
  readonly simulatedPnlLamports: bigint;
  readonly counterfactualMfePct: number;
  readonly counterfactualMaePct: number;
  readonly simulationOutputRoot: string;
  readonly disclaimer: string;
}

export interface ReplayEquivalenceInput {
  readonly evidenceFeed: readonly unknown[];
  readonly versionTag: string;
  readonly policyParams: Readonly<Record<string, unknown>>;
}

export interface ReplayEquivalenceCheck {
  readonly isEquivalent: boolean;
  readonly liveStateRoot: string;
  readonly replayStateRoot: string;
  readonly divergenceReason?: string;
}

export type EpistemicCategory =
  | 'VERIFIED_EXTERNAL_FACT'
  | 'TESTABLE_FUSION_HYPOTHESIS'
  | 'PROPOSED_EXPERIMENT'
  | 'PROMOTION_FALSIFICATION_GATE';

export interface EpistemicProposal {
  readonly ideaId: string;
  readonly title: string;
  readonly category: EpistemicCategory;
  readonly details: {
    readonly verifiedSource?: string;
    readonly empiricalPrediction?: string;
    readonly experimentalDesign?: {
      readonly dataset: string;
      readonly method: string;
      readonly baseline: string;
      readonly controls: readonly string[];
      readonly failureCases: readonly string[];
    };
    readonly killCriteria?: string;
  };
  readonly registeredAt: string;
  readonly proposalHash: string;
}

export class DigitalTwinEnvironment {
  /**
   * Executes a counterfactual simulation scenario.
   * Authority is strictly locked to INFER; simulation output explicitly notes
   * that simulated landing does not constitute mainnet proof.
   */
  public simulateScenario(scenario: CounterfactualScenario): SimulationResult {
    // Epistemic Invariant: Simulated landing is NEVER proof of mainnet inclusion
    const disclaimer =
      'COUNTERFACTUAL_RESEARCH_ONLY: Simulated outcomes do not constitute proof of mainnet landing or capital authority';

    let netPnl = 0n;
    let mfe = 0;
    let mae = 0;

    for (const driftBps of scenario.simulatedPriceTrajectoryBps) {
      if (driftBps > mfe) mfe = driftBps;
      if (driftBps < mae) mae = driftBps;
    }

    // Conservative integer accounting for counterfactual delta
    const lastDrift = scenario.simulatedPriceTrajectoryBps[scenario.simulatedPriceTrajectoryBps.length - 1] ?? 0;
    netPnl = BigInt(lastDrift) * 1000000n; // scaled lamports

    const simulatedLanding = scenario.simulatedLandingLatencyMs < 400; // Simulated threshold

    const preimage = {
      scenarioId: scenario.scenarioId,
      kind: scenario.kind,
      authority: 'INFER' as const,
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
  public verifyEquivalence(
    liveStateRoot: string,
    replayComputeFn: () => string
  ): ReplayEquivalenceCheck {
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
  private readonly ideas = new Map<string, EpistemicProposal>();

  /**
   * Registers a research discovery or architectural proposal into the strict 4-category taxonomy.
   * Throws if required fields for the category are missing.
   */
  public registerIdea(
    ideaId: string,
    title: string,
    category: EpistemicCategory,
    details: EpistemicProposal['details'],
    registeredAt = new Date().toISOString()
  ): EpistemicProposal {
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

    const proposal: EpistemicProposal = Object.freeze({
      ...preimage,
      proposalHash,
    });

    this.ideas.set(ideaId, proposal);
    return proposal;
  }

  public getIdea(ideaId: string): EpistemicProposal | undefined {
    return this.ideas.get(ideaId);
  }
}
